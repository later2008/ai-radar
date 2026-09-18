// 云端 RSS 采集：抓全部可用新闻源，输出 _raw_news.json（仅新闻，岗位不走海外源）
import fs from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const NEWS_FEEDS = {
  qbitai: { url: "https://www.qbitai.com/feed", source: "量子位", lang: "zh" },
  ifanr: { url: "https://www.ifanr.com/feed", source: "爱范儿", lang: "zh" },
  solidot: { url: "https://www.solidot.org/index.rss", source: "Solidot", lang: "zh" },
  infoq: { url: "https://www.infoq.cn/feed.xml", source: "InfoQ中文", lang: "zh" },
  tmtpost: { url: "https://www.tmtpost.com/feed", source: "钛媒体", lang: "zh" },
  geekpark: { url: "https://www.geekpark.net/rss", source: "极客公园", lang: "zh" },
  sspai: { url: "https://sspai.com/feed", source: "少数派", lang: "zh" },
  techcrunch: { url: "https://techcrunch.com/category/artificial-intelligence/feed/", source: "TechCrunch AI", lang: "en" },
  theverge: { url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", source: "The Verge AI", lang: "en" },
  arstechnica: { url: "https://arstechnica.com/ai/feed/", source: "Ars Technica AI", lang: "en" },
  ieee: { url: "https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss", source: "IEEE Spectrum AI", lang: "en" },
  mittr: { url: "https://www.technologyreview.com/feed/", source: "MIT 科技评论", lang: "en" },
};

function pick(s, tag) {
  const m = s.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
}
const clean = (s) => s
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#8217;/g, "'").replace(/&#821[01];/g, '"')
  .replace(/&hellip;/g, "…").replace(/&mdash;/g, "—").replace(/&#\d+;/g, "")
  .replace(/\s+/g, " ").trim();

async function get(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25000);
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, signal: ac.signal });
  clearTimeout(t);
  return r.text();
}

const news = [];
for (const [key, f] of Object.entries(NEWS_FEEDS)) {
  try {
    const xml = await get(f.url);
    const items = xml.split(/<item[\s>]/i).slice(1);
    for (const it of items.slice(0, 12)) {
      const title = clean(pick(it, "title"));
      const link = clean(pick(it, "link")) || clean(pick(it, "guid"));
      const dateRaw = clean(pick(it, "pubDate")) || clean(pick(it, "published")) || clean(pick(it, "updated"));
      const date = dateRaw ? new Date(dateRaw).toISOString().slice(0, 10) : "";
      const rawDesc = pick(it, "description") || pick(it, "content:encoded");
      const desc = clean(rawDesc).slice(0, 500);
      const imgM = rawDesc.match(/<img[^>]+src=["']?(https?:\/\/[^"'\s>]+\.(?:jpg|jpeg|png|webp)[^"'\s>]*)/i);
      const cover = imgM ? imgM[1] : "";
      if (title && link) news.push({ key, source: f.source, lang: f.lang, title, link, date, desc, cover });
    }
  } catch (e) {
    news.push({ key, error: String(e.message || e).slice(0, 60) });
  }
}

fs.writeFileSync("_raw_news.json", JSON.stringify(news, null, 1), "utf8");
console.log(`news=${news.length}`);
