// 云端 AI 改写：调用 OpenAI 兼容接口（DeepSeek/智谱等，key 放仓库 Secret LLM_API_KEY）
// 容错策略：LLM 调用失败时跳过改写，仅做旧闻清理，保证站点不挂
import fs from "node:fs";

const BASE = (process.env.LLM_BASE_URL || "").replace(/\/$/, "");
const MODEL = process.env.LLM_MODEL || "";
const KEY = process.env.LLM_API_KEY || "";
const TODAY = new Date().toISOString().slice(0, 10);
const CATS = { tool: "开箱工具与项目", tut: "提效实战教程", stack: "技术栈更新", industry: "行业动态·就业相关" };
const TRACKS = ["前端", "Java", "通用开发", "工业软件", "信息安全"];
// ❌ 排除关键词（规范）：命中即不采集
const EXCLUDE = /融资|上市|IPO|财报|创始人|八卦|综艺|量子计算|芯片制造|学术论文|考研|考公/;

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
  .filter((x) => !EXCLUDE.test(x.title))
  .filter((x) => !existTitles.has(norm(x.title).slice(0, 18)))
  .map((x) => ({
    x,
    score:
      (/校招|招聘|就业|扩招|岗位|实习|秋招|求职|安全工程师|渗透|等保|安全运维|工业软件|CAD|软件测试/.test(x.title) ? 45 : 0) +
      (/AI编程|Cursor|Copilot|Claude Code|通义灵码|Agent|开源项目|工具|教程|框架|版本发布|Spring|Vue|React|Java|Rust|Docker/.test(x.title) ? 30 : 0) +
      (/网络安全|漏洞|攻防|数据安全|风险评估|应急响应/.test(x.title) ? 30 : 0) +
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
    const sys = `你是「广职大信工学院 AI 雷达站」的编辑。受众：广州职业技术大学信息工程学院软件工程（含工业软件实验班）、信息安全与管理专业本科生。今天是 ${TODAY}。
最高原则：专业对口、实用为先、宁缺毋滥——每条内容必须回答「对我有什么用、对应什么课、怎么用」。与两个专业就业无关的内容（纯融资、八卦、学术、消费电子、具身智能等）一律不选。没有合格候选就少选或不选，禁止凑数。
选出的每条输出字段：
- title：改写后的中文标题（信息量足，可含关键数字）
- summary：1-2 句摘要
- content：150-300 字正文，学生视角，拒绝空泛
- brief：2-4 条要点（字符串数组）
- cat：仅限 ${JSON.stringify(Object.keys(CATS))} 之一
- tracks：${JSON.stringify(TRACKS)} 的子集（1-2 个）
- stack：技术栈关键词数组（0-2 个）
- diff：上手难度 1-3（1=简单 2=中等 3=困难，仅 tool/tut 类必给）
- scene：适合场景（仅 tool/tut 类，如"课设/练手/简历加分/求职准备"）
- value：一句话价值总结，**重点加粗**
- courses：对应学校课程/怎么用（一句）
- heat：0-100 热度评分
- lang：zh 或 en；en 时给 origTitle
- link、source、date：沿用候选原值，不得修改
输出 JSON：{"items":[...]}，按 heat 从高到低排序。`;
    const usr = "候选新闻 JSON：\n" + JSON.stringify(cands, null, 1) + "\n请按规则选出并改写，宁缺毋滥。";
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
const newItems = fresh.map((n) => ({
  id: "a" + (++maxId),
  title: n.title, summary: n.summary, content: n.content,
  source: n.source, date: n.date || TODAY, cat: n.cat,
  tracks: (n.tracks || []).filter((t) => TRACKS.includes(t)),
  stack: n.stack || [],
  ...(n.diff ? { diff: n.diff } : {}),
  ...(n.scene ? { scene: n.scene } : {}),
  value: n.value || "", courses: n.courses || "",
  tags: n.tags || [], featured: false, heat: Math.min(99, Math.max(1, n.heat || 60)),
  brief: n.brief || [], buzz: [],
  ...(n.lang === "en" ? { lang: "en", origTitle: n.origTitle || "" } : {}),
  link: n.link,
}));
data.news = [...newItems, ...data.news].slice(0, 50);
// featured 给最新的高热条目
if (newItems.length) {
  const f = newItems.reduce((a, b) => (b.heat > (a.heat || 0) ? b : a));
  data.news.forEach((n) => { if (n.featured) n.featured = false; });
  f.featured = true;
}
log.push(`added=${newItems.length} ids=${newItems.map((n) => n.id).join(",")} total=${data.news.length}`);

/* 4. 岗位保守清理：让 LLM 仅判断哪些岗位已明确超期（deadline 明显早于今天才删） */
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
