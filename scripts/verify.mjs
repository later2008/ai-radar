import fs from "node:fs";
const { token } = JSON.parse(fs.readFileSync("_token.json", "utf8"));
const owner = fs.readFileSync("_owner.txt", "utf8").trim();
const H = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
const REPO = `https://api.github.com/repos/${owner}/ai-radar`;

// 1. Pages 状态与地址
const pg = await (await fetch(`${REPO}/pages`, { headers: H })).json();
console.log("pages_url:", pg.html_url || "(pending)", "| status:", pg.status);

// 2. 远端 data.json 是否被 bot 更新（验证 LLM 改写）
const c = await (await fetch(`${REPO}/commits?per_page=3`, { headers: H })).json();
for (const x of c) console.log("commit:", x.sha.slice(0, 8), x.commit.message.split("\n")[0].slice(0, 50));
const d = await (await fetch(`${REPO}/contents/data.json?ref=main`, { headers: H })).json();
const data = JSON.parse(Buffer.from(d.content, "base64").toString("utf8"));
const top = data.news.filter((n) => ["a51", "a52", "a53", "a54", "a55"].includes(n.id) || parseInt((n.id || "a0").slice(1)) > 55);
console.log("updatedAt:", data.updatedAt, "| news:", data.news.length, "| jobs:", data.jobs.length);
console.log("newest ids:", data.news.slice(0, 4).map((n) => n.id + " " + (n.title || "").slice(0, 32)).join(" | "));
