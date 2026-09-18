// 轮询 GitHub 设备码授权结果，成功后把 token 写入 _token.json
import fs from "node:fs";
const dev = JSON.parse(fs.readFileSync("_device.json", "utf8"));
const deadline = Date.now() + Math.min(dev.expires_in || 880, 840) * 1000;
let wait = (dev.interval || 5) * 1000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, wait));
  try {
    const r = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: "178c6fc778ccc68e1d6a", device_code: dev.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
    });
    const j = await r.json();
    if (j.access_token) {
      fs.writeFileSync("_token.json", JSON.stringify({ token: j.access_token, ts: Date.now() }, null, 1), "utf8");
      console.log("AUTHORIZED");
      process.exit(0);
    }
    if (j.error === "slow_down") wait += 5000;
    if (j.error && j.error !== "authorization_pending" && j.error !== "slow_down") {
      console.log("ERROR", j.error, j.error_description || "");
      process.exit(1);
    }
  } catch (e) { console.log("retry", String(e.message || e).slice(0, 60)); }
}
console.log("TIMEOUT");
process.exit(1);
