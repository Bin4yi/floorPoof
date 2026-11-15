import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Floor3D from "./Floor3D";
import { api } from "./api";
import { applyDraft, nextId } from "./draft";
import type { AgentRun, Change, CheckResult, Evaluation, FloorData } from "./types";

type Status = Awaited<ReturnType<typeof api.status>>;

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [floorName, setFloorName] = useState("factory");
  const [data, setData] = useState<FloorData | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [evalResult, setEvalResult] = useState<Evaluation | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<{ type: string; rotation: number } | null>(null);
  const [placeLine, setPlaceLine] = useState("");
  const [placePanel, setPlacePanel] = useState("");
  const [tab, setTab] = useState<"manual" | "agent">("manual");
  const [request, setRequest] = useState("Add 4 pressing machines to Line B");
  const [replays, setReplays] = useState<{ request: string }[]>([]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [viewAttempt, setViewAttempt] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const evalSeq = useRef(0);

  useEffect(() => { api.status().then(setStatus).catch((e) => setMessage(String(e))); }, []);
  useEffect(() => {
    setData(null); setChanges([]); setRun(null); setViewAttempt(null); setSelectedId(null); setPlacing(null);
    api.floor(floorName).then(setData).catch((e) => setMessage(String(e)));
    api.replays(floorName).then(setReplays).catch(() => setReplays([]));
  }, [floorName]);

  // Live checks on the draft after every change. The server tests it in a rolled-back transaction.
  useEffect(() => {
    if (!data) return;
    if (changes.length === 0) { setEvalResult(null); return; }
    const seq = ++evalSeq.current;
    const t = setTimeout(() => {
      api.evaluate(floorName, changes).then((r) => { if (seq === evalSeq.current) setEvalResult(r); })
        .catch((e) => setMessage(String(e)));
    }, 120);
    return () => clearTimeout(t);
  }, [changes, data, floorName]);

  const attempt = run && viewAttempt !== null ? run.attempts[viewAttempt] : null;
  const shownChanges = attempt ? attempt.changes : changes;
  const items = useMemo(() => (data ? applyDraft(data.items, shownChanges, data.item_types) : []),
                        [data, shownChanges]);
  const changedIds = useMemo(() => new Set(shownChanges.map((c) => c.id)), [shownChanges]);
  const shown: Evaluation | null = attempt
    ? { valid: attempt.valid, error: attempt.error, passed: attempt.passed, results: attempt.results,
        failed: attempt.failed, skipped: [], ms: attempt.ms }
    : evalResult ?? data;
  const redCells = useMemo(() => (shown?.results ?? []).filter((r) => r.status === "fail").flatMap((r) => r.cells),
                           [shown]);
  const editable = !attempt;

  const push = useCallback((c: Change) => { setChanges((cs) => [...cs, c]); setMessage(null); }, []);
  const place = (x: number, y: number) => {
    if (!data || !placing) return;
    const c: Change = { op: "add", id: nextId(data.items, changes), type: placing.type, x, y, rotation: placing.rotation };
    if (placeLine) c.line = placeLine;
    if (placePanel) c.panel = placePanel;
    push(c);
  };
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const rotate = () => selected && push({ op: "move", id: selected.id, rotation: (selected.rotation + 90) % 360 });
  const remove = () => { if (selected) { push({ op: "remove", id: selected.id }); setSelectedId(null); } };

  const undoStep = async () => {
    if (changes.length) { setChanges((cs) => cs.slice(0, -1)); return; }
    setBusy("Undoing last accepted change");
    try { const r = await api.undo(floorName); setData(r.floor); setMessage(`Undid ${r.undone}.`); }
    catch (e) { setMessage(String(e)); } finally { setBusy(null); }
  };
  const acceptDraft = async () => {
    setBusy("Checking and saving");
    try {
      const r = await api.accept(floorName, changes);
      setData(r.floor); setChanges([]); setMessage(`Saved as ${r.accepted}. The checks passed again inside the save.`);
    } catch (e) { setMessage(String(e)); } finally { setBusy(null); }
  };
  const runAgent = async (fix: boolean) => {
    setBusy(fix ? "Asking the agent for the smallest fix" : "Agent is proposing, the graph is checking");
    setTab("agent"); setViewAttempt(null);
    try {
      const r = fix ? await api.fix(floorName, changes) : await api.agent(floorName, request);
      setRun(r);
      if (r.error) setMessage(r.error);
      else if (r.outcome.best_index !== undefined) setViewAttempt(r.outcome.best_index);
    } catch (e) { setMessage(String(e)); } finally { setBusy(null); }
  };
  const acceptAttempt = async (i: number) => {
    const a = run?.attempts[i];
    if (!a?.proposal_id) return;
    setBusy("Checking and saving the proposal");
    try {
      const r = await api.acceptProposal(a.proposal_id);
      setData(r.floor); setChanges([]); setRun(null); setViewAttempt(null);
      setMessage(`Saved proposal ${a.proposal_id}.`);
    } catch (e) { setMessage(String(e)); } finally { setBusy(null); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "TEXTAREA" || (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "Escape") { setPlacing(null); setSelectedId(null); }
      if (e.key.toLowerCase() === "r") placing ? setPlacing({ ...placing, rotation: (placing.rotation + 90) % 360 }) : rotate();
      if (e.key === "Delete" || e.key === "Backspace") remove();
      if (e.key.toLowerCase() === "z" && (e.ctrlKey || e.metaKey)) undoStep();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!data) return <div className="loading">{message ?? "Loading floor from floorproof.rl ..."}</div>;
  const loads = shown?.results.find((r) => r.kind === "panel_load")?.data?.loads ?? [];

  return (
    <div className="app">
      <header>
        <h1>FloorProof</h1>
        <span className="tag">The AI suggests, the graph proves.</span>
        <select value={floorName} onChange={(e) => setFloorName(e.target.value)}>
          {status?.floors.map((f) => <option key={f.name} value={f.name}>{f.label} · {f.pack}</option>)}
        </select>
        <span className="store">Relate store: {status?.store} ({status?.storage})</span>
        <span className={`llm ${status?.llm.live ? "live" : "replay"}`}>
          model: {status?.llm.live ? `${status.llm.model} (live)` : "replay only (no API key)"}
        </span>
      </header>

      <aside className="left">
        <div className="tabs">
          <button className={tab === "manual" ? "on" : ""} onClick={() => setTab("manual")}>Manual edit</button>
          <button className={tab === "agent" ? "on" : ""} onClick={() => setTab("agent")}>Ask the agent</button>
        </div>
        {tab === "manual" ? (
          <>
            <h3>Add an item</h3>
            <p className="hint">Pick, then click the floor. R rotates. Drag items to move. Delete removes.</p>
            <div className="palette">
              {data.item_types.map((t) => (
                <button key={t.name} className={placing?.type === t.name ? "on" : ""}
                        onClick={() => setPlacing(placing?.type === t.name ? null : { type: t.name, rotation: 0 })}>
                  <i style={{ background: t.color }} />{t.label}
                  <small>{t.w * data.floor.cell_m}×{t.d * data.floor.cell_m} m{t.kw ? ` · ${t.kw} kW` : ""}</small>
                </button>
              ))}
            </div>
            {placing && (
              <div className="placeopts">
                <label>Rotation <b>{placing.rotation}°</b></label>
                {data.lines.length > 0 && (
                  <label>Line <select value={placeLine} onChange={(e) => setPlaceLine(e.target.value)}>
                    <option value="">none</option>{data.lines.map((l) => <option key={l.name}>{l.name}</option>)}
                  </select></label>)}
                {data.panels.length > 0 && (
                  <label>Plug into <select value={placePanel} onChange={(e) => setPlacePanel(e.target.value)}>
                    <option value="">nearest drop box</option>
                    {data.panels.filter((p) => p.kind === "drop_box").map((p) => <option key={p.name}>{p.name}</option>)}
                  </select></label>)}
              </div>
            )}
            {selected && (
              <div className="selected">
                <h3>{selected.id}</h3>
                <p>{data.item_types.find((t) => t.name === selected.type)?.label} at ({selected.x}, {selected.y}),
                  {" "}{selected.rotation}°{selected.line ? `, line ${selected.line}` : ""}{selected.panel ? `, ${selected.panel}` : ""}</p>
                <button onClick={rotate}>Rotate</button> <button onClick={remove}>Remove</button>
              </div>
            )}
            <h3>Draft ({changes.length} change{changes.length === 1 ? "" : "s"}, not saved)</h3>
            <ol className="changes">
              {changes.map((c, i) => <li key={i}>{c.op} {c.id}{c.op === "add" ? ` ${c.type} @${c.x},${c.y}` : ""}
                {c.op === "move" ? ` → ${c.x ?? ""}${c.y !== undefined ? "," + c.y : ""}${c.rotation !== undefined ? ` ${c.rotation}°` : ""}` : ""}</li>)}
            </ol>
            <div className="actions">
              <button className="primary" disabled={!changes.length || !evalResult?.passed || !!busy} onClick={acceptDraft}
                      title={evalResult && !evalResult.passed ? "Only a layout that passes every check can be saved" : ""}>Accept</button>
              <button onClick={undoStep} disabled={!!busy}>{changes.length ? "Undo step" : "Undo last accept"}</button>
              <button onClick={() => setChanges([])} disabled={!changes.length}>Discard</button>
              <button onClick={() => runAgent(true)} disabled={!changes.length || !evalResult || evalResult.passed || !!busy}>Fix it</button>
            </div>
          </>
        ) : (
          <>
            <h3>Change request</h3>
            <textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={3} />
            {replays.length > 0 && (
              <p className="hint">Recorded runs (work with no API key):{" "}
                {replays.map((r) => <a key={r.request} onClick={() => setRequest(r.request)}>{r.request}</a>)}</p>)}
            <button className="primary" disabled={!!busy || !request.trim()} onClick={() => runAgent(false)}>Propose layouts</button>
            {run && <Attempts run={run} view={viewAttempt} onView={setViewAttempt} onAccept={acceptAttempt} />}
          </>
        )}
      </aside>

      <main>
        <Floor3D data={data} items={items} changedIds={changedIds} selectedId={selectedId} placing={editable ? placing : null}
                 redCells={redCells} editable={editable} onSelect={setSelectedId} onPlace={place}
                 onMove={(id, x, y) => push({ op: "move", id, x, y })} onHover={setHover} />
        {hover && <div className="hover">{hover}</div>}
        {attempt && <div className="banner">Viewing attempt {attempt.round}.{attempt.index} ({attempt.passed ? "proven" : "rejected"})
          <button onClick={() => setViewAttempt(null)}>Back to floor</button></div>}
        {busy && <div className="busy">{busy} ...</div>}
        {message && <div className="message" onClick={() => setMessage(null)}>{message}</div>}
        <div className="note">{data.floor.data_note} Planning aid only, not a certified safety tool.</div>
      </main>

      <aside className="right">
        <h3>Checks {shown?.passed ? <span className="ok">all pass</span> : <span className="bad">failed</span>}
          <small> {shown?.ms?.toFixed(0)} ms</small></h3>
        {shown && !shown.valid && <p className="bad">Invalid layout: {shown.error}</p>}
        {shown?.results.map((r) => <CheckRow key={r.rule_id} r={r} />)}
        {loads.length > 0 && <LoadBars loads={loads} />}
      </aside>
    </div>
  );
}

function CheckRow({ r }: { r: CheckResult }) {
  const icon = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "–";
  return (
    <div className={`check ${r.status}`}>
      <div><b>{icon} {r.title}</b> <small>{r.rule_id} · {r.ms.toFixed(0)} ms</small></div>
      <div className="detail">{r.status === "skipped" ? `Not checked: ${r.detail}` : r.detail}</div>
      <div className="src">{r.source_url ? <a href={r.source_url} target="_blank" rel="noreferrer">{r.source_note}</a> : r.source_note}</div>
    </div>
  );
}

function LoadBars({ loads }: { loads: { name: string; kind: string; kw: number; limit_kw: number; capacity_kw: number }[] }) {
  return (
    <div className="loads">
      <h3>Power load (limit = 80% of rating)</h3>
      {loads.map((l) => {
        const pct = Math.min(130, (l.kw / l.limit_kw) * 100);
        return (
          <div key={l.name} className={`load ${l.kind}`}>
            <span>{l.name}</span>
            <div className="bar"><div className={pct > 100 ? "over" : pct > 85 ? "near" : ""} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
            <small>{l.kw} / {l.limit_kw} kW</small>
          </div>
        );
      })}
    </div>
  );
}

function Attempts({ run, view, onView, onAccept }: {
  run: AgentRun; view: number | null; onView: (i: number) => void; onAccept: (i: number) => void;
}) {
  return (
    <div className="attempts">
      <h3>Attempts {run.mode ? <small>({run.mode}{run.seconds ? `, ${run.seconds} s` : ""})</small> : null}</h3>
      {run.outcome.status === "handed_back" && (
        <div className="handback"><b>Handed back to you.</b> No layout passed after {run.attempts.at(-1)?.round} rounds. Open problems:
          <ul>{run.outcome.open_problems?.map((p) => <li key={p}>{p}</li>)}</ul></div>)}
      {run.attempts.map((a, i) => (
        <div key={i} className={`attempt ${a.passed ? "pass" : "fail"} ${view === i ? "on" : ""}`} onClick={() => onView(i)}>
          <div><b>{a.round}.{a.index} {a.passed ? "✓ proven" : "✗ rejected"}</b> <small>{a.ms.toFixed(0)} ms check</small></div>
          {a.note && <div className="detail">{a.note}</div>}
          {!a.valid && <div className="detail bad">{a.error}</div>}
          {a.results.filter((r) => r.status === "fail").map((r) => <div key={r.rule_id} className="detail bad">{r.rule_id}: {r.detail}</div>)}
          {a.passed && a.proposal_id && <button className="primary" onClick={(e) => { e.stopPropagation(); onAccept(i); }}>Accept this layout</button>}
        </div>
      ))}
    </div>
  );
}
