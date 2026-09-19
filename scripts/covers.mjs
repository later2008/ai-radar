// 封面系统 v2：为全部新闻条目本地化配图
// 1) 优先 RSS/抓取阶段自带的文章配图 2) 缺图抓文章 og:image 3) 下载到 site/img/ 本地化（防盗链、不失效）
// 失败条目留空 → 前端显示来源标识色块（图文语义相符兜底）
import fs from "node:fs";
import path from "node:path";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const IMG_DIR = path.join("site", "img");
fs.mkdirSync(IMG_DIR, { recursive: true });

const data = JSON.parse(fs.readFileSync("data.json", "utf8"));
const BAD_IMG = /logo|icon|sprite|avatar|favicon|badge|head\.jpg|100x100|\/themes\//i;

// 清洗：坏图直接作废
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

async function download(url, file) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Referer: new URL(url).origin + "/" }, signal: ac.signal, redirect: "follow" });
    clearTimeout(t);
    if (!r.ok) return false;
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.startsWith("image/") || ct.includes("svg")) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 3000 || buf.length > 6 * 1024 * 1024) return false; // <3KB 多为占位图，>6MB 拒
    fs.writeFileSync(file, buf);
    return true;
  } catch (e) { clearTimeout(t); return false; }
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

const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/jpg": ".jpg" };

// 缺图兜底：按专业方向生成主题 SVG 封面（有类别辨识度，不是通用灰图）
const THEME = [
  { re: /信息安全|网络安全|渗透|漏洞/, c1: "#7C3AED", c2: "#4C1D95", icon: "shield" },
  { re: /前端|Vue|React|CSS|JS/, c1: "#2563EB", c2: "#1E3A8A", icon: "code" },
  { re: /Java|后端|Spring/, c1: "#D97706", c2: "#92400E", icon: "server" },
  { re: /工业软件|CAD|C\+\+/, c1: "#0D9488", c2: "#134E4A", icon: "gear" },
  { re: /AI工具|大模型|Agent/, c1: "#DB2777", c2: "#831843", icon: "chip" },
  { re: /求职|就业|校招|面试/, c1: "#059669", c2: "#064E3B", icon: "brief" },
];
const ICONS = {
  shield: `<path d="M60 30 L88 40 V66 C88 84 76 96 60 102 C44 96 32 84 32 66 V40 Z" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="5" stroke-linejoin="round"/><path d="M46 66 L56 76 L76 52" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
  code: `<path d="M42 44 L24 64 L42 84" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M78 44 L96 64 L78 84" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M66 38 L54 90" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="5" stroke-linecap="round"/>`,
  server: `<rect x="28" y="34" width="64" height="26" rx="5" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="5"/><rect x="28" y="68" width="64" height="26" rx="5" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="5"/><circle cx="42" cy="47" r="4" fill="rgba(255,255,255,.85)"/><circle cx="42" cy="81" r="4" fill="rgba(255,255,255,.85)"/>`,
  gear: `<circle cx="60" cy="64" r="17" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="5"/><path d="M60 38 V28 M60 100 V90 M86 64 H96 M24 64 H34 M79 45 L86 38 M34 90 L41 83 M79 83 L86 90 M34 38 L41 45" stroke="rgba(255,255,255,.85)" stroke-width="5" stroke-linecap="round"/>`,
  chip: `<rect x="40" y="40" width="40" height="40" rx="6" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="5"/><rect x="52" y="52" width="16" height="16" rx="3" fill="rgba(255,255,255,.6)"/><path d="M48 40 V28 M72 40 V28 M48 100 V88 M72 100 V88 M40 52 H28 M40 76 H28 M100 52 H88 M100 76 H88" stroke="rgba(255,255,255,.7)" stroke-width="4" stroke-linecap="round"/>`,
  brief: `<rect x="28" y="42" width="64" height="46" rx="6" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="5"/><path d="M48 42 V34 C48 30 52 28 60 28 C68 28 72 30 72 34 V42" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="5"/><path d="M28 60 H92" stroke="rgba(255,255,255,.85)" stroke-width="4"/>`,
};
function genFallbackSvg(n) {
  const text = (n.title || "") + " " + (n.tracks || []).join(" ") + " " + (n.cat || "");
  const t = THEME.find((x) => x.re.test(text)) || { c1: "#3B82F6", c2: "#1E3A8A", icon: "code" };
  const src = (n.source || "AI雷达").replace(/[<>&"]/g, "").slice(0, 14);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 208 132" width="208" height="132">
<rect width="208" height="132" fill="${t.c1}"/><rect y="66" width="208" height="66" fill="${t.c2}"/>
<g transform="translate(74,-4) scale(0.5)">${ICONS[t.icon]}</g>
<text x="14" y="118" font-family="system-ui,sans-serif" font-size="13" fill="rgba(255,255,255,.85)">${src}</text>
<circle cx="188" cy="20" r="4" fill="rgba(255,255,255,.4)"/><circle cx="172" cy="20" r="4" fill="rgba(255,255,255,.25)"/>
</svg>`;
}

