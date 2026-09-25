// 带验证的推送重试：成功以 API 能查到 head commit 为准
import fs from "node:fs";
import { execSync } from "node:child_process";
const { token } = JSON.parse(fs.readFileSync("_token.json", "utf8"));
const owner = fs.readFileSync("_owner.txt", "utf8").trim();
const H = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

const local = execSync('"C:/Program Files/Git/bin/git.exe" rev-parse HEAD', { cwd: process.cwd() }).toString().trim().slice(0, 8);
console.log("local head:", local);

for (let i = 1; i <= 6; i++) {
  try {
    execSync('"C:/Program Files/Git/bin/git.exe" -c http.proxy= -c https.proxy= push -u origin main', {
      cwd: process.cwd(), stdio: "pipe", timeout: 90000,
      env: { ...process.env, HTTP_PROXY: "", HTTPS_PROXY: "", http_proxy: "", https_proxy: "", ALL_PROXY: "", all_proxy: "" },
    });
  } catch (e) {
    console.log(`push attempt ${i} failed: ${String(e.stderr || e.message).slice(0, 120).replace(/\n/g, " ")}`);
  }
  await new Promise((r) => setTimeout(r, 6000));
  const c = await (await fetch(`https://api.github.com/repos/${owner}/ai-radar/commits/main`, { headers: H })).json();
  if (c.sha) {
    console.log("remote head:", c.sha.slice(0, 8), "| msg:", c.commit.message.slice(0, 50));
    if (c.sha.startsWith(local)) { console.log("PUSH VERIFIED"); process.exit(0); }
    console.log("remote differs, retrying...");
  } else {
    console.log(`remote empty (attempt ${i})`);
  }
}
console.log("PUSH FAILED after retries");
process.exit(1);
