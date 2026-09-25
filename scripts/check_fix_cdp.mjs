import WebSocket from "file:///C:/Users/linzihao/.workbuddy/binaries/node/workspace/node_modules/ws/index.js";
import { spawn } from "child_process";

// 用 500px 窗口内嵌 W px iframe 验证移动布局（iframe 媒体查询按自身宽度生效）
const IW = process.argv[2] ? parseInt(process.argv[2]) : 390;
const PORT = 9340;
const FILE = "file:///C:/Users/linzihao/WorkBuddy/2026-09-13-15-54-06/ai-radar-repo/site/index.html";
const HOST = "file:///C:/Users/linzihao/WorkBuddy/2026-09-13-15-54-06/ai-radar-repo/_vp_host.html";

const fs = await import("fs");
fs.writeFileSync("C:/Users/linzihao/WorkBuddy/2026-09-13-15-54-06/ai-radar-repo/_vp_host.html",
  `<!DOCTYPE html><html><body style="margin:0"><iframe id="f" src="${FILE}" style="width:${IW}px;height:1600px;border:0"></iframe></body></html>`);

const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", `--remote-debugging-port=${PORT}`,
  "--user-data-dir=C:/Users/linzihao/WorkBuddy/2026-09-13-15-54-06/ai-radar-repo/.chrome-tmp-cdp",
  "--no-first-run", "--disable-gpu", "--allow-file-access-from-files", "--window-size=520,1700", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await sleep(2500);

const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws = new WebSocket(tabs.find(t => t.type === "page").webSocketDebuggerUrl, { perMessageDeflate: false });
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(res => {
  const mid = ++id; pending.set(mid, res);
  ws.send(JSON.stringify({ id: mid, method, params }));
});
ws.on("message", raw => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
await new Promise(r => ws.once("open", r));
await send("Page.enable");
await send("Page.navigate", { url: HOST });
await sleep(4500);

// 逐条岗位卡体检
const jobsExpr = `(() => {
  const w = document.getElementById('f').contentWindow;
  const d = w.document;
  const t = w.document.getElementById('tab-jobs');
  t.click();
  return new Promise(res => setTimeout(() => {
    const out = [];
    d.querySelectorAll('.job-card').forEach((card, i) => {
      const cr = card.getBoundingClientRect();
      const title = card.querySelector('.job-title');
      const tr = title ? title.getBoundingClientRect() : null;
      const salary = card.querySelector('.job-salary');
      const sr = salary ? salary.getBoundingClientRect() : null;
      const pill = card.querySelector('.cls-pill');
      const pr = pill ? pill.getBoundingClientRect() : null;
      // 标题行数：高度 / line-height
      const lh = title ? parseFloat(getComputedStyle(title).lineHeight) || parseFloat(getComputedStyle(title).fontSize) * 1.4 : 0;
      out.push({
        i,
        titleW: tr ? Math.round(tr.width) : null,
        titleH: tr ? Math.round(tr.height) : null,
        titleLines: tr && lh ? Math.round(tr.height / lh) : null,
        salaryOverflow: sr ? Math.round(Math.max(0, sr.right - cr.right)) : 0,
        salaryOverCard: (() => { if (!sr) return false; const c = card.getBoundingClientRect(); return sr.right > c.right + 1 || sr.left < c.left - 1; })(),
        pillH: pr ? Math.round(pr.height) : null,
        cardH: Math.round(cr.height),
      });
    });
    const de = d.documentElement;
    res(JSON.stringify({
      innerW: w.innerWidth,
      overflowX: de.scrollWidth > w.innerWidth + 1,
      jobCount: out.length,
      bad: out.filter(x => x.titleLines > 4 || x.salaryOverCard || (x.pillH && x.pillH > 24)),
      sample: out.slice(0, 4),
    }));
  }, 600));
})()`;

const r1 = await send("Runtime.evaluate", { expression: jobsExpr, returnByValue: true, awaitPromise: true });
console.log(`JOBS-${IW}:`, r1.result.value);

// 资讯卡 nc-head 高度 + 图片属性
const newsExpr = `(() => {
  const w = document.getElementById('f').contentWindow;
  const d = w.document;
  d.getElementById('tab-news').click();
  return new Promise(res => setTimeout(() => {
    let maxHead = 0, headBad = 0;
    d.querySelectorAll('.nc-head').forEach(h => { const r = h.getBoundingClientRect(); maxHead = Math.max(maxHead, r.height); if (r.height > 24) headBad++; });
    const imgs = [...d.querySelectorAll('.cover img')];
    const attrs = imgs.map(im => ({ lazy: im.getAttribute('loading'), dec: im.getAttribute('decoding'), wh: !!(im.getAttribute('width') && im.getAttribute('height')), fp: im.getAttribute('fetchpriority') || '' }));
    res(JSON.stringify({
      headMaxH: Math.round(maxHead), headBad,
      imgCount: imgs.length,
      firstAttrs: attrs[0] || null,
      allHaveWH: attrs.every(a => a.wh),
      allLazyOrEager: attrs.every(a => a.lazy === 'lazy' || a.lazy === 'eager'),
      eagerWithFp: attrs.filter(a => a.lazy === 'eager').every(a => a.fp === 'high'),
      newsOverflowX: d.documentElement.scrollWidth > w.innerWidth + 1,
    }));
  }, 600));
})()`;

const r2 = await send("Runtime.evaluate", { expression: newsExpr, returnByValue: true, awaitPromise: true });
console.log(`NEWS-${IW}:`, r2.result.value);

// 自查3：找出所有「父级 nowrap 且子元素 white-space:nowrap」的 flex 容器
const auditExpr = `(() => {
  const w = document.getElementById('f').contentWindow;
  const d = w.document;
  const bad = [];
  d.querySelectorAll('*').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.display.includes('flex') && cs.flexWrap === 'nowrap') {
      [...el.children].some(ch => {
        const ccs = getComputedStyle(ch);
        if (ccs.whiteSpace === 'nowrap' && ccs.flexShrink !== '0') {
          bad.push(el.className ? el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ' > ' + ch.tagName.toLowerCase() + '.' + String(ch.className).split(' ')[0] : el.tagName);
          return true;
        }
        return false;
      });
    }
  });
  return JSON.stringify([...new Set(bad)]);
})()`;

const r3 = await send("Runtime.evaluate", { expression: auditExpr, returnByValue: true, awaitPromise: true });
console.log(`NOWRAP-AUDIT-${IW}:`, r3.result.value);

ws.close(); chrome.kill(); process.exit(0);
