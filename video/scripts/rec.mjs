// Screen-recording helpers for the demo video: real FloorProof UI, driven by puppeteer.
// Frames come from Chrome's screencast (CDP) and are turned into a 30 fps mp4 with ffmpeg.
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const BASE = process.env.FP_BASE ?? "http://127.0.0.1:8011";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A visible cursor with a click ripple (screencasts do not include the OS cursor).
const CURSOR = `
(() => {
  const install = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div'); c.id = '__cur';
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M4 2 L4 22 L9.5 17 L13 25 L16.5 23.5 L13 15.8 L20 15.8 Z" fill="#0f172a" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, {position:'fixed', left:'0px', top:'0px', zIndex: 2147483647, pointerEvents:'none', transform:'translate(-4px,-2px)', filter:'drop-shadow(0 2px 3px rgba(0,0,0,.35))', transition:'transform .08s'});
    document.body.appendChild(c);
    const move = (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('mousedown', (e) => {
      c.style.transform = 'translate(-4px,-2px) scale(.86)';
      const r = document.createElement('div');
      Object.assign(r.style, {position:'fixed', left:(e.clientX-18)+'px', top:(e.clientY-18)+'px', width:'36px', height:'36px', borderRadius:'50%', border:'3px solid rgba(29,78,216,.85)', zIndex:2147483646, pointerEvents:'none', transition:'transform .45s ease-out, opacity .45s ease-out'});
      document.body.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.9)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 500);
    }, true);
    window.addEventListener('mouseup', () => { c.style.transform = 'translate(-4px,-2px)'; }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();`;

export async function launch({ headless = true } = {}) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: headless ? "new" : false,
    args: ["--window-size=1536,864", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=d3d11",
           "--hide-scrollbars", "--force-device-scale-factor=1"],
    defaultViewport: { width: 1536, height: 864, deviceScaleFactor: 1.25 },
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(CURSOR);
  const cdp = await page.createCDPSession();
  return { browser, page, cdp, mouse: { x: 768, y: 432 } };
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Move the cursor smoothly to (x, y) in about ms milliseconds. */
export async function glide(s, x, y, ms = 700) {
  const { x: x0, y: y0 } = s.mouse;
  const n = Math.max(2, Math.round(ms / 16));
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n);
    await s.page.mouse.move(x0 + (x - x0) * t, y0 + (y - y0) * t);
    await sleep(16);
  }
  s.mouse = { x, y };
}

export async function click(s, x, y, ms = 650) {
  await glide(s, x, y, ms);
  await sleep(120);
  await s.page.mouse.down(); await sleep(90); await s.page.mouse.up();
}

/** Drag with the left button held (camera orbit or moving an item). */
export async function drag(s, x1, y1, ms = 1200, button = "left") {
  await s.page.mouse.down({ button });
  await glide(s, x1, y1, ms);
  await s.page.mouse.up({ button });
}

export async function centerOf(s, selector, index = 0) {
  const r = await s.page.evaluate((sel, i) => {
    const el = [...document.querySelectorAll(sel)][i];
    if (!el) return null;
    el.scrollIntoView({ block: "nearest" });
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, selector, index);
  if (!r) throw new Error(`not found: ${selector} #${index}`);
  return r;
}

export async function clickSel(s, selector, index = 0, ms = 650) {
  const p = await centerOf(s, selector, index);
  await click(s, p.x, p.y, ms);
}

/** Click a button by its visible text (first match containing the text). */
export async function clickText(s, text, scope = "button", ms = 650) {
  const i = await s.page.evaluate((t, sc) => [...document.querySelectorAll(sc)].findIndex((b) => b.textContent.includes(t)), text, scope);
  if (i < 0) throw new Error(`no ${scope} with text ${text}`);
  await clickSel(s, scope, i, ms);
}

/** Screen point of floor cell (x, y), from the app's window.__fpProject hook. */
export async function cell(s, x, y, h = 0) {
  return s.page.evaluate((a, b, c) => window.__fpProject(a, b, c), x, y, h);
}

export async function startRec(s, name, outDir) {
  outDir = path.resolve(outDir);
  const dir = path.join(outDir, "raw", name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  const onFrame = async (ev) => {
    const i = frames.length;
    const file = path.join(dir, `f${String(i).padStart(5, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(ev.data, "base64"));
    frames.push({ file, t: ev.metadata.timestamp });
    try { await s.cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }); } catch {}
  };
  s.cdp.on("Page.screencastFrame", onFrame);
  await s.cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  s.rec = { name, dir, frames, onFrame, outDir };
}

export async function stopRec(s, tailMs = 400) {
  await sleep(tailMs);
  await s.cdp.send("Page.stopScreencast");
  s.cdp.off("Page.screencastFrame", s.rec.onFrame);
  const { frames, dir, name, outDir } = s.rec;
  if (frames.length < 2) throw new Error(`no frames recorded for ${name}`);
  // Concat list with real frame durations, then resample to constant 30 fps.
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const d = i + 1 < frames.length ? Math.max(0.001, frames[i + 1].t - frames[i].t) : tailMs / 1000;
    lines.push(`file '${frames[i].file.replace(/\\/g, "/")}'`, `duration ${d.toFixed(4)}`);
  }
  lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, "/")}'`);
  const list = path.join(dir, "list.txt");
  fs.writeFileSync(list, lines.join("\n"));
  const out = path.join(outDir, `${name}.mp4`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p",
                          "-c:v", "libx264", "-crf", "16", "-preset", "medium", out]);
  const secs = frames[frames.length - 1].t - frames[0].t;
  console.log(`${name}: ${frames.length} frames over ${secs.toFixed(1)} s (${(frames.length / secs).toFixed(1)} fps captured) -> ${out}`);
  s.rec = null;
  return out;
}
