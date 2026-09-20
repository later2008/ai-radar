// B站采集：搜索 API（按最新排序）——白名单UP主名 + 专业关键词双路
// 过滤：时长<3分钟、命中排除词直接丢弃；输出追加到 _raw_news.json 由 curate 统一改写
import fs from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const RAW = "_raw_news.json";
const EXCLUDE = /融资|上市|IPO|财报|八卦|综艺|剧情|段子|广告|课程售卖|游戏|开黑|娱乐/;
const PER_QUERY = 3;
const MIN_PLAY = 20000; // 播放量门槛：低于2万的视频不收录

// 白名单UP主（豆包方案表）+ 搜索补量关键词
const UPMASTERS = ["秋知2046", "黑马程序员", "码农高天", "青空の霞光", "硬核编码师Rico", "方格Fango", "宇哥在学习", "陈鑫杰", "安全极客说", "教网络安全的一叶老师", "漏洞银行BUGBANK", "林粒粒呀", "量子位", "隔壁的程序员老王", "程序员鱼皮", "AfterShip"];
const KEYWORDS = ["Java校招面试", "前端面试八股文", "信息安全入门", "AI工具推荐 学生", "27届校招经验", "软件测试面试", "工业软件就业", "Agent开发入门"];

const raw = fs.existsSync(RAW) ? JSON.parse(fs.readFileSync(RAW, "utf8")) : [];
const seen = new Set(raw.filter((x) => x.kind === "bilibili").map((x) => x.link));

let buvid = "";
try {
  const r = await fetch("https://www.bilibili.com/", { headers: { "User-Agent": UA }, redirect: "follow" });
  const setc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  buvid = (setc.find((c) => c.startsWith("buvid3=")) || "").split(";")[0];
} catch (e) { /* 无 cookie 继续试 */ }

function durToSec(d) {
  if (!d) return 0;
  if (/^\d+$/.test(d)) return +d;
  const p = d.split(":").map(Number);
  return p.reduce((a, b) => a * 60 + b, 0);
}

async function search(kw) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  const u = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&order=pubdate&keyword=${encodeURIComponent(kw)}&page=1`;
  const h = { "User-Agent": UA, Referer: "https://www.bilibili.com/", Accept: "application/json" };
  if (buvid) h.Cookie = buvid;
  const r = await fetch(u, { headers: h, signal: ac.signal });
  clearTimeout(t);
  const j = await r.json();
  if (j.code !== 0) throw new Error(`code ${j.code}`);
  return j.data?.result || [];
}

let ok = 0, fail = 0;
for (const kw of [...UPMASTERS, ...KEYWORDS]) {
  try {
    const items = await search(kw);
    let added = 0;
    for (const v of items) {
      if (added >= 2) break;
      const title = String(v.title || "").replace(/<[^>]+>/g, "").trim();
      const link = `https://www.bilibili.com/video/${v.bvid || ""}`;
      const sec = durToSec(v.duration);
      if (!title || !v.bvid || seen.has(link)) continue;
      if (sec && sec < 180) continue;              // <3分钟丢弃
      if ((v.play || 0) < MIN_PLAY) continue;    // 播放量过低丢弃
      if (EXCLUDE.test(title)) continue;
      const date = v.pubdate ? new Date(v.pubdate * 1000).toISOString().slice(0, 10) : "";
      const days = (Date.now() - new Date(date || 0)) / 864e5;
      if (date && days > 3) continue;              // 只留近3天
      seen.add(link);
      raw.push({
        key: "bili", source: `B站·${v.author || kw}`, lang: "zh",
        title, link, date,
        desc: `[视频${Math.round(sec / 60)}分钟] ${String(v.description || "").slice(0, 250)}`,
        cover: v.pic || "", kind: "bilibili",
      });
      added++; ok++;
    }
  } catch (e) {
    fail++;
    console.log(`bili [${kw}] FAIL ${String(e.message || e).slice(0, 60)}`);
  }
  await new Promise((r) => setTimeout(r, 4000));
}

fs.writeFileSync(RAW, JSON.stringify(raw, null, 1), "utf8");
console.log(`bilibili items=${ok} query_fail=${fail} raw_total=${raw.length}`);
