// X banner, 1500x500. Same register and wash as the OG and the repo banner, but
// composed for the crop: the lockup sits left of centre so a phone's centred
// slice still holds it, and the big mark bleeds off the right where only the
// desktop crop sees it bleed.
//
// Run: node scripts/make-x-banner.mjs
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = "C:/Users/user/Desktop/agora-main";

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

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Fraunces;src:url(${fraunces}) format("woff2");font-weight:100 900}
@font-face{font-family:Inter;src:url(${inter}) format("woff2");font-weight:100 900}
@font-face{font-family:Mono;src:url(${mono}) format("woff2");font-weight:100 800}
*{box-sizing:border-box}
html,body{margin:0;width:1500px;height:500px;overflow:hidden}
.frame{position:relative;width:1500px;height:500px;display:flex;align-items:center;
  padding-left:272px;
  background:
    radial-gradient(58% 92% at 12% 6%, rgba(2,50,71,.92), rgba(2,50,71,0) 70%),
    linear-gradient(117deg, rgba(2,50,71,.55), ${SURFACE} 56%, ${CANVAS});
  background-color:${CANVAS};color:${INK};font-family:Inter,sans-serif;overflow:hidden}
.eyebrow{font-family:Mono,monospace;font-size:13px;letter-spacing:.22em;color:${MUTED};margin:0 0 20px}
.lockup{display:flex;align-items:center;gap:34px}
.mark{display:grid;grid-template-columns:56px 56px;grid-template-rows:56px 56px;gap:9px;flex:none}
.mark i{border-radius:12px;background:${INK}}
.mark i.g{background:${DATA}}
h1{margin:0;font-family:Fraunces,serif;font-size:92px;font-weight:600;line-height:.96;
  letter-spacing:-.04em;white-space:nowrap}
.o{position:relative;display:inline-block}
.o span{position:absolute;left:15%;bottom:.065em;width:66%;height:.055em;background:${DATA}}
.tag{margin:18px 0 0;font-size:26px;letter-spacing:-.01em;color:${SLATE}}
.big{position:absolute;right:-112px;top:29px;display:grid;
  grid-template-columns:210px 210px;grid-template-rows:210px 210px;gap:22px}
.big i{border-radius:44px;background:${INK}}
.big i.g{background:${DATA}}
</style></head><body><div class="frame">
  <div>
    <p class="eyebrow">ERC-8004 / BNB CHAIN</p>
    <div class="lockup">
      <div class="mark"><i></i><i></i><i></i><i class="g"></i></div>
      <div>
        <h1>Agent S<span class="o">o<span></span></span>uk</h1>
        <p class="tag">the open market for working agents</p>
      </div>
    </div>
  </div>
  <div class="big"><i></i><i></i><i></i><i class="g"></i></div>
</div></body></html>`;

const chrome = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));
if (!chrome) throw new Error("no chrome or edge found to render the banner");

const dir = mkdtempSync(join(tmpdir(), "souk-x-"));
const page = join(dir, "x.html");
const shot = join(dir, "x.png");
try {
  writeFileSync(page, html);
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-size=1500,500",
      `--screenshot=${shot}`,
      `file:///${page.replace(/\\/g, "/")}`,
    ],
    { stdio: "ignore" }
  );
  await sharp(shot)
    .resize(1500, 500, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toFile(`${ROOT}/brand/x-banner.png`);
  console.log("wrote brand/x-banner.png");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
