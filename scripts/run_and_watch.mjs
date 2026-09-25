// 触发 workflow_dispatch 并监控运行结果
import fs from "node:fs";
const { token } = JSON.parse(fs.readFileSync("_token.json", "utf8"));
const owner = fs.readFileSync("_owner.txt", "utf8").trim();
const H = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" };
const REPO = `https://api.github.com/repos/${owner}/ai-radar`;

const d = await fetch(`${REPO}/actions/workflows/update.yml/dispatches`, { method: "POST", headers: H, body: JSON.stringify({ ref: "main" }) });
console.log("dispatch:", d.status === 204 ? "OK" : d.status + " " + (await d.text()).slice(0, 200));
if (d.status !== 204) process.exit(1);

await new Promise((r) => setTimeout(r, 8000));
for (let i = 0; i < 60; i++) {
  const runs = await (await fetch(`${REPO}/actions/runs?per_page=1`, { headers: H })).json();
  const run = runs.workflow_runs?.[0];
  if (!run) { await new Promise((r) => setTimeout(r, 10000)); continue; }
  process.stdout.write(`[${i}] ${run.status} ${run.conclusion || ""}\r`);
  if (run.status === "completed") {
    console.log(`\nrun conclusion: ${run.conclusion} | ${run.html_url}`);
    // 拉取日志摘要
    const jobs = await (await fetch(`${REPO}/actions/runs/${run.id}/jobs`, { headers: H })).json();
    for (const j of jobs.jobs || []) {
      const steps = (j.steps || []).map((s) => `  ${s.name}: ${s.conclusion}`).filter((s) => !s.includes("success")).join("\n");
      console.log(`job "${j.name}" -> ${j.conclusion}${steps ? "\n" + steps : ""}`);
    }
    break;
  }
  await new Promise((r) => setTimeout(r, 10000));
}
