// Quick check: can headless Chrome record the WebGL floor smoothly?
import { BASE, launch, startRec, stopRec, glide, drag, sleep } from "./rec.mjs";
const s = await launch({ headless: process.argv[2] !== "head" });
await s.page.goto(BASE + "/", { waitUntil: "networkidle0" });
await sleep(2500);
await startRec(s, "probe", "public/clips");
await glide(s, 900, 500, 600);
await drag(s, 1200, 520, 1800);
await sleep(800);
await stopRec(s);
await s.browser.close();
