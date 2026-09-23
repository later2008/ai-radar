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
const EXCLUDE = /融资|上市|IPO|财报|创始人|八卦|综艺|量子计算|芯片制造|学术论文|考研|考公|课程售卖|直播回放|剧情|段子|开黑|培训机构广告/;
// ✅ 专业标签池：每条内容 LLM 必打 1-3 个
const TAGS = ["前端开发", "Java全栈", "通用开发", "工业软件", "信息安全", "求职就业", "AI工具", "行业动态"];

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

/* 1. 预筛候选：时效（日常48h/回填半年）、去重（标题+链接）、按求职相关性排序 */
const BACKFILL = !!process.env.BACKFILL;
const MAX_AGE_DAYS = BACKFILL ? 183 : 3;
const raw = fs.existsSync("_raw_news.json") ? load("_raw_news.json") : [];
const existTitles = new Set(data.news.map((n) => (n.title || "").replace(/\s/g, "").slice(0, 18)));
const existLinks = new Set(data.news.map((n) => (n.link || "").split("?")[0]));
const norm = (t) => (t || "").replace(/\s|【|】|｜|\|/g, "");
const CAND_MAX = 26;
const cands = raw
  .filter((x) => x.title && x.link && !x.error)
  .filter((x) => { const days = (Date.now() - new Date(x.date || 0)) / 864e5; return x.date && days <= MAX_AGE_DAYS; })
  .filter((x) => !EXCLUDE.test(x.title))
  .filter((x) => !existTitles.has(norm(x.title).slice(0, 18)))
  .filter((x) => !existLinks.has((x.link || "").split("?")[0]))
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
    const sys = `你是「AI风向标」的编辑。受众：广州职业技术大学信息工程学院软件工程（含工业软件实验班）、信息安全与管理专业本科生。今天是 ${TODAY}。
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
- tags：${JSON.stringify(TAGS)} 的子集（1-3 个，必打）
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
  tags: (n.tags || []).filter((t) => TAGS.includes(t)).slice(0, 3), featured: false, heat: Math.min(99, Math.max(1, n.heat || 60)),
  brief: n.brief || [], buzz: [],
  ...(n.lang === "en" ? { lang: "en", origTitle: n.origTitle || "" } : {}),
  link: n.link,
}));
data.news = [...newItems, ...data.news].slice(0, 120);
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

/* 4.5 岗位新增：_raw_jobs.json 候选 → LLM 提取加工成七件套 → 入库（去重、上限24） */
const rawJobs = fs.existsSync("_raw_jobs.json") ? load("_raw_jobs.json") : [];
if (KEY && BASE && rawJobs.length && !process.env.SKIP_JOBS) {
  const existJobKeys = new Set(data.jobs.map((j) => ((j.company || "") + (j.title || "")).replace(/\s/g, "").slice(0, 12)));
  try {
    const sys = `今天是 ${TODAY}。你是「AI风向标」的就业信息编辑。下面是来自开源校招汇总仓库的原始行文本候选。提取出信息足够明确的岗位/校招/实习条目（面向本科可投的应届生或在校生优先），每条输出：
- company：公司/单位名；title：一句话标题（含批次如 2027届/秋招/实习）
- type：校招/实习/内推 之一；loc：工作地点（未知填"见公告"）；deadline：投递方式/截止（未知填"尽快投递"）
- positions：岗位名数组（1-5个）；salary：薪资（未知填""）
- link：候选里的仓库链接；source：候选里的来源；date：候选里的日期
- summary：2句概述（招谁、什么方向）；cls：软件工程类/信息安全类/通用技术类 之一
- plain：一句"对本专业学生的意义"；courses：对应课程（一句）
- hardReq：基本要求（数组1-3条）；plusReq：加分项（数组0-2条）
- selfLearn：自学建议（数组0-2条）；fitWho：适合谁（一句）；tips：投递建议（一句）
最高原则：信息模糊、纯广告、培训机构推广、明确只招硕博且无软件/安全岗的一律不选。宁缺毋滥，最多6条。
输出 JSON：{"add":[...]}。`;
    const usr2 = "候选行文本：\n" + JSON.stringify(rawJobs.slice(0, 30), null, 1);
    const out = parseJSON(await chat([{ role: "system", content: sys }, { role: "user", content: usr2 }], 6000));
    let maxJ = Math.max(...data.jobs.map((j) => parseInt((j.id || "j0").slice(1)) || 0), 0);
    const adds = (out.add || [])
      .filter((j) => j.company && j.title)
      .filter((j) => !existJobKeys.has(((j.company) + (j.title)).replace(/\s/g, "").slice(0, 12)))
      .slice(0, 6);
    for (const j of adds) {
      data.jobs.unshift({
        id: "j" + (++maxJ),
        company: j.company, title: j.title, type: j.type || "校招",
        loc: j.loc || "见公告", deadline: j.deadline || "尽快投递",
        salary: j.salary || "", positions: (j.positions || []).slice(0, 5),
        link: j.link || "", source: j.source || "开源校招汇总", date: j.date || TODAY,
        summary: j.summary || "", cls: j.cls || "通用技术类", plain: j.plain || "",
        courses: j.courses || "", hardReq: j.hardReq || [], plusReq: j.plusReq || [],
        selfLearn: j.selfLearn || [], fitWho: j.fitWho || "", tips: j.tips || "",
      });
    }
    if (adds.length) {
      // 上限 24 条：保最新，旧的靠清理段淘汰
      if (data.jobs.length > 24) data.jobs = data.jobs.slice(0, 24);
      log.push(`jobs added=${adds.length} ids=${adds.map((_, i) => "j" + (maxJ - adds.length + 1 + i)).join(",")} total=${data.jobs.length}`);
    } else log.push("jobs added=0");
  } catch (e) {
    log.push(`LLM-JOBS-ADD FAIL ${String(e.message || e).slice(0, 160)}`);
  }
} else if (rawJobs.length) log.push("skip jobs-add (no key)");

data.updatedAt = TODAY + " " + new Date().toTimeString().slice(0, 5);
save("data.json", data);
log.push(`updatedAt=${data.updatedAt}`);
fs.writeFileSync("_curate_log.txt", log.join("\n"), "utf8");
console.log(log.join("\n"));
