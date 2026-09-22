// 封面系统 v3：质量门槛 + 统一转 WebP（800×450 / q78 / 居中裁剪 16:9）+ 去重 + 真实格式
// 来源优先级：本地已有 → 远程直链（B站拼 16:9 缩略参数）→ 文章页 og:image → twitter:image → 正文首图
// 不达标的图直接弃用（前端走 CSS 生成封面），绝不硬塞糊图/巨型图
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let sharp = null;
try { sharp = require("sharp"); } catch { /* workflow 里会 npm install sharp */ }

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const IMG_DIR = path.join("site", "img");
fs.mkdirSync(IMG_DIR, { recursive: true });

const data = JSON.parse(fs.readFileSync("data.json", "utf8"));
const BAD_IMG = /logo|icon|sprite|avatar|favicon|badge|head\.jpg|100x100|\/themes\//i;

// ---- 质量门槛（对源图生效）----
const W_MIN = 600;        // 源图宽度 < 600px → 弃用
const RATIO_MIN = 1.2;    // 纵横比 < 1.2:1（竖图/方 logo）→ 弃用
const RATIO_MAX = 2.4;    // 纵横比 > 2.4:1（横幅）→ 弃用
const SQUARE_MIN_BYTES = 15 * 1024; // 方形且 < 15KB → 占位图/纯 logo，弃用
const OUT_W = 800, OUT_H = 450;     // 统一输出 800×450（16:9 居中裁剪）
const Q_MAIN = 78, Q_RETRY = 60;    // WebP 质量：目标 ≤90KB，硬上限 200KB
const TARGET_KB = 90 * 1024, MAX_KB = 200 * 1024;

for (const n of data.news) {
  if (n.cover && (BAD_IMG.test(n.cover) || n.cover.endsWith("head.jpg"))) delete n.cover;
}

function extractImg(html) {
  const cands = [];
  let m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
       || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
       || html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i);
  if (m && !BAD_IMG.test(m[1])) cands.push(m[1]);
  const imgs = [...html.matchAll(/<(?:img|source)[^>]+(?:data-src|data-original|src)=["']?(https?:\/\/[^"'\s>]+\.(?:jpg|jpeg|png|webp)[^"'\s>]*)/gi)].map((x) => x[1]);
  for (const u of imgs.slice(0, 30)) if (!BAD_IMG.test(u)) cands.push(u);
  for (const u of cands) {
    if (/1x1|blank|pixel/i.test(u)) continue;
    let c = u.replace(/&amp;/g, "&");
    if (c.startsWith("//")) c = "https:" + c;
    return c;
  }
  return "";
}

async function download(url, maxBytes = 8 * 1024 * 1024) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Referer: new URL(url).origin + "/" }, signal: ac.signal, redirect: "follow" });
    clearTimeout(t);
    if (!r.ok) return null;
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.startsWith("image/") || ct.includes("svg")) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 3000 || buf.length > maxBytes) return null;
    return buf;
  } catch (e) { clearTimeout(t); return null; }
}

async function fetchArticleImg(link) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  try {
    const r = await fetch(link, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, signal: ac.signal, redirect: "follow" });
    clearTimeout(t);
    if (!r.ok) return "";
    return extractImg(await r.text());
  } catch (e) { clearTimeout(t); return ""; }
}

// B站图床：拼 16:9 缩略参数，直接拿小图（672×378 webp），不用下原图
function tuneBilibili(url) {
  if (!/hdslb\.com/i.test(url)) return url;
  if (url.includes("@")) return url;
  return url + "@672w_378h_1c.webp";
}

// 统一处理：800×450 居中裁剪 → WebP q78（超 90KB 降到 q60，仍超 200KB 拒）
async function toUniformWebp(buf) {
  let out = await sharp(buf).resize(OUT_W, OUT_H, { fit: "cover", position: "centre" }).webp({ quality: Q_MAIN }).toBuffer();
  if (out.length > TARGET_KB) out = await sharp(buf).resize(OUT_W, OUT_H, { fit: "cover", position: "centre" }).webp({ quality: Q_RETRY }).toBuffer();
  return out;
}

// 质量门槛：不达标返回拒绝原因
function gate(meta, bytes) {
  const w = meta.width || 0, h = meta.height || 0;
  if (!w || !h) return "unreadable";
  if (w < W_MIN) return `w${w}<${W_MIN}`;
  const ratio = w / h;
  if (ratio > RATIO_MAX) return `ratio${ratio.toFixed(2)}>2.4`;
  if (ratio < RATIO_MIN) return `ratio${ratio.toFixed(2)}<1.2`;
  if (ratio > 0.95 && ratio < 1.05 && bytes < SQUARE_MIN_BYTES) return `square-small${(bytes / 1024).toFixed(0)}KB`;
  return "";
}

const hashOf = (b) => crypto.createHash("sha1").update(b).digest("hex");
const dedupe = new Map(); // sha1 → "img/xxx.webp"（同一张图只存一份）

