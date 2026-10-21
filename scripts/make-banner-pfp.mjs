// Renders the repo banner and the X profile picture from self-contained HTML,
// for the same reason as the OG image: librsvg ignores @font-face, Chrome does
// not. The banner keeps the composition it had in the light design, with the
// mark bleeding off the right edge, now in the dark register.
//
// Run: node scripts/make-banner-pfp.mjs
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const CANVAS = "#0b0e14";
const SURFACE = "#131722";
const INK = "#f2f6f1";
const MUTED = "#8a93a6";
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

const wash = `
background:
  radial-gradient(72% 78% at 14% 8%, rgba(2,50,71,.9), rgba(2,50,71,0) 72%),
  linear-gradient(117deg, rgba(2,50,71,.55), ${SURFACE} 58%, ${CANVAS});
background-color: ${CANVAS};`;

// Repo banner: 900x200, the README's own size. The mark on the right is the same
// mark at banner scale, cropped by the edge exactly as the light version was.
const banner = `<!doctype html><html><head><meta charset="utf-8"><style>${faces}
html,body{margin:0;width:900px;height:200px;overflow:hidden}
.frame{position:relative;width:900px;height:200px;padding-left:72px;display:flex;align-items:center;gap:26px;${wash}
  color:${INK};font-family:Inter,sans-serif;overflow:hidden}
.mark{display:grid;grid-template-columns:34px 34px;grid-template-rows:34px 34px;gap:5px;flex:none}
.mark i{border-radius:7px;background:${INK}}
.mark i.g{background:${DATA}}
h1{margin:0;font-family:Fraunces,serif;font-size:46px;font-weight:600;line-height:1;letter-spacing:-.04em;white-space:nowrap}
.o{position:relative}
.o span{position:absolute;left:15%;bottom:.065em;width:66%;height:.055em;background:${DATA}}
.tag{margin:9px 0 0;font-family:Mono,monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}}
.big{position:absolute;right:-43px;top:-14px;display:grid;
  grid-template-columns:108px 108px;grid-template-rows:108px 108px;gap:12px}
.big i{border-radius:20px;background:${INK}}
.big i.g{background:${DATA}}
</style></head><body><div class="frame">
  <div class="mark"><i></i><i></i><i></i><i class="g"></i></div>
  <div>
    <h1>Agent S<span class="o">o<span></span></span>uk</h1>
    <p class="tag">the open market for working agents</p>
  </div>
  <div class="big"><i></i><i></i><i></i><i class="g"></i></div>
</div></body></html>`;

// X profile picture: the mark alone, on the same wash, sized for a round crop.
const pfp = `<!doctype html><html><head><meta charset="utf-8"><style>${faces}
html,body{margin:0;width:1080px;height:1080px;overflow:hidden}
.frame{width:1080px;height:1080px;display:flex;align-items:center;justify-content:center;${wash}}
.mark{display:grid;grid-template-columns:300px 300px;grid-template-rows:300px 300px;gap:46px}
.mark i{border-radius:62px;background:${INK}}
.mark i.g{background:${DATA}}
</style></head><body><div class="frame">
  <div class="mark"><i></i><i></i><i></i><i class="g"></i></div>
</div></body></html>`;

const chrome = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));
if (!chrome) throw new Error("no chrome or edge found to render the art");

const dir = mkdtempSync(join(tmpdir(), "souk-brand-"));
try {
  for (const job of [
    { html: banner, w: 900, h: 200, out: `${ROOT}/brand/github-banner.png` },
    { html: pfp, w: 1080, h: 1080, out: `${ROOT}/brand/agent-souk-pfp.png` },
  ]) {
    const page = join(dir, "page.html");
    const shot = join(dir, "shot.png");
    writeFileSync(page, job.html);
    execFileSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        `--window-size=${job.w},${job.h}`,
        `--screenshot=${shot}`,
        `file:///${page.replace(/\\/g, "/")}`,
      ],
      { stdio: "ignore" }
    );
    await sharp(shot)
      .resize(job.w, job.h, { fit: "cover" })
      .png({ compressionLevel: 9 })
      .toFile(job.out);
    console.log("wrote", job.out);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
