// Visual tokens taken from the FloorProof app (frontend/src/styles.css): light surfaces, one blue accent,
// Orbitron for display, Inter for text, JetBrains Mono for numbers and code.
import { loadFont as loadOrbitron } from "@remotion/google-fonts/Orbitron";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

const orb = loadOrbitron("normal", { weights: ["600", "800"], subsets: ["latin"] });
const inter = loadInter("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });
const mono = loadMono("normal", { weights: ["500", "600"], subsets: ["latin"] });

export const FONTS = { display: orb.fontFamily, body: inter.fontFamily, mono: mono.fontFamily };

export const T = {
  bg: "#eef3f9", bg2: "#e3eaf3", panel: "#ffffff", panel2: "#f7f9fc",
  line: "#d5dde8", line2: "#b8c4d4",
  ink: "#0f172a", ink2: "#334155", muted: "#64748b",
  blue: "#1d4ed8", blue2: "#2a78d6", cyan: "#0e9fb8", violet: "#6250d6", orange: "#eb6834",
  ok: "#0f9d58", bad: "#d92d2b", amber: "#eda100",
  navy: "#0b1220",
} as const;

export const FPS = 30;
// The app screenshots and clips are 1920x1080 captures of a 1536x864 viewport at 1.25x.
export const SHOT_W = 1920;
export const SHOT_H = 1080;
