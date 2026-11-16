import { useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { api } from "./api";
import { Clock } from "./fx";
import { ItemModel, SHAPES } from "./models";
import type { FloorData, ItemDraft, ItemType } from "./types";

const BLANK: ItemDraft = { label: "", w_m: 1.5, d_m: 1, h_m: 1.2, kw: 0, heat: false, shape: "machine", color: "#5ad1ff", assumed: [] };

function Spin({ children }: { children: JSX.Element }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (g.current) g.current.rotation.y += dt * 0.6; });
  return <group ref={g}>{children}</group>;
}

export function Preview({ draft }: { draft: ItemDraft }) {
  const t: ItemType = { name: "preview", label: draft.label, w: 1, d: 1, h: draft.h_m, kw: draft.kw, heat: draft.heat,
                        color: draft.color, shape: draft.shape };
  const s = Math.max(draft.w_m, draft.d_m, draft.h_m);
  return (
    <div className="preview3d">
      <Canvas camera={{ position: [s * 1.3, s * 1.0, s * 1.5], fov: 40 }} dpr={[1, 2]}>
        <Clock />
        <ambientLight intensity={0.5} />
        <hemisphereLight args={["#6fd6ff", "#1a0f3a", 0.7]} />
        <directionalLight position={[3, 6, 4]} intensity={1.2} />
        <group position={[0, -draft.h_m / 2, 0]}>
          <Spin><ItemModel t={t} W={draft.w_m} D={draft.d_m} H={draft.h_m} /></Spin>
          <mesh rotation-x={-Math.PI / 2}><ringGeometry args={[s * 0.75, s * 0.8, 48]} />
            <meshBasicMaterial color="#5ad1ff" transparent opacity={0.6} /></mesh>
        </group>
      </Canvas>
    </div>
  );
}

export default function ItemMaker({ floor, cell, live, model, onSaved, onClose }: {
  floor: string; cell: number; live: boolean; model: string;
  onSaved: (data: FloorData, t: ItemType) => void; onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fill = async () => {
    setBusy(true); setErr(null);
    try { setDraft(await api.describe(text)); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.addItemType(floor, { ...draft, description: draft.description ?? text });
      onSaved(r.floor, r.item_type);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const set = <K extends keyof ItemDraft>(k: K, v: ItemDraft[K]) =>
    setDraft((d) => d && { ...d, [k]: v, assumed: (d.assumed ?? []).filter((a) => a !== k) });
  const guessed = (k: string) => draft?.assumed?.includes(k) ? "guess" : "";
  const num = (k: "w_m" | "d_m" | "h_m" | "kw", label: string, step = 0.1) => (
    <label className={guessed(k)}>{label}
      <input type="number" step={step} min={0} value={draft![k]} onChange={(e) => set(k, Number(e.target.value))} />
    </label>
  );

  return (
    <div className="maker card">
      <div className="card-head"><b>New item</b><button className="ghost" onClick={onClose}>×</button></div>
      <textarea rows={2} value={text} placeholder="Describe it, e.g. Industrial dryer, 2 x 1.5 m, 1.8 m tall, 6 kW"
                onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <button className="primary" disabled={busy || !text.trim()} onClick={fill}>
          {busy && !draft ? "Reading ..." : live ? "✦ Fill in with AI" : "✦ Fill in from text"}</button>
        <button onClick={() => setDraft({ ...BLANK, label: text.slice(0, 40) })}>Blank form</button>
      </div>
      {draft && (
        <>
          <Preview draft={draft} />
          <p className="hint">
            {draft.source === "model" ? `Filled in by ${draft.model ?? model}.` : draft.source === "parser" ? "Read from your text (no AI key)." : "Fill in the values."}
            {" "}Check every value. Values marked <span className="guess-tag">guess</span> were not in your text.
          </p>
          <div className="form">
            <label className="wide">Name <input value={draft.label} onChange={(e) => set("label", e.target.value)} /></label>
            {num("w_m", "Width m")}{num("d_m", "Depth m")}{num("h_m", "Height m")}{num("kw", "Power kW")}
            <label>Look <select value={draft.shape} onChange={(e) => set("shape", e.target.value)}>
              {SHAPES.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>Colour <input type="color" value={draft.color} onChange={(e) => set("color", e.target.value)} /></label>
            <label className="check-label"><input type="checkbox" checked={draft.heat} onChange={(e) => set("heat", e.target.checked)} /> Gets hot</label>
          </div>
          <p className="hint">On this floor it takes {Math.ceil(draft.w_m / cell - 1e-9)} × {Math.ceil(draft.d_m / cell - 1e-9)} cells
            ({cell} m grid). The operator stands at the front.</p>
          <button className="primary wide" disabled={busy || !draft.label.trim()} onClick={save}>Save item and place it</button>
        </>
      )}
      {err && <p className="bad">{err}</p>}
    </div>
  );
}
