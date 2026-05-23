/**
 * Open Graph image renderer (1200x630).
 *
 * Satori (JSX → SVG) + resvg-js (SVG → PNG). PNGs are cached on disk under
 * data/og/<sha1>.png so repeat renders are a single readFile.
 *
 * Visual language: daily.dev food-named palette (cabbage primary, cheese +
 * blueCheese + onion accents) + display monospace for hero numerals.
 *
 * Fonts loaded from public/fonts at startup. Static (non-variable) TTFs are
 * required because satori's opentype.js loader chokes on Inter's variable build.
 */

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { log } from "./logger";

const FONT_PATH = resolve(process.cwd(), "public/fonts/Inter-Bold.ttf");
const CACHE_DIR = resolve(process.cwd(), "data/og");
mkdirSync(CACHE_DIR, { recursive: true });

let fontBuffer: ArrayBuffer | null = null;
function loadFont(): ArrayBuffer {
  if (fontBuffer) return fontBuffer;
  if (!existsSync(FONT_PATH)) {
    throw new Error(`font missing at ${FONT_PATH}`);
  }
  const buf = readFileSync(FONT_PATH);
  fontBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return fontBuffer;
}

interface OgScene {
  kind: "trending" | "default";
  title: string;
  subtitle?: string;
  bigNumber?: string;
  smallNumber?: string;
  badge?: string;
  accent?: string;
}

function hashKey(scene: OgScene): string {
  return createHash("sha1").update(JSON.stringify(scene)).digest("hex").slice(0, 16);
}

// daily.dev food palette
const CABBAGE = "#ce3df3";
const CHEESE = "#ffe923";
const BLUECHEESE = "#2cdce6";
const ONION = "#7147ed";
const BACON = "#fc538d";
const BUN = "#ff8e3b";
const BG = "#0e1217";
const TEXT_PRIMARY = "#ffffff";
const TEXT_TERT = "#a8b3cf";

function tree(scene: OgScene): any {
  const accent = scene.accent ?? CABBAGE;

  return {
    type: "div",
    props: {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: BG,
        backgroundImage: `radial-gradient(circle at 12% -10%, ${CABBAGE}30, transparent 45%), radial-gradient(circle at 92% 110%, ${BLUECHEESE}20, transparent 45%), radial-gradient(circle at 82% 22%, ${CHEESE}15, transparent 35%)`,
        color: TEXT_PRIMARY,
        padding: "60px 72px",
        fontFamily: "Inter",
        position: "relative",
      },
      children: [
        // header bar
        {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", justifyContent: "space-between" },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontSize: 38,
                    fontWeight: 800,
                    letterSpacing: "-0.03em",
                    display: "flex",
                  },
                  children: [
                    { type: "span", props: { children: "daily." } },
                    { type: "span", props: { style: { color: accent }, children: "fresh" } },
                  ],
                },
              },
              scene.badge
                ? {
                    type: "div",
                    props: {
                      style: {
                        fontSize: 18,
                        padding: "10px 18px",
                        backgroundColor: `${accent}26`,
                        border: `2px solid ${accent}`,
                        color: accent,
                        borderRadius: 999,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      },
                      children: scene.badge,
                    },
                  }
                : null,
            ].filter(Boolean),
          },
        },

        // big body
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              flex: 1,
              justifyContent: "center",
              alignItems: "flex-start",
              textAlign: "left",
            },
            children: [
              scene.bigNumber
                ? {
                    type: "div",
                    props: {
                      style: {
                        display: "flex",
                        alignItems: "baseline",
                        fontSize: 240,
                        fontWeight: 800,
                        letterSpacing: "-0.06em",
                        color: accent,
                        lineHeight: 0.9,
                        marginBottom: 16,
                      },
                      children: [
                        scene.bigNumber,
                        scene.smallNumber
                          ? {
                              type: "span",
                              props: {
                                style: { color: TEXT_TERT, fontSize: 110, fontWeight: 700 },
                                children: `/${scene.smallNumber}`,
                              },
                            }
                          : null,
                      ].filter(Boolean),
                    },
                  }
                : null,
              {
                type: "div",
                props: {
                  style: {
                    fontSize: 60,
                    fontWeight: 800,
                    lineHeight: 1.05,
                    letterSpacing: "-0.025em",
                    color: TEXT_PRIMARY,
                    maxWidth: "92%",
                  },
                  children: scene.title,
                },
              },
              scene.subtitle
                ? {
                    type: "div",
                    props: {
                      style: {
                        marginTop: 20,
                        fontSize: 28,
                        color: TEXT_TERT,
                        lineHeight: 1.35,
                        maxWidth: "88%",
                      },
                      children: scene.subtitle,
                    },
                  }
                : null,
            ].filter(Boolean),
          },
        },

        // footer
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 22,
              color: TEXT_TERT,
            },
            children: [
              { type: "div", props: { children: "Built on the daily.dev Public API" } },
              { type: "div", props: { style: { color: accent, fontWeight: 700 }, children: "#dailydevhackathon" } },
            ],
          },
        },
      ],
    },
  };
}

export async function renderOg(scene: OgScene): Promise<Buffer> {
  const key = hashKey(scene);
  const cachePath = resolve(CACHE_DIR, `${key}.png`);
  if (existsSync(cachePath)) return readFileSync(cachePath);

  const start = Date.now();
  const font = loadFont();
  const svg = await satori(tree(scene), {
    width: 1200,
    height: 630,
    fonts: [{ name: "Inter", data: font, weight: 700, style: "normal" }],
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  writeFileSync(cachePath, png);
  log.info("og rendered", { key, kind: scene.kind, ms: Date.now() - start });
  return png;
}
