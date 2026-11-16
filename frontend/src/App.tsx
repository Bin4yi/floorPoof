import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Floor3D, { type Load, type PathInfo } from "./Floor3D";
import BuilderPanel, { CELL, blankSpec, useBuild } from "./Builder";
import ItemMaker from "./ItemMaker";
import Efficiency, { type Layer } from "./Efficiency";
import type { Preset } from "./Explorer";
// Loaded only when opened: it brings Relate's WebAssembly build (about 7 MB) into the tab.
const Explorer = lazy(() => import("./Explorer"));
import { api, type FloorRow } from "./api";
import { applyDraft, nextId, size } from "./draft";
import { shapeOf } from "./models";
import type { AgentRun, Change, CheckResult, Evaluation, FloorData, FloorSpec, Item, Memory, Pick, QueryTrace, Suggestion } from "./types";

type Status = Awaited<ReturnType<typeof api.status>>;
const GLYPH: Record<string, string> = {
  machine: "⚙", press: "▤", table: "▭", cutting: "✂", packing: "▣", rack: "▥", rolls: "◎", pallet: "▦", drums: "◍",
  tank: "◉", conveyor: "⇉", robot: "✇", box: "▢",
};

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  // Deep links for demos: ?floor=warehouse&place=pallet_rack&line=B&select=R1&paths=1&build=1
  const qs = useMemo(() => new URLSearchParams(window.location.search), []);
  const [floorName, setFloorName] = useState(qs.get("floor") ?? "factory");
  const [data, setData] = useState<FloorData | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [evalResult, setEvalResult] = useState<Evaluation | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<{ type: string; rotation: number } | null>(null);
  const [placeLine, setPlaceLine] = useState("");
  const [placePanel, setPlacePanel] = useState("");
  const [tab, setTab] = useState<"manual" | "agent" | "build">("manual");
  const [request, setRequest] = useState("Add 4 pressing machines to Line B");
  const [replays, setReplays] = useState<{ request: string }[]>([]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [viewAttempt, setViewAttempt] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [sugBusy, setSugBusy] = useState(false);
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ paths: false, line: false, flow: false, crowd: false });
  const showPaths = layers.paths;
  const setShowPaths = (v: boolean) => setLayers((l) => ({ ...l, paths: v }));
  const toggleLayer = (k: Layer) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const [rightTab, setRightTab] = useState<"efficiency" | "rules">("efficiency");
  const [history, setHistory] = useState<{ t: number; index: number }[]>([]);
  const [center, setCenter] = useState<"floor" | "graph">("floor");
  const [explorerReq, setExplorerReq] = useState<Preset | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const openInExplorer = (q: QueryTrace) => { setExplorerReq({ title: "", query: q.cypher, params: q.params ?? {} }); setCenter("graph"); };
  const [showPower, setShowPower] = useState(true);
  const [showHeat, setShowHeat] = useState(true);
  const [maker, setMaker] = useState(false);
  const [spec, setSpecState] = useState<FloorSpec>(blankSpec());
  const [editing, setEditing] = useState<string | null>(null);
  const evalSeq = useRef(0);
  const sugSeq = useRef(0);
  const setSpec = useCallback((f: (s: FloorSpec) => FloorSpec) => setSpecState(f), []);
  const build = useBuild(spec, setSpec);

  const refreshStatus = () => api.status().then(setStatus).catch((e) => setMessage(String(e)));
  useEffect(() => { refreshStatus(); }, []);
  useEffect(() => {
    setData(null); setChanges([]); setRun(null); setViewAttempt(null); setSelectedId(null); setPlacing(null);
    setPlaceLine(""); setPlacePanel(""); setSuggestion(null); setMaker(false); setHistory([]);
    api.floor(floorName).then((d) => {
      setData(d);
      if (qs.get("place") && d.item_types.some((t) => t.name === qs.get("place"))) {
        setPlacing({ type: qs.get("place")!, rotation: Number(qs.get("rot") ?? 0) });
        setPlaceLine(qs.get("line") ?? "");
      } else if (qs.get("select")) setSelectedId(qs.get("select"));
      if (qs.get("paths")) setShowPaths(true);
      for (const k of (qs.get("layers") ?? "").split(",")) if (k) setLayers((l) => ({ ...l, [k]: true }));
      if (qs.get("tab") === "rules") setRightTab("rules");
      if (qs.get("view") === "graph") setCenter("graph");
      if (qs.get("explore")) import("./Explorer").then((m) => setExplorerReq(m.presets(qs.get("item"))[Number(qs.get("explore"))] ?? null));
      if (qs.get("build")) { setSpecState(blankSpec()); setTab("build"); }
      if (qs.get("maker")) setMaker(true);
      if (qs.get("agent")) { setRequest(qs.get("agent")!); setTab("agent"); setTimeout(() => document.getElementById("run-agent")?.click(), 300); }
      qs.delete("place"); qs.delete("select"); qs.delete("build"); qs.delete("maker"); qs.delete("agent");
    }).catch((e) => setMessage(String(e)));
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
  const items = useMemo(() => (data ? applyDraft(data.items, shownChanges, data.item_types) : []), [data, shownChanges]);

  const shown: Evaluation | null = attempt
    ? { valid: attempt.valid, error: attempt.error, passed: attempt.passed, results: attempt.results,
        failed: attempt.failed, skipped: [], ms: attempt.ms }
    : evalResult ?? data;
  const changedIds = useMemo(() => {
    const saved = new Set((data?.items ?? []).map((i) => i.id));
    return new Set([...shownChanges.map((c) => c.id).filter(Boolean), ...items.filter((i) => !saved.has(i.id)).map((i) => i.id)]);
  }, [shownChanges, items, data]);
  // Agent attempts carry no metrics; measure the viewed attempt as a draft (rolled back on the server).
  const [attemptMetrics, setAttemptMetrics] = useState<Evaluation["metrics"]>(undefined);
  useEffect(() => {
    setAttemptMetrics(undefined);
    if (!attempt || !attempt.valid) return;
    let live = true;
    api.evaluate(floorName, attempt.changes).then((r) => { if (live) setAttemptMetrics(r.metrics); }).catch(() => {});
    return () => { live = false; };
  }, [attempt, floorName]);
  const metrics = attempt ? attemptMetrics : (shown?.metrics ?? data?.metrics);
  useEffect(() => {
    if (attempt || metrics?.index == null) return;
    setHistory((h) => (h.length && h[h.length - 1].index === metrics.index && changes.length) ? h : [...h.slice(-39), { t: Date.now(), index: metrics.index! }]);
  }, [metrics]);
  const redCells = useMemo(() => (shown?.results ?? []).filter((r) => r.status === "fail").flatMap((r) => r.cells), [shown]);
  const editable = !attempt && tab !== "build";
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const loads: Load[] = shown?.results.find((r) => r.kind === "panel_load")?.data?.loads ?? [];
  const paths: Record<string, PathInfo> = shown?.results.find((r) => r.kind === "exit_reach")?.data?.paths ?? {};

  // Best spots: when an item type is picked for placing, or an item is selected.
  useEffect(() => {
    if (!data || tab === "build" || attempt) { setSuggestion(null); return; }
    let body: Parameters<typeof api.suggest>[0] | null = null;
    if (placing) body = { floor: floorName, changes, type: placing.type, rotation: placing.rotation,
                          line: placeLine || null, panel: placePanel || null };
    else if (selected) body = { floor: floorName, changes, move_id: selected.id, rotation: selected.rotation };
    if (!body) { setSuggestion(null); setSugBusy(false); return; }
    const seq = ++sugSeq.current;
    setSugBusy(true);
    const t = setTimeout(() => {
      api.suggest(body!).then((r) => { if (seq === sugSeq.current) setSuggestion(r); })
        .catch((e) => { if (seq === sugSeq.current) { setSuggestion(null); setMessage(String(e)); } })
        .finally(() => { if (seq === sugSeq.current) setSugBusy(false); });
    }, 220);
    return () => clearTimeout(t);
  }, [placing, placeLine, placePanel, selected?.id, selected?.rotation, changes, floorName, tab, attempt, data]);

  useEffect(() => {
    if (tab !== "agent" || request.trim().length < 6) { setMemories([]); return; }
    const t = setTimeout(() => api.memory(floorName, request).then(setMemories).catch(() => setMemories([])), 350);
    return () => clearTimeout(t);
  }, [request, floorName, tab, run]);

  const push = useCallback((c: Change) => { setChanges((cs) => [...cs, c]); setMessage(null); }, []);
  const place = (x: number, y: number) => {
    if (!data || !placing) return;
    const c: Change = { op: "add", id: nextId(data.items, changes), type: placing.type, x, y, rotation: placing.rotation };
    if (placeLine) c.line = placeLine;
    if (placePanel) c.panel = placePanel;
    push(c);
  };
  const applyPick = (pk: Pick) => {
    if (!data || !pk.passed) return;
    const ch = pk.change as any;
    push(ch.op === "add" ? { ...ch, id: nextId(data.items, changes) } : ch);
  };
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
    setTab("agent"); setViewAttempt(null); setPlacing(null);
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

  // Floor builder
  const startBuild = async (edit: boolean) => {
    setPlacing(null); setSelectedId(null); setSuggestion(null);
    if (edit) {
      try { setSpecState(await api.floorSpec(floorName)); setEditing(floorName); }
      catch (e) { setMessage(String(e)); return; }
    } else { setSpecState(blankSpec()); setEditing(null); }
    build.setTool(edit ? null : "aisle");
    setTab("build");
  };
  const saveBuild = async () => {
    setBusy(editing ? "Rebuilding the floor graph and re-checking" : "Building the floor graph");
    try {
      const sp = { ...spec, items: (spec.items ?? []).filter((i) => i.x < build.cols && i.y < build.rows) };
      const r = editing ? await api.editFloor(editing, sp) : await api.createFloor(sp);
      await refreshStatus();
      setTab("manual"); setEditing(null);
      if (r.name === floorName) setData(r.floor); else setFloorName(r.name);
      setMessage(r.floor.passed ? `Floor ${r.name} saved. Every check passes.` : `Floor ${r.name} saved. Failing: ${r.floor.failed.join(", ")}.`);
    } catch (e) { setMessage(String(e)); } finally { setBusy(null); }
  };
  const deleteFloor = async () => {
    if (!window.confirm(`Delete the custom floor ${floorName}? This removes it from floorproof.rl and packs/custom.`)) return;
    try { await api.deleteFloor(floorName); await refreshStatus(); setFloorName("factory"); }
    catch (e) { setMessage(String(e)); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || tab === "build") return;
      if (e.key === "Escape") { setPlacing(null); setSelectedId(null); }
      if (e.key.toLowerCase() === "r") placing ? setPlacing({ ...placing, rotation: (placing.rotation + 90) % 360 }) : rotate();
      if (e.key === "Delete" || e.key === "Backspace") remove();
      if (e.key.toLowerCase() === "z" && (e.ctrlKey || e.metaKey)) undoStep();
      if (/^[1-9]$/.test(e.key) && suggestion) {
        const pk = suggestion.picks.find((p) => p.rank === Number(e.key));
        if (pk) applyPick(pk);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // What the 3D view draws: the floor and draft, or the floor being built.
  const buildItems: Item[] = useMemo(() => {
    if (tab !== "build" || !data) return [];
    const byType = Object.fromEntries(data.item_types.map((t) => [t.name, t]));
    return (spec.items ?? []).filter((i) => byType[i.type]).map((i) => {
      const [w, d] = size(byType[i.type], i.rotation);
      return { ...i, w, d, h: byType[i.type].h, work: null };
    });
  }, [tab, spec.items, data]);

  if (!data) return <div className="loading"><div className="spinner" />{message ?? "Loading floor from floorproof.rl ..."}</div>;

  const results = shown?.results ?? [];
  const nPass = results.filter((r) => r.status === "pass").length;
  const nFail = results.filter((r) => r.status === "fail").length;
  const nSkip = results.filter((r) => r.status === "skipped").length;
  const walks = Object.values(paths).map((p) => p.m);
  const maxWalk = walks.length ? Math.max(...walks) : 0;
  const mainLoad = loads.filter((l) => l.kind === "main_breaker").map((l) => l.kw / l.limit_kw)[0];
  const floorRow = status?.floors.find((f) => f.name === floorName);
  const building = tab === "build";

  return (
    <div className="app">
      <header>
        <div className="brand"><span className="logo">◆</span><h1>FLOOR<b>PROOF</b></h1></div>
        <span className="tag">The AI suggests, the graph proves.</span>
        <select value={floorName} onChange={(e) => setFloorName(e.target.value)} disabled={building}>
          {status?.floors.map((f: FloorRow) => <option key={f.name} value={f.name}>{f.custom ? "★ " : ""}{f.label} · {f.pack}</option>)}
        </select>
        {!building && <button className="neon" onClick={() => startBuild(false)}>+ New floor</button>}
        {!building && floorRow?.custom && <><button onClick={() => startBuild(true)}>Edit floor</button>
          <button className="danger" onClick={deleteFloor}>Delete</button></>}
        <span className="store">Relate store: {status?.store} ({status?.storage})</span>
        <span className={`llm ${status?.llm.live ? "live" : "replay"}`}>
          {status?.llm.live ? `● ${status.llm.model}` : "○ replay only (no API key)"}
        </span>
      </header>

      <aside className="left">
        {building ? (
          <BuilderPanel spec={spec} setSpec={setSpec} build={build} editing={editing} busy={!!busy} current={data}
                        onSave={saveBuild} onCancel={() => { setTab("manual"); setEditing(null); }} />
        ) : (
          <>
            <div className="tabs">
              <button className={tab === "manual" ? "on" : ""} onClick={() => setTab("manual")}>Manual edit</button>
              <button className={tab === "agent" ? "on" : ""} onClick={() => setTab("agent")}>Ask the agent</button>
            </div>
            {tab === "manual" ? (
              <>
                <div className="section-head">
                  <h3>Items</h3>
                  <button className="neon small" onClick={() => setMaker(!maker)}>{maker ? "Close" : "+ Describe a new item"}</button>
                </div>
                {maker && <ItemMaker floor={floorName} cell={data.floor.cell_m} live={!!status?.llm.live} model={status?.llm.model ?? ""}
                                     onClose={() => setMaker(false)}
                                     onSaved={(fd, t) => { setData(fd); setMaker(false); setPlacing({ type: t.name, rotation: 0 });
                                                           setMessage(`Saved ${t.label}. Pick a glowing spot or click the floor to place it.`); }} />}
                <p className="hint">Pick one, then click the floor or a numbered best spot. R rotates. Drag to move. Delete removes.</p>
                <div className="palette">
                  {data.item_types.map((t) => (
                    <button key={t.name} className={placing?.type === t.name ? "on" : ""} style={{ ["--c" as any]: t.color }}
                            onClick={() => { setSelectedId(null); setPlacing(placing?.type === t.name ? null : { type: t.name, rotation: 0 }); }}>
                      <i>{GLYPH[shapeOf(t)] ?? "▢"}</i>
                      <span>{t.label}{t.custom && <em className="badge">custom</em>}</span>
                      <small>{t.w * data.floor.cell_m}×{t.d * data.floor.cell_m} m{t.kw ? ` · ${t.kw} kW` : ""}{t.heat ? " · hot" : ""}</small>
                    </button>
                  ))}
                </div>
                {placing && (
                  <div className="placeopts card">
                    <label>Rotation <b>{placing.rotation}°</b> <small>(R)</small></label>
                    {data.lines.length > 0 && (
                      <label>Line <select value={placeLine} onChange={(e) => setPlaceLine(e.target.value)}>
                        <option value="">none</option>{data.lines.map((l) => <option key={l.name}>{l.name}</option>)}
                      </select></label>)}
                    {data.panels.length > 0 && (
                      <label>Plug into <select value={placePanel} onChange={(e) => setPlacePanel(e.target.value)}>
                        <option value="">best drop box</option>
                        {data.panels.filter((p) => p.kind === "drop_box").map((p) => <option key={p.name}>{p.name}</option>)}
                      </select></label>)}
                  </div>
                )}
                {selected && !placing && (
                  <div className="selected card">
                    <h3>{selected.id} <small>{data.item_types.find((t) => t.name === selected.type)?.label}</small></h3>
                    <p>At ({selected.x}, {selected.y}), {selected.rotation}°{selected.line ? `, line ${selected.line}` : ""}{selected.panel ? `, on ${selected.panel}` : ""}.
                      {paths[selected.id] ? ` Walk to exit ${paths[selected.id].exit}: ${paths[selected.id].m.toFixed(1)} m.` : ""}</p>
                    <button onClick={rotate}>Rotate</button> <button onClick={remove}>Remove</button>
                  </div>
                )}
                {(placing || selected) && <Picks s={suggestion} busy={sugBusy} moving={!placing} onPick={applyPick} />}
                <h3>Draft <small>{changes.length} change{changes.length === 1 ? "" : "s"}, not saved</small></h3>
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
                <button id="run-agent" className="primary" disabled={!!busy || !request.trim()} onClick={() => runAgent(false)}>Propose layouts</button>
                <MemoryList memories={memories} used={run?.memory} />
                {run && <Attempts run={run} view={viewAttempt} onView={setViewAttempt} onAccept={acceptAttempt} />}
              </>
            )}
          </>
        )}
      </aside>

      <main>
        {!building && (
          <div className="center-switch">
            <button className={center === "floor" ? "on" : ""} onClick={() => setCenter("floor")}>3D floor</button>
            <button className={center === "graph" ? "on" : ""} onClick={() => setCenter("graph")}>Graph explorer <small>Relate in browser</small></button>
          </div>
        )}
        {center === "graph" && !building && (
          <Suspense fallback={<div className="ex-loading"><div className="spinner dark" />Loading Relate (WebAssembly) ...</div>}>
            <Explorer floor={floorName} itemId={selectedId ?? data.items[0]?.id ?? null} request={explorerReq} onRequestDone={() => setExplorerReq(null)} />
          </Suspense>
        )}
        <div className={center === "graph" && !building ? "hidden" : "floor-wrap"}>
        <Floor3D floor={building ? { cols: build.cols, rows: build.rows, cell_m: CELL } : data.floor}
                 itemTypes={data.item_types}
                 zones={building ? spec.zones : data.zones} exits={building ? spec.exits : data.exits}
                 panels={building ? spec.panels : data.panels} items={building ? buildItems : items}
                 changedIds={building ? new Set() : changedIds} selectedId={building ? null : selectedId}
                 placing={editable ? placing : null} redCells={building ? [] : redCells} editable={editable}
                 loads={building ? [] : loads} paths={building ? {} : paths}
                 showPaths={showPaths} showPower={showPower} showHeat={showHeat} suggestion={building ? null : suggestion}
                 routes={building ? null : metrics?.routes} crowd={building ? null : metrics?.crowd}
                 showLine={layers.line} showFlow={layers.flow} showCrowd={layers.crowd}
                 build={building ? build.hooks : undefined}
                 onSelect={(id) => { setSelectedId(id); if (id) setPlacing(null); }} onPlace={place}
                 onMove={(id, x, y) => push({ op: "move", id, x, y })} onHover={setHover} onPick={applyPick} />
        </div>
        {!building && center === "floor" && (
          <div className="hud">
            <div className={`proof ${shown?.passed ? "ok" : "bad"}`}>
              <Ring pass={nPass} fail={nFail} skip={nSkip} />
              <div><b>{shown?.passed ? "PROVEN" : `${nFail} RULE${nFail === 1 ? "" : "S"} BROKEN`}</b>
                <small>{nPass} pass · {nFail} fail · {nSkip} not checked · {shown?.ms?.toFixed(0)} ms</small></div>
            </div>
            <div className="stat"><small>items</small><b>{items.length}</b></div>
            <div className="stat"><small>longest walk</small><b>{maxWalk.toFixed(1)} m</b></div>
            {metrics?.index != null && <div className="stat eff-stat"><small>efficiency</small><b>{metrics.index}</b></div>}
            {mainLoad !== undefined && <div className={`stat ${mainLoad > 1 ? "bad" : mainLoad > 0.85 ? "warn" : ""}`}><small>main load</small><b>{Math.round(mainLoad * 100)}%</b></div>}
          </div>
        )}
        {!building && center === "floor" && (
          <div className="toggles">
            <button className={showHeat ? "on" : ""} onClick={() => setShowHeat(!showHeat)}>▦ Best-spot map</button>
            <button className={showPaths ? "on" : ""} onClick={() => setShowPaths(!showPaths)}>⇢ Exit paths</button>
            <button className={showPower ? "on" : ""} onClick={() => setShowPower(!showPower)}>⚡ Power links</button>
            <button className={layers.line ? "on" : ""} onClick={() => toggleLayer("line")}><i className="sw" style={{ background: "#eb6834" }} />Line routes</button>
            <button className={layers.flow ? "on" : ""} onClick={() => toggleLayer("flow")}><i className="sw" style={{ background: "#6250d6" }} />Material flow</button>
            <button className={layers.crowd ? "on" : ""} onClick={() => toggleLayer("crowd")}><i className="sw" style={{ background: "#c2410c" }} />Crowding</button>
          </div>
        )}
        {building && <div className="hud build-hud"><b>BUILD MODE</b><small>{build.cols} × {build.rows} cells · {spec.width_m} × {spec.depth_m} m</small></div>}
        {hover && <div className="hover">{hover}</div>}
        {attempt && <div className="banner">Viewing attempt {attempt.round}.{attempt.index} ({attempt.passed ? "proven" : "rejected"})
          <button onClick={() => setViewAttempt(null)}>Back to floor</button></div>}
        {busy && <div className="busy"><div className="spinner" />{busy} ...</div>}
        {message && <div className="message" onClick={() => setMessage(null)}>{message}</div>}
        <div className="note">{building ? "Custom floor drawn by you." : data.floor.data_note} Planning aid only, not a certified safety tool.</div>
      </main>

      <aside className="right">
        {building ? (
          <>
            <h3>Rules on this floor</h3>
            <p className="hint">Every custom floor gets these checks. They run on the graph as soon as you save.</p>
            {["No overlap", "Exit reach (OSHA 1910.37)", "Exit distance (IBC 1017.2 or your number)", "Aisle width 0.711 m (OSHA 1910.36)",
              ...(spec.zones.some((z) => z.kind === "forklift_aisle") ? ["Forklift aisle width (TBD or your number)"] : []),
              ...(spec.panels.length ? ["Panel load 80% at every level (NEC 210.20(A))"] : []),
              ...(spec.lines.length ? ["Line flow"] : [])].map((r) => <div key={r} className="check skipped"><b>{r}</b></div>)}
          </>
        ) : (
          <>
            <div className="tabs right-tabs">
              <button className={rightTab === "efficiency" ? "on" : ""} onClick={() => setRightTab("efficiency")}>Efficiency</button>
              <button className={rightTab === "rules" ? "on" : ""} onClick={() => setRightTab("rules")}>
                Safety rules {shown?.passed ? <span className="pill ok">✓</span> : <span className="pill bad">{nFail}</span>}</button>
            </div>
          </>
        )}
        {!building && rightTab === "efficiency" && (
          <>
            {attempt && <p className="hint">Attempt {attempt.round}.{attempt.index} compared with the saved floor.</p>}
            <Efficiency m={metrics} base={data.metrics} history={history} layers={layers} onLayer={toggleLayer} />
          </>)}
        {!building && rightTab === "rules" && (
          <>
            <h3>Checks {shown?.passed ? <span className="ok">all pass</span> : <span className="bad">failed</span>}
              <small> {shown?.ms?.toFixed(0)} ms</small></h3>
            {shown && shown.valid === false && <p className="bad">Invalid layout: {shown.error}</p>}
            {shown?.results.map((r) => <CheckRow key={r.rule_id} r={r} onExplore={openInExplorer} />)}
            {loads.length > 0 && <LoadBars loads={loads} />}
          </>
        )}
      </aside>
    </div>
  );
}

function Ring({ pass, fail, skip }: { pass: number; fail: number; skip: number }) {
  const total = Math.max(pass + fail + skip, 1), r = 18, C = 2 * Math.PI * r;
  const seg = (n: number) => (n / total) * C;
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" className="ring">
      <circle cx="23" cy="23" r={r} className="track" />
      <circle cx="23" cy="23" r={r} className="pass" strokeDasharray={`${seg(pass)} ${C}`} />
      <circle cx="23" cy="23" r={r} className="fail" strokeDasharray={`${seg(fail)} ${C}`} strokeDashoffset={-seg(pass)} />
      <circle cx="23" cy="23" r={r} className="skip" strokeDasharray={`${seg(skip)} ${C}`} strokeDashoffset={-seg(pass + fail)} />
      <text x="23" y="27" textAnchor="middle">{pass}/{total}</text>
    </svg>
  );
}

function Picks({ s, busy, moving, onPick }: { s: Suggestion | null; busy: boolean; moving: boolean; onPick: (p: Pick) => void }) {
  const reasons: Record<string, string> = { blocked_cells: "taken", aisle: "in an aisle", no_exit: "no free work spot",
                                            too_far: "too far from exits", power: "no power headroom", line: "behind the line" };
  return (
    <div className="picks card">
      <div className="card-head"><b>{moving ? "Better spots" : "Best spots"}</b>
        <small>{busy ? "scanning and proving ..." : s ? `${s.counts.fits} fit · ${s.ms.toFixed(0)} ms` : ""}</small></div>
      {busy && !s && <div className="scanbar" />}
      {s && s.picks.length === 0 && (
        <p className="bad">No spot fits. Blocked: {Object.entries(s.counts).filter(([k, v]) => k !== "fits" && v > 0)
          .map(([k, v]) => `${v} ${reasons[k] ?? k}`).join(", ")}.</p>)}
      {s?.picks.map((p) => (
        <div key={p.rank} className={`pick ${p.passed ? "pass" : "fail"}`} onClick={() => onPick(p)}>
          <span className="rank">{p.rank}</span>
          <div>
            <b>({p.x}, {p.y}) {p.passed ? "proven ✓" : `fails ${p.failed.join(", ")}`}</b>
            <small>{p.why.join(" · ")}</small>
          </div>
          <span className="score" style={{ ["--s" as any]: p.score }}>{Math.round(p.score * 100)}</span>
        </div>
      ))}
      {s && s.picks.length > 0 && <p className="hint">The map is a quick scan. Each numbered pick was proven by the full graph checks in a rolled-back draft. Press its number to use it.</p>}
    </div>
  );
}

function MemoryList({ memories, used }: { memories: Memory[]; used?: Memory[] }) {
  if (!memories.length && !used?.length) return null;
  return (
    <div className="card memory">
      <div className="card-head"><b>Agent memory</b><small>Relate vector search</small></div>
      {used && used.length > 0 && <p className="hint">The last run gave the agent {used.length} proven layout{used.length === 1 ? "" : "s"} from similar requests as hints.</p>}
      {memories.length > 0 && <p className="hint">Proven layouts for similar past requests on this floor:</p>}
      {memories.map((m) => (
        <div key={m.id} className="mem">
          <span className="score">{Math.round(m.score * 100)}%</span>
          <div><b>{m.request}</b><small>{m.status} · {m.changes?.length ?? 0} changes{m.note ? ` · ${m.note}` : ""}</small></div>
        </div>
      ))}
    </div>
  );
}

function CheckRow({ r, onExplore }: { r: CheckResult; onExplore: (q: QueryTrace) => void }) {
  const [open, setOpen] = useState(false);
  const icon = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "–";
  const qs = r.queries ?? [];
  const engine = qs.reduce((a, q) => a + q.ms, 0);
  return (
    <div className={`check ${r.status}`}>
      <div><b>{icon} {r.title}</b> <small>{r.rule_id} · {r.ms.toFixed(0)} ms</small></div>
      <div className="detail">{r.status === "skipped" ? `Not checked: ${r.detail}` : r.detail}</div>
      <div className="src">{r.source_url ? <a href={r.source_url} target="_blank" rel="noreferrer">{r.source_note}</a> : r.source_note}</div>
      {qs.length > 0 && (
        <button className="qtoggle" onClick={() => setOpen(!open)}>
          {open ? "▾" : "▸"} {qs.length} graph quer{qs.length === 1 ? "y" : "ies"} · {engine.toFixed(1)} ms inside Relate</button>)}
      {open && qs.map((q, i) => (
        <div key={i} className="query">
          <pre>{q.cypher}</pre>
          <div className="qmeta">
            <span>{q.rows} row{q.rows === 1 ? "" : "s"}</span>
            <span>parse {q.parse_ms} · plan {q.plan_ms} · run {q.execute_ms} ms</span>
            {q.notices.map((n) => <span key={n} className="notice">{n.split(".").pop()}</span>)}
            {q.params && <button className="small" onClick={() => onExplore(q)}>Run in browser</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadBars({ loads }: { loads: Load[] }) {
  return (
    <div className="loads">
      <h3>Power load <small>(limit = 80% of rating)</small></h3>
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
