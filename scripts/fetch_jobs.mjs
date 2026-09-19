// 岗位采集（合规聚合源）：GitHub 开源校招汇总仓库 → README 近期更新行
// 不直爬招聘平台（反爬+合规风险）；输出 _raw_jobs.json，由 curate.mjs LLM 加工入库
import fs from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const OUT = "_raw_jobs.json";
const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);

async function ghGet(url, isText) {
  for (let i = 0; i < 3; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 25000);
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: isText ? "text/plain" : "application/vnd.github+json" }, signal: ac.signal });
      clearTimeout(t);
      if (r.ok) return isText ? r.text() : r.json();
      if (i === 2) throw new Error(`http ${r.status}`);
    } catch (e) {
      clearTimeout(t);
      if (i === 2) throw e;
      await new Promise((s) => setTimeout(s, 8000));
    }
  }
}

// 找近期活跃的校招汇总仓库（多查询词）
const QUERIES = ["校招", "秋招 2027", "校招日历", "内推 校招", "campus recruit 2027"];
const repos = [];
const repoSeen = new Set();
for (const term of QUERIES) {
  try {
    const q = encodeURIComponent(`${term} pushed:>=${since}`);
    const j = await ghGet(`https://api.github.com/search/repositories?q=${q}&sort=updated&order=desc&per_page=6`);
    for (const r of j.items || []) {
      if ((r.stargazers_count || 0) >= 1 && !repoSeen.has(r.full_name)) {
        repoSeen.add(r.full_name);
        repos.push({ name: r.full_name, url: r.html_url, pushed: (r.pushed_at || "").slice(0, 10), branch: r.default_branch || "main" });
      }
    }
  } catch (e) {
    console.log(`jobs search [${term}] FAIL ${String(e.message || e).slice(0, 80)}`);
  }
  await new Promise((s) => setTimeout(s, 6500));
}

const out = [];
const seenLine = new Set();
for (const repo of repos.slice(0, 5)) {
  try {
    const md = await ghGet(`https://raw.githubusercontent.com/${repo.name}/${repo.branch}/README.md`, true);
    const lines = md.split(/\r?\n/);
    let added = 0;
    for (const ln of lines) {
      if (added >= 10) break;
      const line = ln.trim();
      // 只要有公司/岗位信号的行：含表格分隔或【校招/实习/内推】等
      if (line.length < 12 || line.length > 300) continue;
      if (!/(校招|实习|内推|秋招|春招|提前批|营|计划)/.test(line)) continue;
      if (/^(#|-{2,}|\||\+|--)/.test(line) && !/\|/.test(line)) continue;
      const key = line.slice(0, 25);
      if (seenLine.has(key)) continue;
      seenLine.add(key);
      out.push({ source: `GitHub·${repo.name.split("/")[1]}`, link: repo.url, date: repo.pushed, title: line.replace(/\|/g, " ").replace(/\s+/g, " ").slice(0, 200), desc: line.slice(0, 280) });
      added++;
    }
  } catch (e) {
    console.log(`jobs readme ${repo.name} FAIL ${String(e.message || e).slice(0, 60)}`);
  }
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");
console.log(`jobs candidates=${out.length} repos=${repos.length}`);
