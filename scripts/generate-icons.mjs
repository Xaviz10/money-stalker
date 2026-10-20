import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

// Rasterize the existing vector companion; no network or private data required.
const svg = await readFile(new URL("../public/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROME_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH }
    : {}),
});
try {
  for (const [filename, size, maskable] of [
    ["apple-touch-icon.png", 180, true],
    ["icon-192.png", 192, false],
    ["icon-512.png", 512, false],
    ["icon-maskable-512.png", 512, true],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${maskable ? svg.replace('rx="112"', 'rx="0"').replace('translate(328 352)', 'translate(300 320)') : svg}`);
    await page.locator("svg").screenshot({ path: new URL(`../public/${filename}`, import.meta.url).pathname, omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
