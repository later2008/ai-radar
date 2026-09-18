// 云端 AI 改写：调用 OpenAI 兼容接口（DeepSeek/智谱等，key 放仓库 Secret LLM_API_KEY）
// 容错策略：LLM 调用失败时跳过改写，仅做旧闻清理，保证站点不挂
import fs from "node:fs";

const BASE = (process.env.LLM_BASE_URL || "").replace(/\/$/, "");
const MODEL = process.env.LLM_MODEL || "";
const KEY = process.env.LLM_API_KEY || "";
const TODAY = new Date().toISOString().slice(0, 10);
const CATS = { model: "大模型", agent: "Agent与编程", industry: "产业动态", career: "求职风向" };

function load(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function save(p, v) { fs.writeFileSync(p, JSON.stringify(v, null, 1), "utf8"); }

async function chat(messages, maxTokens = 4000) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.4, max_tokens: maxTokens, response_format: { type: "json_object" } }),
  });
  if (!r.ok) throw new Error(`LLM http ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.choices[0].message.content;
}
function parseJSON(s) {
  const t = s.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  const i = t.indexOf("{"), a = t.indexOf("[");
  const start = a >= 0 && (a < i || i < 0) ? a : i;
  if (start < 0) throw new Error("no JSON in response");
  const src = start === a ? t.slice(a) : t.slice(i);
  return JSON.parse(src.slice(0, Math.max(src.lastIndexOf(start === a ? "]" : "}"), 0) + 1));
}

const data = load("data.json");
let log = [`run ${TODAY} model=${MODEL}`];

/* 1. 预筛候选：48h 内、去重、按求职相关性排序 */
const raw = fs.existsSync("_raw_news.json") ? load("_raw_news.json") : [];
const existTitles = new Set(data.news.map((n) => (n.title || "").replace(/\s/g, "").slice(0, 18)));
const norm = (t) => (t || "").replace(/\s|【|】|｜|\|/g, "");
const CAND_MAX = 26;
const cands = raw
  .filter((x) => x.title && x.link && !x.error)
  .filter((x) => { const days = (Date.now() - new Date(x.date || 0)) / 864e5; return x.date && days <= 3; })
  .filter((x) => !existTitles.has(norm(x.title).slice(0, 18)))
  .map((x) => ({
    x,
    score:
      (/校招|招聘|就业|扩招|岗位|薪资|offer|实习|人才|秋招|裁员|求职|人社|就业率/.test(x.title) ? 40 : 0) +
      (/AI|大模型|智能体|Agent|算力|芯片/.test(x.title) ? 15 : 0) +
      (x.lang === "zh" ? 10 : 0),
  }))
  .sort((a, b) => b.score - a.score)
  .slice(0, CAND_MAX)
  .map((c) => ({ source: c.x.source, lang: c.x.lang, title: c.x.title, link: c.x.link, date: c.x.date, desc: c.x.desc.slice(0, 260) }));
log.push(`candidates=${cands.length}/${raw.length}`);

/* 2. LLM 改写 3-6 条 */
let fresh = [];
if (cands.length && KEY && BASE) {
  const todayDow = "星期" + "日一二三四五六"[new Date().getDay()];
  try {
    const sys = `你是面向中国大学生的 AI 求职资讯网站「AI 风向标」的编辑。今天是 ${TODAY} ${todayDow}。内容方针（最高优先级）：帮学生找工作、了解行业，优先收录贴近岗位与就业的内容（校招/实习/社招动态、岗位需求变化、就业政策、薪资报告、重大融资/组织变动）。纯海外技术新闻最多选 2 条。绝不编造事实与数字，改写必须基于给定的标题和摘要，未知信息不写。所有输出必须是简体中文（英文条目标 lang=en 并给 origTitle）。严格输出 JSON。`;
    const usr = `候选新闻列表（JSON）：
${JSON.stringify(cands, null, 1)}

从中挑选 3-6 条最有价值的新闻改写为本站条目。每条输出字段：
- title：改写后的中文标题（信息量足，可含关键数字）
- summary：1-2 句摘要
- content：150-300 字正文，必须回答「对找工作的学生意味着什么/怎么准备」，基于候选信息合理展开但不编造
- brief：2-4 条要点（字符串数组）
- tags：2-4 个标签
- cat：仅限 ${JSON.stringify(Object.keys(CATS))} 之一（求职相关用 career）
- jobType：cat 为 career 时必须给 ["实习","校招","社招"] 的子集，否则给 []
- heat：0-100 热度评分
- lang：zh 或 en；en 时给 origTitle（原标题）
- link、source、date：沿用候选原值，不得修改

输出 JSON：{"items":[...]}，按 heat 从高到低排序。`;
    const out = parseJSON(await chat([{ role: "system", content: sys }, { role: "user", content: usr }], 5000));
    fresh = (out.items || []).filter((n) => n.title && n.link && CATS[n.cat]);
    log.push(`llm items=${fresh.length}`);
  } catch (e) {
    log.push(`LLM-NEWS FAIL ${String(e.message || e).slice(0, 160)}`);
  }
} else log.push(`skip llm-news (cands=${cands.length}, key=${!!KEY && !!BASE})`);

/* 3. 合并：编号接续、插最前、featured 给最热新条目、总量卡 50 */
let maxId = Math.max(...data.news.map((n) => parseInt((n.id || "a0").slice(1)) || 0), 0);
const featuredId = fresh.length ? fresh.reduce((a, b) => (b.heat > (a.heat || 0) ? b : a)) : null;
data.news.forEach((n) => { if (n.featured) n.featured = false; });
const newItems = fresh.map((n, i) => ({
  id: "a" + (++maxId),
  title: n.title, summary: n.summary, content: n.content,
  source: n.source, date: n.date || TODAY, cat: n.cat,
  tags: n.tags || [], featured: featuredId === n, heat: Math.min(99, Math.max(1, n.heat || 60)),
  jobType: n.jobType || [], brief: n.brief || [], buzz: [],
  ...(n.lang === "en" ? { lang: "en", origTitle: n.origTitle || "" } : {}),
  link: n.link,
}));
data.news = [...newItems, ...data.news].slice(0, 50);
log.push(`added=${newItems.length} ids=${newItems.map((n) => n.id).join(",")} total=${data.news.length}`);

/* 4. LLM 更新 Agent 热度榜（失败则保留旧榜） */
if (KEY && BASE) {
  try {
    const sys = `你是 AI 编程 Agent 领域的观察员。今天是 ${TODAY}。基于你的知识更新 8 个热门 Agent/编程工具的热度榜，score 0-100 递减，delta 为相对上周变化，trend 为 up/down/flat，note 用中文 1 句概括近况。可参考当前榜单微调。输出 JSON {"heat":[8 项: name,vendor,score,delta,trend,note]}。`;
    const out = parseJSON(await chat([{ role: "system", content: sys }, { role: "user", content: "当前榜单：" + JSON.stringify(data.agentHeat, null, 1) }], 2500));
    if (Array.isArray(out.heat) && out.heat.length >= 6) { data.agentHeat = out.heat.slice(0, 8); log.push("heat updated"); }
  } catch (e) { log.push(`LLM-HEAT FAIL ${String(e.message || e).slice(0, 160)}`); }
}

/* 5. 岗位保守清理：让 LLM 仅判断哪些岗位已明确超期（deadline 明显早于今天才删） */
if (KEY && BASE && data.jobs.length) {
  try {
    const sys = `今天是 ${TODAY}。以下是招聘岗位列表 JSON。只删除明确已超期失效的（截止时间明确早于今天且无"长期/持续"字样）。输出 JSON {"remove":["j3",...]}，不确定就输出空数组。`;
    const out = parseJSON(await chat([{ role: "system", content: sys }, { role: "user", content: JSON.stringify(data.jobs.map((j) => ({ id: j.id, company: j.company, deadline: j.deadline || "" })), null, 1) }], 1500));
    const rm = new Set(out.remove || []);
    if (rm.size) { data.jobs = data.jobs.filter((j) => !rm.has(j.id)); log.push(`jobs removed=${[...rm].join(",")}`); }
  } catch (e) { log.push(`LLM-JOBS FAIL ${String(e.message || e).slice(0, 160)}`); }
}

data.updatedAt = TODAY + " " + new Date().toTimeString().slice(0, 5);
save("data.json", data);
log.push(`updatedAt=${data.updatedAt}`);
fs.writeFileSync("_curate_log.txt", log.join("\n"), "utf8");
console.log(log.join("\n"));
