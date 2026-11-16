// Devpost images: 15 gallery cards (3:2, 1800x1200) + a cover (3:2, 1500x1000), written to ../docs/images.
// Each card is a lossless still of a scene from the demo video, framed with a title and a caption.
//   node scripts/gallery.mjs            (all)     node scripts/gallery.mjs 05 07   (some)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("../docs/images");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync("public/gallery", { recursive: true });
fs.mkdirSync("out/gallery-props", { recursive: true });

const CARDS = [
  ["01", "intro", 228, "FLOORPROOF", "AI floor planner where a Relate graph proves every layout", "01-floorproof"],
  ["02", "onefile", 150, "ONE GRAPH, ONE FILE", "Cells, machines, power, lines, rules and proposals in floorproof.rl", "02-one-file"],
  ["03", "model", 368, "RULES ARE GRAPH QUERIES", "Exit reach is a shortest path; power load walks the FED_BY tree", "03-rules-as-cypher"],
  ["04", "floor", 250, "THE 3D FLOOR", "Exit routes and power cables, read straight from the graph", "04-3d-floor"],
  ["05", "spots", 120, "BEST SPOTS", "Every numbered spot is proven by all checks in a rolled-back transaction", "05-best-spots"],
  ["06", "spots", 255, "PROVEN DRAFT", "The new press passes every check, so Accept unlocks", "06-proven-draft"],
  ["07", "fail", 205, "A BROKEN RULE TURNS RED", "Table in the main aisle: FP-AISLE fails and Accept stays locked", "07-rule-broken"],
  ["08", "efficiency", 245, "WORKER EFFICIENCY", "Walking, material flow, crowding and elbow room, measured on the graph", "08-efficiency"],
  ["09", "agent", 150, "THE AI AGENT", "Muse Spark proposes layouts; the graph decides which ones pass", "09-agent"],
  ["10", "agent", 268, "AGENT MEMORY", "Relate vector search recalls proven layouts from similar requests", "10-agent-memory"],
  ["11", "explorer", 140, "GRAPH EXPLORER", "Relate WebAssembly: Cypher runs inside the browser tab", "11-graph-explorer"],
  ["12", "builder", 70, "BUILD YOUR OWN FLOOR", "Draw exits, aisles and a power tree; the same checks run on it", "12-floor-builder"],
  ["13", "hub", 205, "ONE GRAPH, MANY WAYS IN", "Python + transactions, vector search, WebAssembly, MCP, CLI + skill", "13-relate-hub"],
  ["14", "mcp", 168, "RELATE MCP FOR AGENTS", "relate serve --mcp gives coding agents read_cypher on the same file", "14-mcp"],
  ["15", "results", 392, "MEASURED RESULTS", "18/20 unsafe blocked, 0 false alarms; 29/30 proven with the graph", "15-results"],
];

const want = new Set(process.argv.slice(2));
const run = (args) => execFileSync("npx", ["remotion", ...args], { stdio: ["ignore", "ignore", "inherit"], shell: true });

for (const [n, sec, frame, title, caption, file] of CARDS) {
  if (want.size && !want.has(n)) continue;
  const raw = `public/gallery/raw-${n}.png`;
  const APP = ["floor", "spots", "fail", "efficiency", "agent", "explorer", "builder"];
  run(["still", "src/index.ts", `${APP.includes(sec) ? "B" : "S"}-${sec}`, raw, `--frame=${frame}`]);
  const props = `out/gallery-props/${n}.json`;
  fs.writeFileSync(props, JSON.stringify({ img: `gallery/raw-${n}.png`, n, title, caption }));
  run(["still", "src/index.ts", "GalleryCard", path.join(OUT, `${file}.jpg`), `--props=${props}`, "--image-format=jpeg", "--jpeg-quality=90"]);
  console.log("card", n, file);
}
if (!want.size || want.has("cover")) {
  run(["still", "src/index.ts", "Cover", path.join(OUT, "cover.jpg"), "--image-format=jpeg", "--jpeg-quality=92"]);
  console.log("cover");
}
