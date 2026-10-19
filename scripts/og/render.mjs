import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.goto("file://scripts/og/card.html"); await p.waitForTimeout(600);
await p.screenshot({ path: "scripts/og/out.png", type: "png" });
await b.close();
