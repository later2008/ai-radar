// 构建脚本（云端版）：data.json + template.html -> site/index.html
import fs from "node:fs";
const data = JSON.parse(fs.readFileSync("data.json", "utf8"));
const tpl = fs.readFileSync("template.html", "utf8");
const out = tpl
  .replaceAll("__UPDATED__", data.updatedAt)
  .replace("__DATA__", JSON.stringify(data).replace(/\u2028|\u2029/g, " "));
fs.mkdirSync("site", { recursive: true });
fs.writeFileSync("site/index.html", out, "utf8");
console.log(`OK bytes=${Buffer.byteLength(out)}`);
