// renders scripts/og/card.html to src/app/opengraph-image.png (1200x630). needs playwright-core and a chromium; set PW to a playwright-core entry if it is not installed here. then copy the result to twitter-image.png too.
// PW can point at a playwright-core entry outside this project, e.g. PW=/path/to/node_modules/playwright-core/index.mjs
const { chromium } = await import(process.env.PW ?? "playwright-core");
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.goto("file://" + process.cwd() + "/scripts/og/card.html"); await p.waitForTimeout(600);
await p.screenshot({ path: "src/app/opengraph-image.png", type: "png" });
await b.close();
