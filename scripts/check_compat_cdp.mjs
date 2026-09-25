import WebSocket from "file:///C:/Users/linzihao/.workbuddy/binaries/node/workspace/node_modules/ws/index.js";
import { spawn } from "child_process";
import fs from "fs";

const IW = parseInt(process.argv[2] || "320", 10);
const PORT = 9360 + IW;
const FILE = "file:///C:/Users/linzihao/WorkBuddy/2026-09-13-15-54-06/ai-radar-repo/site/index.html";
const HOST = "file:///C:/Users/linzihao/WorkBuddy/2026-09-13-15-54-06/ai-radar-repo/_vp_host.html";
fs.writeFileSync("C:/Users/linzihao/WorkBuddy/2026-09-13-15-54-06/ai-radar-repo/_vp_host.html",
  `<!DOCTYPE html><html><body style="margin:0"><iframe id="f" src="${FILE}" style="width:${IW}px;height:2000px;border:0"></iframe></body></html>`);

const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", `--remote-debugging-port=${PORT}`,
   "--user-data-dir=C:/Users/linzihao/WorkBuddy/2026-09-13-15-54-06/ai-radar-repo/.chrome-tmp-cdp",
   "--no-first-run", "--disable-gpu", "--allow-file-access-from-files",
   `--window-size=${IW + 130},2100`, "about:blank"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 2500));
const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws = new WebSocket(tabs.find(t => t.type === "page").webSocketDebuggerUrl, { perMessageDeflate: false });
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.on("message", raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
await new Promise(r => ws.once("open", r));
await send("Page.enable");
await send("Page.navigate", { url: HOST });
await new Promise(r => setTimeout(r, 4500));

const expr = `(function () {
  var w = document.getElementById("f").contentWindow;
  var d = w.document;
  return new Promise(function (res) { setTimeout(function () {
    var out = { vw: w.innerWidth, docSW: d.documentElement.scrollWidth };
    var p = d.querySelector(".pager");
    if (p) { var r = p.getBoundingClientRect(); out.newsPagerRight = Math.round(r.right); }
    var tb = d.querySelector(".topbar-inner").getBoundingClientRect();
    out.topbarRight = Math.round(tb.right);
    out.docOverflowNews = d.documentElement.scrollWidth > w.innerWidth + 1;
    d.getElementById("tab-jobs").click();
    setTimeout(function () {
      var jp = d.querySelector(".pager");
      if (jp) out.jobsPagerRight = Math.round(jp.getBoundingClientRect().right);
      out.docOverflowJobs = d.documentElement.scrollWidth > w.innerWidth + 1;
      res(JSON.stringify(out));
    }, 700);
  }, 800); });
})()`;

const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
console.log(`@${IW}:`, r.result.value ?? JSON.stringify(r));
ws.close(); chrome.kill(); process.exit(0);
