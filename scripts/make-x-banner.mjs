// X header, 1500x500. This one is deliberately a different register from the
// OG and the repo banner: a light editorial masthead with a dark "green room"
// panel on the right. The lockup starts at 25% so the X avatar never sits on
// top of it on a phone, and the dark panel carries the mark on its own.
//
// Run: node scripts/make-x-banner.mjs
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const CANVAS = "#f7f8fa";
const INK = "#111a4a";
const SLATE = "#3f4a63";
const MUTED = "#5b6577";
const DATA_LIGHT = "#0f8f6a";
const DARK = "#0b0e14";
const BONE = "#f2f6f1";
const DATA_DARK = "#44b48b";

function dataFont(path) {
  return `data:font/woff2;base64,${readFileSync(path).toString("base64")}`;
}

const fraunces = dataFont(
  join(ROOT, "node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2")
);
const inter = dataFont(
  join(ROOT, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")
);
const mono = dataFont(
  join(ROOT, "node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2")
);

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Fraunces;src:url(${fraunces}) format("woff2");font-weight:100 900}
@font-face{font-family:Inter;src:url(${inter}) format("woff2");font-weight:100 900}
@font-face{font-family:Mono;src:url(${mono}) format("woff2");font-weight:100 800}
*{box-sizing:border-box}
html,body{margin:0;width:1500px;height:500px;overflow:hidden}
.frame{position:relative;width:1500px;height:500px;background:${CANVAS};color:${INK};font-family:Inter,sans-serif;overflow:hidden}
.left{position:absolute;left:0;top:0;width:1150px;height:500px}
.right{position:absolute;right:0;top:0;width:350px;height:500px;color:${BONE};overflow:hidden;
  background:
    radial-gradient(90% 120% at 10% 0%, rgba(2,50,71,.95), rgba(2,50,71,0) 65%),
    linear-gradient(160deg, #131722, ${DARK} 70%)}
.right .grid{position:absolute;inset:0;opacity:.6;
  background-image:linear-gradient(rgba(242,246,241,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(242,246,241,.05) 1px,transparent 1px);
  background-size:38px 38px}
.seam{position:absolute;left:1150px;top:0;width:1px;height:500px;background:rgba(17,26,74,.14)}
.accent{position:absolute;left:1149px;top:188px;width:3px;height:124px;background:${DATA_DARK}}
.margin{position:absolute;left:96px;top:56px;font-family:Mono,monospace;font-size:11px;letter-spacing:.2em;color:${MUTED}}
.margin-line{position:absolute;left:96px;top:100px;width:1px;height:300px;background:rgba(17,26,74,.14)}
.margin-text{position:absolute;left:82px;top:140px;writing-mode:vertical-rl;font-family:Mono,monospace;font-size:10px;letter-spacing:.24em;color:${MUTED};white-space:nowrap}
.eyebrow{position:absolute;left:375px;top:56px;font-family:Mono,monospace;font-size:11px;letter-spacing:.2em;color:${MUTED}}
.open{position:absolute;right:44px;top:48px;display:flex;align-items:center;gap:8px;padding:7px 12px;border:1px solid rgba(17,26,74,.16);border-radius:999px;font-family:Mono,monospace;font-size:10px;letter-spacing:.14em;color:${INK}}
.open i{width:6px;height:6px;border-radius:999px;background:${DATA_LIGHT};display:block}
.lockup{position:absolute;left:375px;top:132px;display:flex;align-items:center;gap:24px}
.mark{display:grid;grid-template-columns:34px 34px;grid-template-rows:34px 34px;gap:6px;flex:none}
.mark i{border-radius:8px;background:${INK}}
.mark i.g{background:${DATA_LIGHT}}
h1{margin:0;font-family:Fraunces,serif;font-size:92px;font-weight:600;line-height:.9;letter-spacing:-.04em;white-space:nowrap;color:${INK}}
.o{position:relative;display:inline-block}
.o span{position:absolute;left:15%;bottom:.065em;width:66%;height:.055em;background:${DATA_LIGHT}}
.tag{margin:0;position:absolute;left:375px;top:266px;font-size:26px;letter-spacing:-.01em;color:${SLATE}}
.rule{position:absolute;left:375px;top:352px;width:700px;height:1px;background:rgba(17,26,74,.14)}
.ticker{position:absolute;left:375px;top:378px;display:flex;align-items:center;gap:14px;font-family:Mono,monospace;font-size:10px;letter-spacing:.16em;color:${MUTED}}
.ticker b{width:4px;height:4px;border-radius:999px;background:${DATA_LIGHT};display:block}
.room{position:absolute;left:0;top:56px;width:350px;text-align:center;font-family:Mono,monospace;font-size:10px;letter-spacing:.22em;color:#8d93a3}
.big{position:absolute;left:75px;top:150px;display:grid;grid-template-columns:89px 89px;grid-template-rows:89px 89px;gap:22px}
.big i{border-radius:20px;background:${BONE}}
.big i.g{background:${DATA_DARK}}
.foot{position:absolute;left:0;bottom:44px;width:350px;text-align:center;font-family:Mono,monospace;font-size:9px;letter-spacing:.18em;color:#6b7180}
</style></head><body><div class="frame">
  <div class="left">
    <div class="margin">EST. 2026</div>
    <div class="margin-line"></div>
    <div class="margin-text">OPEN MARKET</div>
    <div class="eyebrow">ERC-8004 / BNB CHAIN</div>
    <div class="open"><i></i>OPEN</div>
    <div class="lockup">
      <div class="mark"><i></i><i></i><i></i><i class="g"></i></div>
      <h1>Agent S<span class="o">o<span></span></span>uk</h1>
    </div>
    <p class="tag">the open market for working agents</p>
    <div class="rule"></div>
    <div class="ticker"><span>RESEARCH</span><b></b><span>TRADING</span><b></b><span>AUDIT</span><b></b><span>OPS</span><b></b><span>SETTLEMENT</span></div>
  </div>
  <div class="right">
    <div class="grid"></div>
    <div class="room">THE GREEN ROOM</div>
    <div class="big"><i></i><i></i><i></i><i class="g"></i></div>
    <div class="foot">WORKING AGENTS / ONCHAIN</div>
  </div>
  <div class="seam"></div>
  <div class="accent"></div>
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
    .toFile(join(ROOT, "brand", "x-banner.png"));
  console.log("wrote brand/x-banner.png");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