let localized = 0, missing = 0, kept = 0, svggen = 0;
const queue = [...data.news];
const log = [];

await Promise.all(Array.from({ length: 6 }, async function worker() {
  while (queue.length) {
    const n = queue.shift();
    if (!n.link) continue;
    // 已本地化的跳过
    if (n.cover && !/^https?:/i.test(n.cover) && fs.existsSync(path.join("site", n.cover))) { kept++; continue; }
    let src = n.cover && /^https?:/i.test(n.cover) ? n.cover : "";
    if (!src) src = await fetchArticleImg(n.link);
    if (!src) {
      const fname = n.id + ".svg";
      fs.writeFileSync(path.join(IMG_DIR, fname), genFallbackSvg(n));
      n.cover = "img/" + fname; svggen++;
      log.push(`${n.id} SVG`);
      continue;
    }
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 25000);
    let ct = "";
    try {
      const head = await fetch(src, { headers: { "User-Agent": UA }, signal: ac.signal, redirect: "follow" });
      ct = (head.headers.get("content-type") || "").toLowerCase();
      const buf = Buffer.from(await head.arrayBuffer());
      clearTimeout(t);
      if (!ct.startsWith("image/") || ct.includes("svg") || buf.length < 3000 || buf.length > 6 * 1024 * 1024) {
        const fname = n.id + ".svg";
        fs.writeFileSync(path.join(IMG_DIR, fname), genFallbackSvg(n));
        n.cover = "img/" + fname; svggen++;
        log.push(`${n.id} REJECT->SVG ${ct} ${buf.length}b`);
        continue;
      }
      const fname = n.id + (EXT[ct] || ".jpg");
      fs.writeFileSync(path.join(IMG_DIR, fname), buf);
      n.cover = "img/" + fname;
      localized++;
      log.push(`${n.id} OK ${fname}`);
    } catch (e) {
      clearTimeout(t);
      const fname = n.id + ".svg";
      try { fs.writeFileSync(path.join(IMG_DIR, fname), genFallbackSvg(n)); n.cover = "img/" + fname; svggen++; log.push(`${n.id} FAIL->SVG`); }
      catch (e2) { delete n.cover; missing++; log.push(`${n.id} FAIL ${String(e.message || e).slice(0, 40)}`); }
    }
  }
}));

fs.writeFileSync("data.json", JSON.stringify(data, null, 1), "utf8");
const withCover = data.news.filter((n) => n.cover && !/^https?:/i.test(n.cover)).length;
log.push(`---`, `localized=${localized} svg=${svggen} kept=${kept} missing=${missing} total=${withCover}/${data.news.length}`);
fs.writeFileSync("_covers_log.txt", log.join("\n"), "utf8");
console.log(`covers v2: localized=${localized} svg=${svggen} kept=${kept} missing=${missing} withLocalCover=${withCover}/${data.news.length}`);
