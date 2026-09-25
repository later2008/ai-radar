// 通过 GitHub REST API 提交（绕开 git 的 CONNECT 隧道问题）
// 用法：node scripts/api_push.mjs "commit message" file1 file2 ...
import fs from "node:fs";
import path from "node:path";
const { token } = JSON.parse(fs.readFileSync("_token.json", "utf8"));
const owner = fs.readFileSync("_owner.txt", "utf8").trim();
const REPO = `https://api.github.com/repos/${owner}/ai-radar`;
const H = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" };

const [msg, ...files] = process.argv.slice(2);
// 网络抖动重试：代理偶发 502/ECONNRESET
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, opts = {}, tries = 8) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(`${REPO}${path}`, { headers: H, ...opts });
      if (r.status === 200 || r.status === 201) return r;
      if (i === tries) { console.log(`api ${path} -> ${r.status}`); return r; }
    } catch (e) {
      if (i === tries) throw e;
    }
    console.log(`api ${path} retry ${i}`);
    await sleep(4000 * i);
  }
}
const ref = await (await api("/git/ref/heads/main")).json();
const baseCommit = await (await api(`/git/commits/${ref.object.sha}`)).json();
const baseTree = baseCommit.tree.sha;

const tree = [];
for (const f of files) {
  const content = fs.readFileSync(f, "utf8");
  const b = await (await api("/git/blobs", { method: "POST", body: JSON.stringify({ content, encoding: "utf-8" }) })).json();
  tree.push({ path: f.replace(/\\/g, "/"), mode: "100644", type: "blob", sha: b.sha });
  console.log("blob:", f, b.sha ? "ok" : JSON.stringify(b).slice(0, 80));
}
const nt = await (await api("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree }) })).json();
if (!nt.sha) { console.log("tree FAIL", JSON.stringify(nt).slice(0, 200)); process.exit(1); }
const nc = await (await api("/git/commits", {
  method: "POST",
  body: JSON.stringify({ message: msg, tree: nt.sha, parents: [ref.object.sha] }),
})).json();
if (!nc.sha) { console.log("commit FAIL", JSON.stringify(nc).slice(0, 200)); process.exit(1); }
const u = await api("/git/refs/heads/main", { method: "PATCH", body: JSON.stringify({ sha: nc.sha }) });
console.log("update ref:", u.status === 200 ? "PUSHED VIA API" : u.status + " " + (await u.text()).slice(0, 150));
