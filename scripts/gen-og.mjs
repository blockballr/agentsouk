import { ImageResponse } from "@vercel/og";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = "C:\Users\user\Desktop\agora";
const FONT_DIR = path.join(ROOT, "node_modules/@fontsource-variable");

const inter = await readFile(
  path.join(FONT_DIR, "inter/files/inter-latin-standard-normal.woff2"),
);
const fraunces = await readFile(
  path.join(FONT_DIR, "fraunces/files/fraunces-latin-standard-normal.woff2"),
);

const GREEN = "#2bee4b";
const INK = "#121613";
const BONE = "#fafffa";
const GRAY = "#516254";

const html = {
  type: "div",
  props: {
    style: {
      width: "1200px",
      height: "630px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      background: BONE,
      color: INK,
      fontFamily: "Inter",
      padding: "64px 72px",
      boxSizing: "border-box",
    },
    children: [
      {
        type: "div",
        props: {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: "28px",
          },
          children: [
            {
              type: "div",
              props: {
                style: {
                  fontFamily: "Inter",
                  fontSize: "22px",
                  fontWeight: 550,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: GRAY,
                },
                children: "AI agent marketplace · BNB smart chain",
              },
            },
            {
              type: "div",
              props: {
                style: {
                  fontFamily: "Fraunces",
                  fontSize: "104px",
                  fontWeight: 600,
                  lineHeight: 0.92,
                  letterSpacing: "-0.04em",
                  color: INK,
                  maxWidth: "1000px",
                },
                children: "The open market for agents that work.",
              },
            },
            {
              type: "div",
              props: {
                style: {
                  fontFamily: "Inter",
                  fontSize: "26px",
                  fontWeight: 400,
                  color: GRAY,
                  maxWidth: "900px",
                },
                children:
                  "Discover, compare, and hire ERC-8004 agents with x402 settlement.",
              },
            },
          ],
        },
      },
      {
        type: "div",
        props: {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          },
          children: [
            {
              type: "div",
              props: {
                style: {
                  fontFamily: "Fraunces",
                  fontSize: "44px",
                  fontWeight: 600,
                  letterSpacing: "-0.03em",
                },
                children: "Agora",
              },
            },
            {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  fontFamily: "Inter",
                  fontSize: "22px",
                  fontWeight: 550,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: INK,
                },
                children: [
                  {
                    type: "div",
                    props: {
                      style: {
                        width: "18px",
                        height: "18px",
                        borderRadius: "3px",
                        background: GREEN,
                      },
                    },
                  },
                  "x402 · on-chain",
                ],
              },
            },
          ],
        },
      },
    ],
  },
};

const image = new ImageResponse(html, {
  width: 1200,
  height: 630,
  fonts: [
    { name: "Inter", data: inter, weight: 400, style: "normal" },
    { name: "Inter", data: inter, weight: 550, style: "normal" },
    { name: "Fraunces", data: fraunces, weight: 600, style: "normal" },
  ],
});

const png = Buffer.from(await image.arrayBuffer());

for (const out of ["public/og.png", "apps/web/public/og.png"]) {
  const full = path.join(ROOT, out);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFileBuffer(full, png);
}

async function writeFileBuffer(p, data) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(p, data);
}

console.log("og.png written", png.length, "bytes");
