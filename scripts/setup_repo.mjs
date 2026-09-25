// 用已授权 token 完成建仓/查询（推送与 Pages 由调用方后续步骤处理）
import fs from "node:fs";
const { token } = JSON.parse(fs.readFileSync("_token.json", "utf8"));
const H = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" };

const me = await (await fetch("https://api.github.com/user", { headers: H })).json();
if (!me.login) { console.log("AUTH FAIL", JSON.stringify(me).slice(0, 200)); process.exit(1); }
console.log("login:", me.login);

const repoName = "ai-radar";
let repo = await (await fetch(`https://api.github.com/repos/${me.login}/${repoName}`, { headers: H })).json();
if (repo.id) {
  console.log("repo exists:", repo.html_url, "| private:", repo.private);
} else {
  const r = await fetch("https://api.github.com/user/repos", {
    method: "POST", headers: H,
    body: JSON.stringify({ name: repoName, private: false, description: "AI 风向标 — 每日自动更新的 AI 资讯与求职情报站", has_issues: false, has_wiki: false, has_projects: false }),
  });
  repo = await r.json();
  if (!repo.html_url) { console.log("CREATE FAIL", JSON.stringify(repo).slice(0, 300)); process.exit(1); }
  console.log("repo created:", repo.html_url);
}

// 开启 Pages（workflow 构建模式；已开启会 409，忽略）
const p = await fetch(`https://api.github.com/repos/${me.login}/${repoName}/pages`, {
  method: "POST", headers: H, body: JSON.stringify({ build_type: "workflow" }),
});
console.log("pages:", p.status, p.status === 409 ? "already-enabled" : p.status === 201 ? "enabled" : await p.text().then((t) => t.slice(0, 200)));

fs.writeFileSync("_owner.txt", me.login, "utf8");
