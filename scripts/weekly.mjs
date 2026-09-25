// 周报生成器（模块二）：每周日 21:00（北京时间）由 Actions cron 触发（cron: 0 13 * * 0）
// 也可手动运行：node scripts/weekly.mjs --force（生成/刷新本周周报）
// 规则：本周一 00:00 ~ 本周日 20:00 站内内容 → 精选资讯 Top5 + 精选岗位 Top5 + 实用工具 Top3
// 评选：实用价值优先、岗位>工具>资讯、每个专业方向至少覆盖 1 条、排除过期岗位/纯短讯/同主题重复
import fs from "node:fs";

const FORCE = process.argv.includes("--force");
const data = JSON.parse(fs.readFileSync("data.json", "utf8"));

/* ---------- 北京时间日历（Actions 机器是 UTC，统一 +8 换算） ---------- */
const bj = new Date(Date.now() + 8 * 3600e3);
const dow = bj.getUTCDay() || 7; // 周一=1 ... 周日=7
/* 自动触发仅在周日 20:00 后（对应 21:00 档 cron）；白天档 / 非周日跳过；--force 不受限 */
if (dow !== 7 || bj.getUTCHours() < 20) {
  if (!FORCE) {
    console.log("weekly: 非周日 21:00 档，跳过（--force 可强制生成）");
    process.exit(0);
  }
}
const ymd = (d) => d.toISOString().slice(0, 10);
const monday = new Date(bj); monday.setUTCDate(bj.getUTCDate() - dow + 1); monday.setUTCHours(0, 0, 0, 0);
const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
let startStr = ymd(monday), endStr = ymd(sunday);
const todayStr = ymd(bj);

/* 周窗口回退：当前周（截至运行时）一条内容都没有时，回退到上一个完整周，避免空周报 */
const weekCount = (s, e) =>
  data.news.filter((n) => !n.weekly && n.date >= s && n.date <= e).length +
  data.jobs.filter((j) => j.date >= s && j.date <= e).length;
if (weekCount(startStr, endStr) === 0) {
  monday.setUTCDate(monday.getUTCDate() - 7);
  sunday.setUTCDate(sunday.getUTCDate() - 7);
  const s2 = ymd(monday), e2 = ymd(sunday);
  if (weekCount(s2, e2) === 0) {
    console.log(`weekly: 本周与上周（${s2}~${e2}）均无可汇总内容，跳过`);
    process.exit(0);
  }
  console.log(`weekly: 本周暂无内容，回退生成上一周（${s2}~${e2}）周报`);
  startStr = s2; endStr = e2;  // 同步窗口字符串
}

/* ---------- 候选池：本周内容 ---------- */
const inWeek = (d) => d && d >= startStr && d <= endStr;
const newsPool = data.news.filter((n) => !n.weekly && inWeek(n.date));
const jobsPool = data.jobs.filter((j) => inWeek(j.date));

