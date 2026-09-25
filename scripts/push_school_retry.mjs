// 后台慢速重试：把信工版推到 GitHub（每 3 分钟一次，最多 20 次）
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const NODE = "C:/Users/linzihao/.workbuddy/binaries/node/versions/22.22.2-3/node.exe";
const MSG = "feat: 广职大信工学院版 — 双栏目改版（AI实战信息+信工求职指南）、关键词过滤、岗位深度解读";
const FILES = ["data.json", "template.html", "scripts/curate.mjs"];
for (let i = 1; i <= 20; i++) {
  try {
    const out = execFileSync(NODE, ["scripts/api_push.mjs", MSG, ...FILES], { encoding: "utf8", timeout: 300000 });
    if (out.includes("PUSHED VIA API")) { console.log(`attempt ${i}: PUSHED\n` + out); process.exit(0); }
    console.log(`attempt ${i}: ${out.slice(-200).replace(/\n/g, " | ")}`);
  } catch (e) {
    console.log(`attempt ${i} error: ${String(e.message).slice(0, 100)}`);
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 180000); // sleep 3min
}
console.log("GIVE UP after 20 attempts");
process.exit(1);
