// GitHub 高星项目采集：star>=500、近7日有更新，语言限定 Java/JS/TS/C++/Python
// 输出追加到 _raw_news.json，由 curate.mjs 统一 LLM 改写筛选
import fs from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const RAW = "_raw_news.json";
const LANGS = ["java", "javascript", "typescript", "c++", "python"];
const PER_LANG = 4;   // 每语言取前4个，最终经 curate 筛选后约 4-6 条/天
const DAYS = 7;

const since = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
const raw = fs.existsSync(RAW) ? JSON.parse(fs.readFileSync(RAW, "utf8")) : [];
// 去重：不在本轮 raw 里重复（对 RSS 通道无影响），也防手动重跑叠加
const seen = new Set(raw.filter((x) => x.key && x.key.startsWith("gh_")).map((x) => x.link));

async function ghGet(url) {
  for (let i = 0; i < 3; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 25000);
    const headers = { "User-Agent": UA, Accept: "application/vnd.github+json" };
    if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
    try {
      const r = await fetch(url, { headers, signal: ac.signal });
      clearTimeout(t);
      if (r.ok) return r.json();
      if (r.status === 403 || r.status === 429) { await new Promise((s) => setTimeout(s, 20000)); continue; }
      throw new Error(`http ${r.status}`);
    } catch (e) {
      clearTimeout(t);
      if (i === 2) throw e;
      await new Promise((s) => setTimeout(s, 8000));
    }
  }
}

let ok = 0, fail = 0;
for (const lang of LANGS) {
  try {
    const q = `language:${encodeURIComponent(lang)} stars:>500 pushed:>=${since}`;
    const j = await ghGet(`https://api.github.com/search/repositories?q=${q}&sort=updated&order=desc&per_page=${PER_LANG}`);
    for (const repo of j.items || []) {
      if (seen.has(repo.html_url)) continue;
      seen.add(repo.html_url);
      raw.push({
        key: "gh_" + lang.replace(/\W/g, ""),
        source: "GitHub",
        lang: "en",
        title: `${repo.full_name}（${repo.stargazers_count}★）`,
        link: repo.html_url,
        date: (repo.pushed_at || "").slice(0, 10),
        desc: `[${lang}] star=${repo.stargazers_count} 近7日更新。${(repo.description || "").slice(0, 300)}`,
        cover: "",
        kind: "github",
      });
      ok++;
    }
  } catch (e) {
    fail++;
    console.log(`github ${lang} FAIL ${String(e.message || e).slice(0, 80)}`);
  }
  await new Promise((r) => setTimeout(r, 6500)); // search API 未认证限流 10次/分
}

fs.writeFileSync(RAW, JSON.stringify(raw, null, 1), "utf8");
console.log(`github items=${ok} langs_fail=${fail} raw_total=${raw.length}`);