/* 过期岗位剔除：deadline 里出现「YYYY-MM-DD / YYYY年M月D日」且已早于今天 */
const isExpired = (dl) => {
  if (!dl) return false;
  const m = String(dl).match(/(\d{4})\s*[-年/.]\s*(\d{1,2})\s*[-月/.]\s*(\d{1,2})/);
  if (!m) return false;
  const d = `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  return d < todayStr;
};
const jobsAlive = jobsPool.filter((j) => !isExpired(j.deadline));

/* ---------- 打分 ---------- */
/* 资讯/工具：热度 0.4x + 精选标记 18 + 有价值句 8 + 长文加分（排除纯快讯短讯） */
const newsScore = (n) =>
  (n.heat || 0) * 0.4 + (n.featured ? 18 : 0) + (n.value ? 8 : 0) + Math.min((n.content || "").length / 120, 8);
/* 岗位：校招 > 实习（社招不进周报），方向多样性另行保证 */
const jobScore = (j) => (j.type === "校招" ? 30 : j.type === "实习" ? 24 : 8) + (j.tips ? 6 : 0) + (j.hardReq?.length ? 4 : 0);

/* 同主题去重：标题二元组 Jaccard > 0.45 视为同一主题，保留分高者 */
const grams = (s) => {
  const t = String(s || "").replace(/\s+/g, "");
  const g = new Set();
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
};
const sameTopic = (a, b) => {
  const ga = grams(a), gb = grams(b);
  if (!ga.size || !gb.size) return false;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / Math.min(ga.size, gb.size) > 0.45;
};

/* 通用挑选：按分排序 + 主题去重 + 方向多样性（每个方向尽量 ≥1 条） */
const DIRS = ["前端开发", "Java全栈", "通用开发", "工业软件", "信息安全", "AI工具"];
function pick(list, score, n, dirOf) {
  const sorted = [...list].sort((a, b) => score(b) - score(a));
  const chosen = [];
  const topics = [];
  const tryPush = (x) => {
    if (chosen.includes(x)) return false;
    if (topics.some((t) => sameTopic(t, x.title))) return false;
    chosen.push(x); topics.push(x.title); return true;
  };
  /* 第一轮：每方向选最优 1 条（保证多样性） */
  if (dirOf) {
    for (const d of DIRS) {
      if (chosen.length >= n) break;
      const best = sorted.find((x) => !chosen.includes(x) && dirOf(x).includes(d) && !topics.some((t) => sameTopic(t, x.title)));
      if (best) tryPush(best);
    }
  }
  /* 第二轮：按分数补满 */
  for (const x of sorted) { if (chosen.length >= n) break; tryPush(x); }
  return chosen;
}

const DIRS_OF_NEWS = (n) => n.tags || [];
const weeklyNews = pick(newsPool.filter((n) => n.cat === "stack" || n.cat === "industry"), newsScore, 5, DIRS_OF_NEWS);
const weeklyTools = pick(newsPool.filter((n) => n.cat === "tool" || n.cat === "tut"), newsScore, 3, DIRS_OF_NEWS);
const weeklyJobs = pick(jobsAlive.filter((j) => j.type === "校招" || j.type === "实习"), jobScore, 5, (j) => [j.cls]);

if (!weeklyNews.length && !weeklyJobs.length && !weeklyTools.length) {
  console.log(`weekly: 本周（${startStr}~${endStr}）无可汇总内容，跳过`);
  process.exit(0);
}

/* ---------- 期号与周报条目 ---------- */
const existed = data.news.filter((n) => n.weekly);
const sameWeek = existed.find((n) => n.weekly?.start === startStr);
const issue = sameWeek ? sameWeek.weekly.issue : existed.reduce((m, n) => Math.max(m, n.weekly.issue || 0), 0) + 1;

const md = (s) => s.slice(5).replace("-", ".");
const title = `【AI风向标周报】第${issue}期（${md(startStr)}-${md(endStr)}）`;

/* 封面：复用本周第一条带封面的精选资讯图（科技风原图，随 covers 管线已生成） */
const coverSrc = [...weeklyNews, ...weeklyTools, ...weeklyNews].find((n) => n.cover && !/\.svg$/i.test(n.cover));

/* 汇总正文（纯文本，800-1200 字量级；同时供搜索索引） */
const newsLine = (n, i) => `${i + 1}. ${n.title}\n   ${String(n.value || n.summary || "").replace(/\*\*/g, "").slice(0, 60)}\n   原文：${n.link}`;
const toolLine = (n, i) => `${i + 1}. ${n.title}\n   ${String(n.value || n.summary || "").replace(/\*\*/g, "").slice(0, 60)}\n   获取：${n.link}`;
const jobLine = (j, i) => `${i + 1}. ${j.company} · ${j.title || (j.positions || [])[0] || ""}\n   ${[j.type, j.loc, j.salary].filter(Boolean).join(" ｜ ")}\n   投递：${j.link}`;
let content =
  `本周共精选 ${weeklyNews.length} 条行业资讯、${weeklyJobs.length} 个岗位、${weeklyTools.length} 个实用工具。\n\n` +
  `【本周精选资讯】\n${weeklyNews.map(newsLine).join("\n")}\n\n` +
  `【本周精选岗位】\n${weeklyJobs.map(jobLine).join("\n")}\n\n` +
  `【本周实用工具】\n${weeklyTools.map(toolLine).join("\n")}\n\n` +
  `完整内容可在站内按标签筛选查看；周报自动归档于「周报汇总」分类。`;
if (content.length > 1600) content = content.slice(0, 1580) + "……";

const summary = `本周精选：${weeklyNews.slice(0, 2).map((n) => n.title.slice(0, 18)).join("、")}等 ${weeklyNews.length} 条资讯；${weeklyJobs.slice(0, 2).map((j) => j.company).join("、")}等 ${weeklyJobs.length} 个岗位；${weeklyTools.length} 个实用工具，一文看完本周重点。`;

const item = {
  id: `wk-${startStr.replace(/-/g, "")}`,
  title,
  summary,
  content,
  source: "AI风向标·编辑部",
  date: endStr,
  cat: "weekly",
  tags: ["周报汇总", "求职就业", "AI工具", "行业动态"],
  featured: false,
  heat: 99,
  brief: [
    `精选资讯 Top${weeklyNews.length}：${weeklyNews[0]?.title || "—"}`,
    `精选岗位 Top${weeklyJobs.length}：${weeklyJobs[0] ? weeklyJobs[0].company + " · " + (weeklyJobs[0].title || (weeklyJobs[0].positions || [])[0] || "") : "—"}`,
    `实用工具 Top${weeklyTools.length}：${weeklyTools[0]?.title || "—"}`,
  ],
  link: "",
  cover: coverSrc?.cover || "",
  ...(coverSrc?.cover ? {} : {}),
  weekly: {
    issue,
    start: startStr,
    end: endStr,
    news: weeklyNews.map((n) => n.id),
    jobs: weeklyJobs.map((j) => j.id),
    tools: weeklyTools.map((n) => n.id),
  },
  pinned: true,
};
if (coverSrc) item.cover = coverSrc.cover;

/* ---------- 写回：同周替换，历史周报取消置顶 ---------- */
data.news = data.news.filter((n) => !(n.weekly && n.weekly.start === startStr));
data.news.forEach((n) => { if (n.weekly) n.pinned = false; });
data.news.push(item);
data.updatedAt = `${todayStr} ${String(bj.getUTCHours()).padStart(2, "0")}:${String(bj.getUTCMinutes()).padStart(2, "0")}`;
fs.writeFileSync("data.json", JSON.stringify(data, null, 1), "utf8");

console.log(`weekly: OK 第${issue}期（${startStr}~${endStr}）资讯${weeklyNews.length} 岗位${weeklyJobs.length} 工具${weeklyTools.length} 封面=${item.cover ? "有" : "无"}`);
console.log(`weekly: 资讯= ${weeklyNews.map((n) => n.id).join(",")}`);
console.log(`weekly: 岗位= ${weeklyJobs.map((j) => j.id).join(",")}`);
console.log(`weekly: 工具= ${weeklyTools.map((n) => n.id).join(",")}`);
