// Records the real FloorProof app for the demo video. Usage: node scripts/record.mjs [scene ...]
// Scenes run in an order that keeps the demo store consistent (spots and fail are drafts, the agent accepts).
import { BASE, cell, centerOf, click, clickSel, clickText, drag, glide, launch, sleep, startRec, stopRec } from "./rec.mjs";

const OUT = "public/clips";
const want = new Set(process.argv.slice(2));
const s = await launch();
const P = s.page;

async function open(url = "/") {
  await P.goto(BASE + url, { waitUntil: "networkidle0" });
  await P.waitForFunction(() => typeof window.__fpProject === "function", { timeout: 30000 });
  await sleep(1800);
}
const at = (x, y, h = 0) => cell(s, x, y, h);
const itemTop = async (x, y, w, d, h) => at(x + w / 2 - 0.5, y + d / 2 - 0.5, h);

async function still(name) {
  await P.evaluate(() => { const c = document.getElementById("__cur"); if (c) c.style.display = "none"; });
  await P.screenshot({ path: `public/shots/${name}.png` });
}

const scenes = {
  // Hero stills for the motion-graphics shots.
  async stills() {
    await open("/");
    await still("app-floor");
    await open("/?select=P1&layers=line,flow");
    await still("app-select");
  },

  async floor() {
    await open("/");
    await startRec(s, "floor", OUT);
    for (const [x, y, w, d, h] of [[8, 2, 3, 2, 1.2], [14, 9, 3, 2, 1.2], [34, 2, 6, 3, 0.9]]) {
      const p = await itemTop(x, y, w, d, h);
      await glide(s, p.x, p.y, 750);
      await sleep(550);
    }
    const a = await at(50, 30);
    await glide(s, a.x, a.y, 600);
    await drag(s, a.x + 260, a.y - 40, 2200);                  // orbit the camera
    await sleep(300);
    await clickText(s, "Exit paths");
    await sleep(900);
    const p1 = await itemTop(78, 26, 3, 3, 1.4);
    await click(s, p1.x, p1.y, 900);                            // select a press: path + power cable
    await sleep(2200);
    await stopRec(s);
  },

  async spots() {
    await open("/");
    await startRec(s, "spots", OUT);
    await clickText(s, "Pressing machine", ".palette button");
    await sleep(500);
    const sel = await centerOf(s, ".placeopts select", 0);
    await glide(s, sel.x, sel.y, 600);
    await P.select(".placeopts select", "B");
    await P.waitForSelector(".picks .pick", { timeout: 90000 });  // scan + proof of the picks
    await sleep(700);
    const pick = await centerOf(s, ".picks .pick", 0);
    await glide(s, pick.x, pick.y, 700);
    await sleep(700);
    const g = await at(30, 7);
    await glide(s, g.x, g.y, 900);                              // ghost over the floor
    await sleep(500);
    await P.keyboard.press("1");                                // use best pick 1
    await sleep(1600);
    await P.keyboard.press("Escape");
    const acc = await centerOf(s, ".actions .primary", 0);
    await glide(s, acc.x, acc.y, 800);
    await sleep(1400);
    await stopRec(s);
  },

  async fail() {
    await open("/?tab=rules");
    await startRec(s, "fail", OUT);
    await clickText(s, "Cutting table", ".palette button");
    await sleep(400);
    const a = await at(44, 19);
    await glide(s, a.x, a.y, 900);
    await sleep(500);
    const b = await at(50, 19);
    await glide(s, b.x, b.y, 700);
    await sleep(300);
    await click(s, b.x, b.y, 200);                               // drop it into the main aisle
    await P.keyboard.press("Escape");
    await sleep(1500);
    const acc = await centerOf(s, ".actions .primary", 0);
    await glide(s, acc.x, acc.y, 900);                          // Accept is disabled
    await sleep(1700);
    await stopRec(s);
  },

  async efficiency() {
    await open("/");
    await startRec(s, "efficiency", OUT);
    await clickText(s, "Line routes");
    await sleep(500);
    await clickText(s, "Material flow");
    await sleep(900);
    const r = await itemTop(87, 1, 4, 2, 2.2);
    await click(s, r.x, r.y, 900);                               // select fabric rack R1
    await P.waitForSelector(".picks .pick", { timeout: 90000 });
    await sleep(900);
    await P.keyboard.press("3");                                 // move it to pick 3
    await sleep(2000);
    const radar = await centerOf(s, ".radar", 0);
    await glide(s, radar.x + 40, radar.y - 20, 900);
    await sleep(500);
    await P.evaluate(() => document.querySelector("aside.right").scrollBy({ top: 520, behavior: "smooth" }));
    await sleep(2200);
    await stopRec(s);
  },

  async agent() {
    await open("/");
    await startRec(s, "agent", OUT);
    await clickText(s, "Ask the agent");
    await sleep(600);
    await clickText(s, "Add 4 pressing machines to Line B", ".hint a");
    await sleep(500);
    await clickSel(s, "#run-agent");
    await P.waitForFunction(() => document.querySelectorAll(".attempt").length > 0, { timeout: 120000 });
    await sleep(1500);
    const acc = await centerOf(s, ".attempt .primary", 0);
    await glide(s, acc.x, acc.y, 900);
    await sleep(400);
    await click(s, acc.x, acc.y, 150);                           // accept the proven layout
    await sleep(1800);
    const ta = await centerOf(s, "textarea", 0);
    await click(s, ta.x, ta.y, 700);
    await P.keyboard.down("Control"); await P.keyboard.press("a"); await P.keyboard.up("Control");
    await P.keyboard.type("put two more presses on line B", { delay: 55 });
    await P.waitForSelector(".memory .mem", { timeout: 15000 });
    await sleep(600);
    const m = await centerOf(s, ".memory .mem", 0);
    await glide(s, m.x, m.y, 800);
    await sleep(2200);
    await stopRec(s);
  },

  async explorer() {
    await open("/");
    await startRec(s, "explorer", OUT);
    await clickText(s, "Graph explorer");
    await P.waitForFunction(() => !document.querySelector(".ex-loading"), { timeout: 60000 });
    await sleep(700);
    await clickText(s, "Walk from an item to its nearest exit", ".presets button");
    await sleep(1800);
    await clickText(s, "What plugs into each power unit", ".presets button");
    await sleep(1200);
    const c = await centerOf(s, ".ex-canvas", 0);
    await glide(s, c.x + 120, c.y - 40, 700);
    for (let i = 0; i < 4; i++) { await P.mouse.wheel({ deltaY: -120 }); await sleep(160); }
    await sleep(500);
    await clickText(s, "Power tree", ".presets button");
    await sleep(2000);
    await stopRec(s);
  },

  async builder() {
    await open("/");
    await startRec(s, "builder", OUT);
    await clickText(s, "+ New floor");
    await sleep(700);
    const id = await centerOf(s, ".builder input", 0);
    await click(s, id.x, id.y, 600);
    await P.keyboard.type("bakery-1", { delay: 45 });
    const ind = await centerOf(s, ".builder input", 2);
    await click(s, ind.x, ind.y, 500);
    await P.keyboard.type("Food", { delay: 45 });
    await clickText(s, "Area", ".tools button");
    const a0 = await at(4, 4), a1 = await at(24, 14);
    await glide(s, a0.x, a0.y, 600);
    await drag(s, a1.x, a1.y, 900);                             // draw an area
    await clickText(s, "Exit", ".tools button");
    const e = await at(59, 30);
    await click(s, e.x, e.y, 700);                               // a second exit on the east wall
    await clickText(s, "Main breaker", ".tools button");
    const mb = await at(56, 2);
    await click(s, mb.x, mb.y, 600);
    await clickText(s, "Drop box", ".tools button");
    const db = await at(30, 16);
    await click(s, db.x, db.y, 600);
    await sleep(400);
    await clickText(s, "Create floor and check it");
    await P.waitForFunction(() => document.querySelector("header select")?.value === "bakery-1" && document.querySelector(".hud .proof"), { timeout: 90000 });
    await sleep(800);
    await P.waitForFunction(() => typeof window.__fpProject === "function");
    await sleep(2600);
    await stopRec(s);
  },
};

for (const name of ["stills", "floor", "spots", "fail", "efficiency", "agent", "explorer", "builder"]) {
  if (want.size && !want.has(name)) continue;
  console.log("recording", name);
  await scenes[name]();
}
await s.browser.close();