let localized = 0, kept = 0, rejected = 0, dedupHit = 0;
const queue = [...data.news];
const log = [];

await Promise.all(Array.from({ length: 6 }, async function worker() {
  while (queue.length) {
    const n = queue.shift();
    if (!n.link) continue;
    try {
      // 1) 本地已有合格 webp → 保留（避免每轮重编码）
      if (n.cover && !/^https?:/i.test(n.cover)) {
        const p = path.join("site", n.cover);
        if (fs.existsSync(p)) {
          if (n.cover.endsWith(".webp")) {
            const meta = await sharp(p).metadata();
            if (meta.width >= OUT_W && Math.abs(meta.width / meta.height - 16 / 9) < 0.08 && fs.statSync(p).size <= MAX_KB) {
              kept++; continue;
            }
          }
          // 本地图不达标/不是 webp → 用本地原文件重编码
          const buf = fs.readFileSync(p);
          const meta = await sharp(buf).metadata();
          const g = gate(meta, buf.length);
          if (g) {
            fs.unlinkSync(p); delete n.cover; rejected++;
            log.push(`${n.id} GATE-LOCAL ${g} ${meta.width}x${meta.height}`);
            continue;
          }
          let out = await toUniformWebp(buf);
          if (out.length > MAX_KB) { fs.unlinkSync(p); delete n.cover; rejected++; log.push(`${n.id} BIG-${(out.length / 1024).toFixed(0)}KB`); continue; }
          const h = hashOf(out);
          let target = dedupe.get(h);
          if (!target) { target = "img/" + n.id + ".webp"; dedupe.set(h, target); fs.writeFileSync(path.join(IMG_DIR, path.basename(target)), out); }
          else dedupHit++;
          if (path.basename(target) !== path.basename(n.cover) && fs.existsSync(p)) fs.unlinkSync(p); // 换名/去重后清掉旧文件
          n.cover = target; localized++;
          log.push(`${n.id} REENC ${path.basename(target)} ${(out.length / 1024).toFixed(0)}KB`);
          continue;
        }
        n.cover = ""; // 本地路径但文件不在（换机器）→ 走重新采集
      }

      // 2) 远程直链 / 3) 文章页抓图
      let src = n.cover && /^https?:/i.test(n.cover) ? tuneBilibili(n.cover) : "";
      if (!src) src = await fetchArticleImg(n.link);
      if (!src) { delete n.cover; rejected++; log.push(`${n.id} NOIMG`); continue; }

      const buf = await download(src);
      if (!buf) { delete n.cover; rejected++; log.push(`${n.id} DL-FAIL`); continue; }

      const meta = await sharp(buf).metadata().catch(() => null);
      if (!meta) { delete n.cover; rejected++; log.push(`${n.id} NOT-IMG ${src.slice(0, 60)}`); continue; }
      const g = gate(meta, buf.length);
      if (g) { delete n.cover; rejected++; log.push(`${n.id} GATE ${g} ${meta.width}x${meta.height}`); continue; }

      let out = await toUniformWebp(buf);
      if (out.length > MAX_KB) { delete n.cover; rejected++; log.push(`${n.id} BIG-${(out.length / 1024).toFixed(0)}KB`); continue; }

      const h = hashOf(out);
      let target = dedupe.get(h);
      if (!target) { target = "img/" + n.id + ".webp"; dedupe.set(h, target); fs.writeFileSync(path.join(IMG_DIR, path.basename(target)), out); }
      else dedupHit++;
      n.cover = target; localized++;
      log.push(`${n.id} OK ${path.basename(target)} ${(out.length / 1024).toFixed(0)}KB ${meta.width}x${meta.height}`);
    } catch (e) {
      delete n.cover; rejected++;
      log.push(`${n.id} FAIL ${String(e.message || e).slice(0, 50)}`);
    }
  }
}));

fs.writeFileSync("data.json", JSON.stringify(data, null, 1), "utf8");

// 清理不再被引用的旧封面（旧格式 jpg/png / 已弃用条目的 webp）
const referenced = new Set(data.news.map((n) => n.cover).filter((c) => c && !/^https?:/i.test(c)).map((c) => path.basename(c)));
let cleaned = 0;
for (const f of fs.readdirSync(IMG_DIR)) {
  if (!referenced.has(f)) { fs.unlinkSync(path.join(IMG_DIR, f)); cleaned++; }
}

const withCover = data.news.filter((n) => n.cover && !/^https?:/i.test(n.cover)).length;
log.push(`---`, `reencoded=${localized} kept=${kept} rejected=${rejected} dedupHits=${dedupHit} cleaned=${cleaned} total=${withCover}/${data.news.length}`);
fs.writeFileSync("_covers_log.txt", log.join("\n"), "utf8");
console.log(`covers v3: reencoded=${localized} kept=${kept} rejected=${rejected} dedupHits=${dedupHit} withCover=${withCover}/${data.news.length}`);
