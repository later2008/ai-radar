// 半年历史回填采集：GitHub 半年高星活跃项目 + B站半年热门教程 + HN 半年高分讨论
// 输出追加到 _raw_news.json，之后循环跑 curate（BACKFILL=1）分批入库
import fs from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const RAW = "_raw_news.json";
const SINCE = "2026-03-20";
const raw = JSON.parse(fs.readFileSync(RAW, "utf8"));
const seen = new Set(raw.map((x) => (x.link || "").split("?")[0]));

async function getJSON(url, headers = {}) {
  for (let i = 0; i < 3; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 25000);
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: ac.signal });
      clearTimeout(t);
      if (r.ok) return r.json();
      if (i === 2) throw new Error(`http ${r.status}`);
    } catch (e) { clearTimeout(t); if (i === 2) throw e; await new Promise((s) => setTimeout(s, 8000)); }
  }
}

/* 1. GitHub：各语言半年内高星（star>1500）且活跃 */
const GH_LANGS = ["java", "javascript", "typescript", "c++", "python"];
let gh = 0;
for (const lang of GH_LANGS) {
  try {
    const q = encodeURIComponent(`language:${lang} stars:>1500 pushed:>=${SINCE}`);
    const j = await getJSON(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=10`);
    for (const r of j.items || []) {
      const link = r.html_url;
      if (seen.has(link)) continue;
      seen.add(link);
      raw.push({ key: "bf_gh", source: "GitHub", lang: "en", title: `${r.full_name}（${r.stargazers_count}★）`, link, date: (r.pushed_at || "").slice(0, 10), desc: `[${lang}] star=${r.stargazers_count}。${(r.description || "").slice(0, 300)}`, cover: "", kind: "github" });
      gh++;
    }
  } catch (e) { console.log(`bf gh ${lang} FAIL ${String(e.message || e).slice(0, 60)}`); }
  await new Promise((s) => setTimeout(s, 6500));
}

/* 2. B站：专业关键词半年内热门（按播放量排序） */
const BILI_KW = ["Java校招面试", "前端面试八股文", "信息安全入门", "AI工具推荐 学生", "27届校招经验", "软件测试入门", "工业软件 就业", "Agent开发入门", "Java项目实战", "前端项目实战"];
let bili = 0, buvid = "";
try {
  const r = await fetch("https://www.bilibili.com/", { headers: { "User-Agent": UA }, redirect: "follow" });
  const setc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  buvid = (setc.find((c) => c.startsWith("buvid3=")) || "").split(";")[0];
} catch (e) {}
for (const kw of BILI_KW) {
  try {
    const u = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&order=viewcount&keyword=${encodeURIComponent(kw)}&page=1`;
    const h = { "User-Agent": UA, Referer: "https://www.bilibili.com/", Accept: "application/json" };
    if (buvid) h.Cookie = buvid;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20000);
    const r = await fetch(u, { headers: h, signal: ac.signal });
    clearTimeout(t);
    const j = await r.json();
    for (const v of (j.data?.result || []).slice(0, 5)) {
      const title = String(v.title || "").replace(/<[^>]+>/g, "").trim();
      const link = `https://www.bilibili.com/video/${v.bvid || ""}`;
      if (!title || !v.bvid || seen.has(link)) continue;
      const date = v.pubdate ? new Date(v.pubdate * 1000).toISOString().slice(0, 10) : "";
      if (!date || date < SINCE) continue;
      seen.add(link);
      raw.push({ key: "bf_bili", source: `B站·${v.author || kw}`, lang: "zh", title, link, date, desc: `[播放${v.play}] ${String(v.description || "").slice(0, 250)}`, cover: v.pic || "", kind: "bilibili" });
      bili++;
    }
  } catch (e) { console.log(`bf bili [${kw}] FAIL ${String(e.message || e).slice(0, 60)}`); }
  await new Promise((s) => setTimeout(s, 4000));
}

/* 3. HN Algolia：半年高分英文干货 */
let hn = 0;
try {
  const minTs = Math.floor(new Date(SINCE).getTime() / 1000);
  const j = await getJSON(`https://hn.algolia.com/api/v1/search?tags=show_hn&numericFilters=created_at_i>${minTs},points>80&hitsPerPage=30`);
  for (const hit of j.hits || []) {
    const link = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
    if (seen.has(link)) continue;
    seen.add(link);
    raw.push({ key: "bf_hn", source: "Hacker News", lang: "en", title: hit.title || "", link, date: (hit.created_at || "").slice(0, 10), desc: `[${hit.points} points] ${(hit.story_text || "").replace(/<[^>]+>/g, " ").slice(0, 250)}`, cover: "", kind: "hn" });
    hn++;
  }
} catch (e) { console.log(`bf hn FAIL ${String(e.message || e).slice(0, 60)}`); }

fs.writeFileSync(RAW, JSON.stringify(raw, null, 1), "utf8");
console.log(`backfill: gh=${gh} bili=${bili} hn=${hn} raw_total=${raw.length}`);
