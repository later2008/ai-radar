// 云端封面截取：为无封面新闻抓 og:image/首图（过滤 logo/图标/全站默认图）
import fs from "node:fs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const data = JSON.parse(fs.readFileSync("data.json", "utf8"));
const BAD_IMG = /logo|icon|sprite|avatar|favicon|badge|head\.jpg|100x100|\/themes\//i;
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

async function fetchOne(n) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  try {
    const r = await fetch(n.link, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, signal: ac.signal, redirect: "follow" });
    clearTimeout(t);
    if (!r.ok) return `${n.id} SKIP http ${r.status}`;
    const img = extractImg(await r.text());
    if (img) { n.cover = img; return `${n.id} OK ${img.slice(0, 80)}`; }
    return `${n.id} MISS`;
  } catch (e) { clearTimeout(t); return `${n.id} FAIL ${String(e.message || e).slice(0, 40)}`; }
}

const targets = data.news.filter((n) => !n.cover && n.link);
const queue = [...targets];
const log = [];
await Promise.all(Array.from({ length: 6 }, async function worker() {
  while (queue.length) log.push(await fetchOne(queue.shift()));
}));
fs.writeFileSync("data.json", JSON.stringify(data, null, 1), "utf8");
const withCover = data.news.filter((n) => n.cover).length;
log.push(`---`, `targets=${targets.length} withCover=${withCover}/${data.news.length}`);
fs.writeFileSync("_covers_log.txt", log.join("\n"), "utf8");
console.log(`covers: targets=${targets.length} ok=${withCover}/${data.news.length}`);
