// 清理 data.json 中播放量过低的B站视频：按链接中的 bvid 查 view API 核实真实播放量
import fs from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MIN_PLAY = 20000;

const data = JSON.parse(fs.readFileSync("data.json", "utf8"));
const bili = data.news.filter((n) => (n.source || "").startsWith("B站"));
console.log("B站条目:", bili.length);

let buvid = "";
try {
  const r = await fetch("https://www.bilibili.com/", { headers: { "User-Agent": UA } });
  const setc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  buvid = (setc.find((c) => c.startsWith("buvid3=")) || "").split(";")[0];
} catch (e) { /* 继续 */ }

async function viewOf(bvid) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  const h = { "User-Agent": UA, Referer: "https://www.bilibili.com/" };
  if (buvid) h.Cookie = buvid;
  const r = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { headers: h, signal: ac.signal });
  clearTimeout(t);
  const j = await r.json();
  if (j.code !== 0) throw new Error(`code ${j.code}`);
  return j.data?.stat?.view || 0;
}

const drop = [];
for (const n of bili) {
  const m = (n.link || "").match(/BV[0-9A-Za-z]+/);
  if (!m) continue;
  try {
    const view = await viewOf(m[0]);
    console.log(`${n.id} ${m[0]} 播放=${view} ${view < MIN_PLAY ? "→ 删" : "→ 留"} | ${n.title.slice(0, 30)}`);
    if (view < MIN_PLAY) drop.push(n.id);
  } catch (e) {
    console.log(`${n.id} ${m[0]} 查询失败(${String(e.message || e).slice(0, 30)}) → 保留`);
  }
  await new Promise((r) => setTimeout(r, 1500));
}

if (drop.length) {
  const before = data.news.length;
  data.news = data.news.filter((n) => !drop.includes(n.id));
  fs.writeFileSync("data.json", JSON.stringify(data, null, 1), "utf8");
  console.log(`已删除 ${drop.length} 条低播放视频，news ${before} → ${data.news.length}`);
} else {
  console.log("没有需要删除的低播放条目");
}
