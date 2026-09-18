# AI 风向标 AI Radar

面向中国大学生的 AI 资讯与国内求职情报站。每天早上 8 点（北京时间）由 GitHub Actions 自动更新，全程无需任何人的电脑开机。

## 它每天自动做什么

1. **抓新闻**：从量子位、爱范儿、InfoQ 中文、钛媒体、极客公园、少数派、Solidot、TechCrunch AI、The Verge、Ars Technica、IEEE Spectrum、MIT 科技评论 12 个源抓取最新文章
2. **AI 改写**：调用 GitHub Models（`GITHUB_TOKEN` 免费额度）挑选 3-6 条最贴近求职的内容改写为本站条目（含「对找工作的学生意味着什么」视角）
3. **截封面**：为无图文章抓取 og:image 真实配图（自动过滤 logo/默认图）
4. **建站发布**：`build.js` 把 data.json 注入模板生成单文件页面，发布到 GitHub Pages

## 手动触发

GitHub 仓库页面 → Actions → daily-update → Run workflow

## 目录结构

```
data.json            站点数据（news/jobs/agentHeat/stats），每日自动更新并 commit
template.html        页面模板
build.js             构建：data.json + template.html -> site/index.html
scripts/fetch_rss.mjs  RSS 采集
scripts/curate.mjs     AI 筛选改写 + 热度榜 + 岗位超期清理
scripts/covers.mjs     真实封面截取
.github/workflows/update.yml  定时工作流
```

## 内容方针

- 优先国内就业内容（校招/实习/社招、就业政策、薪资报告），纯海外技术新闻每天最多 2 条
- 链接必须是文章真实 URL；不编造事实与数字
- 无图条目显示来源品牌 Logo 占位，绝不使用生成式图片
