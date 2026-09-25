// 在 GitHub 上创建备份分支（指向当前 main）
import fs from "node:fs";
const TOKEN = JSON.parse(fs.readFileSync("_token.json", "utf8")).token;
const OWNER = "later2008", REPO = "ai-radar";
const api = async (path, opts = {}) => {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", ...(opts.headers || {}) },
  });
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch {}
  return { status: r.status, json, body: t.slice(0, 300) };
};
const main = await api("/git/ref/heads/main");
if (main.status !== 200) { console.log("read main FAIL", main.body); process.exit(1); }
const sha = main.json.object.sha;
console.log("main sha:", sha);
const br = await api("/git/refs", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ref: "refs/heads/backup-v2-2026-09-19", sha }),
});
console.log("branch create:", br.status === 201 ? "OK" : br.status, br.body);
