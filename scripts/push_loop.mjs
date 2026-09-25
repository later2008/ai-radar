// 低频长时重试推送：每 5 分钟试一次，最多 36 次（约 3 小时）
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const NODE = process.env.NODE_EXE || "node";
const args = process.argv.slice(2); // commit message + files
const LOG = "_api_push_last.log";

for (let i = 1; i <= 36; i++) {
  try {
    const out = execFileSync(NODE, ["scripts/api_push.mjs", ...args], { cwd: process.cwd(), encoding: "utf8", timeout: 120000 });
    fs.writeFileSync(LOG, out, "utf8");
    if (/PUSHED VIA API/.test(out)) { console.log(`PUSH OK at attempt ${i}`); process.exit(0); }
  } catch (e) {
    fs.writeFileSync(LOG, String(e.stdout || "") + String(e.stderr || e.message), "utf8");
  }
  console.log(`attempt ${i} failed, waiting 5min...`);
  execFileSync(NODE, ["-e", "setTimeout(()=>{},300000)"], { cwd: process.cwd(), timeout: 320000 });
}
console.log("ALL ATTEMPTS FAILED");
process.exit(1);
