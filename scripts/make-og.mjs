// Renders the OG card and the repo banner from self-contained HTML, because the
// SVG route (sharp + librsvg) ignores @font-face and falls back to a system sans.
// Chrome lays the real Fraunces and Inter, so the card matches the wordmark.
//
// Run: node scripts/make-og.mjs
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Palette read from apps/web/src/theme.css, dark register only.
const CANVAS = "#0b0e14";
const SURFACE = "#131722";
const INK = "#f2f6f1";
const SLATE = "#b8bcc8";
const MUTED = "#6b7180";
const DATA = "#44b48b";

function dataFont(path) {
  return `data:font/woff2;base64,${readFileSync(path).toString("base64")}`;
}

const fraunces = dataFont(
  `${ROOT}/node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2`
);
const inter = dataFont(
  `${ROOT}/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2`
);
const mono = dataFont(
  `${ROOT}/node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2`
);

const faces = `
@font-face{font-family:Fraunces;src:url(${fraunces}) format("woff2");font-weight:100 900}
@font-face{font-family:Inter;src:url(${inter}) format("woff2");font-weight:100 900}
@font-face{font-family:Mono;src:url(${mono}) format("woff2");font-weight:100 800}
*{box-sizing:border-box}`;

// The compare bar's wash in dark mode: half-strength deepsea over surface1,
// running to surface1 and then the canvas on the bar's 117 degree angle.
const wash = `
background:
  radial-gradient(72% 78% at 14% 8%, rgba(2,50,71,.9), rgba(2,50,71,0) 72%),
  linear-gradient(117deg, rgba(2,50,71,.55), ${SURFACE} 58%, ${CANVAS});
background-color: ${CANVAS};`;

// The big mark that bleeds off the right edge, as the light banner had it.
// Kept to ink and data so it reads as the same logo, not an illustration.
function bigMark({ tile, gap, right, top, radius }) {
  return `.big{position:absolute;right:${right}px;top:${top}px;display:grid;
  grid-template-columns:${tile}px ${tile}px;grid-template-rows:${tile}px ${tile}px;gap:${gap}px}
  .big i{border-radius:${radius}px;background:${INK}}
  .big i.g{background:${DATA}}`;
}

const og = `<!doctype html><html><head><meta charset="utf-8"><style>${faces}
html,body{margin:0;width:1280px;height:640px;overflow:hidden}
.frame{position:relative;width:1280px;height:640px;padding:0 96px;display:flex;align-items:center;gap:62px;${wash}
  color:${INK};font-family:Inter,sans-serif;overflow:hidden}
.mark{display:grid;grid-template-columns:65px 65px;grid-template-rows:65px 65px;gap:10px;flex:none}
.mark i{border-radius:14px;background:${INK}}
.mark i.g{background:${DATA}}
h1{margin:0;font-family:Fraunces,serif;font-size:100px;font-weight:600;line-height:.98;letter-spacing:-.04em;white-space:nowrap}
.o{position:relative}
.o span{position:absolute;left:15%;bottom:.065em;width:66%;height:.055em;background:${DATA}}
.tag{margin:22px 0 0;font-family:Mono,monospace;font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:#8a93a6}
.foot{position:absolute;left:96px;right:96px;bottom:44px;padding-top:20px;
  border-top:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;
  font-family:Mono,monospace;font-size:18px;color:${MUTED}}
${bigMark({ tile: 190, gap: 20, right: -76, top: 120, radius: 40 })}
</style></head><body><div class="frame">
  <div class="mark"><i></i><i></i><i></i><i class="g"></i></div>
  <div><h1>Agent S<span class="o">o<span></span></span>uk</h1><p class="tag">the open market for working agents</p></div>
  <div class="foot"><span>agentsouk.xyz</span><span>ERC-8004 / BNB Chain</span></div>
  <div class="big"><i></i><i></i><i></i><i class="g"></i></div>
</div></body></html>`;

const chrome = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));
if (!chrome) throw new Error("no chrome or edge found to render the card");

const dir = mkdtempSync(join(tmpdir(), "souk-og-"));
const page = join(dir, "og.html");
const shot = join(dir, "og.png");
try {
  writeFileSync(page, og);
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-size=1280,640",
      `--screenshot=${shot}`,
      `file:///${page.replace(/\\/g, "/")}`,
    ],
    { stdio: "ignore" }
  );
  const png = await sharp(shot).resize(1280, 640, { fit: "cover" }).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(`${ROOT}/apps/web/public/agent-souk-og.png`, png);
  writeFileSync(`${ROOT}/docs/brand/agent-souk-og.png`, png);
  console.log("wrote agent-souk-og.png");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
