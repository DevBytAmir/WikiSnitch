#!/usr/bin/env node
// Renders the deck with headless Chrome (or Edge, or Chromium) into
//   WikiSnitch-deck.pdf   one 1920×1080 page per slide
//   thumbs/NN.png         one small picture per slide, for index.html
// No packages needed. Run after changing the slides:  node presentation/build.mjs
// Set CHROME=/path/to/browser if it is not found.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const browsers = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chrome = browsers.find((p) => existsSync(p));
if (!chrome) {
  console.error("No Chrome, Edge or Chromium found. Set CHROME=/path/to/browser and run again.");
  process.exit(1);
}

const page = join(here, "slides.html");
const url = pathToFileURL(page).href + "?render";
const count = (readFileSync(page, "utf8").match(/<section class="slide[\s"]/g) || []).length;
const profile = mkdtempSync(join(tmpdir(), "wikisnitch-deck-"));
const common = [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  "--allow-file-access-from-files",
  "--virtual-time-budget=5000",
  `--user-data-dir=${profile}`,
];

function run(args, what) {
  const r = spawnSync(chrome, [...common, ...args], { encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) {
    console.error(`${what} failed:\n${r.stderr || r.error}`);
    process.exit(1);
  }
}

const only = process.argv.includes("--thumbs") ? "thumbs" : process.argv.includes("--pdf") ? "pdf" : "all";

if (only !== "thumbs") {
  const pdf = join(here, "WikiSnitch-deck.pdf");
  run(["--no-pdf-header-footer", "--print-to-pdf-no-header", `--print-to-pdf=${pdf}`, url], "PDF");
  console.log(`WikiSnitch-deck.pdf  ${Math.round(statSync(pdf).size / 1024)} KB, ${count} slides`);
}

if (only !== "pdf") {
  const dir = join(here, "thumbs");
  mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= count; i++) {
    const out = join(dir, `${String(i).padStart(2, "0")}.png`);
    run(["--window-size=1920,1080", "--force-device-scale-factor=0.3333", `--screenshot=${out}`, `${url}#${i}`], `Slide ${i}`);
    process.stdout.write(`thumbs/${String(i).padStart(2, "0")}.png `);
  }
  console.log();
}

rmSync(profile, { recursive: true, force: true });
