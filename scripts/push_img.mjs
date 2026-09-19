// 批量推送 site/img 二进制文件到 GitHub（base64 blob + tree API，分批提交）
import fs from "node:fs";
import path from "node:path";

const { token } = JSON.parse(fs.readFileSync("_token.json", "utf8"));
const owner = fs.readFileSync("_owner.txt", "utf8").trim();
const REPO = `https://api.github.com/repos/${owner}/ai-radar`;
const H = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, opts = {}, tries = 5) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(`${REPO}${p}`, { headers: H, ...opts });
      if (r.status === 200 || r.status === 201) return r.json();
      if (i === tries) throw new Error(`${p} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
    } catch (e) { if (i === tries) throw e; }
    await sleep(4000 * i);
  }
}

const dir = path.join("site", "img");
const files = fs.readdirSync(dir);
console.log(`files=${files.length}`);
const ref = await api("/git/ref/heads/main");
let headSha = ref.object.sha;

const BATCH = 25;
for (let b = 0; b < files.length; b += BATCH) {
  const batch = files.slice(b, b + BATCH);
  const commit = await api(`/git/commits/${headSha}`);
  const tree = [];
  for (const f of batch) {
    const buf = fs.readFileSync(path.join(dir, f));
    const blob = await api("/git/blobs", { method: "POST", body: JSON.stringify({ content: buf.toString("base64"), encoding: "base64" }) });
    tree.push({ path: `site/img/${f}`, mode: "100644", type: "blob", sha: blob.sha });
    process.stdout.write(f + " ");
  }
  const nt = await api("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: commit.tree.sha, tree }) });
  const nc = await api("/git/commits", { method: "POST", body: JSON.stringify({ message: `covers batch ${b / BATCH + 1}`, tree: nt.sha, parents: [headSha] }) });
  await api(`/git/refs/heads/main`, { method: "PATCH", body: JSON.stringify({ sha: nc.sha }) });
  headSha = nc.sha;
  console.log(`\nbatch ${b / BATCH + 1} pushed`);
}
console.log(`ALL PUSHED files=${files.length}`);
