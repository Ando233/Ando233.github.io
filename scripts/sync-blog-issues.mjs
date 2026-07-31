import { readFile, writeFile, mkdir, rm, rename } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";
import { marked } from "marked";

const root = process.cwd();
const blogDirectory = path.join(root, "blog");
const managedAssets = path.join(root, "assets", "blog", "managed");
const nextBlog = path.join(root, `.blog-next-${process.pid}`);
const nextAssets = path.join(root, "assets", "blog", `.managed-next-${process.pid}`);
const manifestFile = path.join(blogDirectory, "managed-posts.json");
const fixturePath = process.env.BLOG_ISSUES_FIXTURE;
const fixtureAssetRoot = process.env.BLOG_FIXTURE_ASSET_DIR;
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const siteUrl = "https://ando233.github.io";

const section = (body, label) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\n)###\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|$)`,
    "i"
  );
  return body.match(pattern)?.[1]?.trim() || "";
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const escapeXml = escapeHtml;
const markdownRenderer = new marked.Renderer();
markdownRenderer.html = ({ text }) => escapeHtml(text);

const cleanResponse = (value) => {
  const cleaned = String(value || "").trim();
  return cleaned === "_No response_" ? "" : cleaned;
};

const plainText = (value) =>
  cleanResponse(value)
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const isPublished = (issue) => {
  const publishSection = section(issue.body || "", "发布");
  const checked = /-\s*\[[xX]\]\s*发布到技术博客/.test(publishSection);
  const labeled = (issue.labels || []).some((label) => {
    const name = typeof label === "string" ? label : label?.name;
    return name === "blog:published";
  });
  return checked || labeled;
};

const parseDate = (value, issueNumber) => {
  const date = cleanResponse(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Issue #${issueNumber}: 日期必须使用 YYYY-MM-DD 格式。`);
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Issue #${issueNumber}: 日期无效。`);
  }
  return date;
};

const parseSlug = (value, issueNumber) => {
  const slug = cleanResponse(value).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`Issue #${issueNumber}: 链接名称只能包含小写英文字母、数字和短横线。`);
  }
  return slug;
};

const parseTags = (value) =>
  [...new Set(
    cleanResponse(value)
      .split(/[,，\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
  )].slice(0, 6);

const cleanAlt = (value, fallback) => {
  const cleaned = plainText(value).slice(0, 180);
  return cleaned || fallback;
};

const extractImages = (value, issueNumber) => {
  const images = [];
  const seen = new Set();
  const add = (url, alt) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    images.push({ url, alt: cleanAlt(alt, `文章图片 ${images.length + 1}`) });
  };

  const markdownPattern = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\)/gi;
  for (const match of value.matchAll(markdownPattern)) add(match[2], match[1]);

  const htmlPattern = /<img\b[^>]*>/gi;
  for (const match of value.matchAll(htmlPattern)) {
    const tag = match[0];
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] || "";
    if (src) add(src, alt);
  }

  const unsupported = images.find(({ url }) => {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return !(
      (host === "github.com" && parsed.pathname.startsWith("/user-attachments/assets/")) ||
      host === "user-images.githubusercontent.com" ||
      host === "private-user-images.githubusercontent.com" ||
      host === "ando233.github.io"
    );
  });

  if (unsupported) {
    throw new Error(`Issue #${issueNumber}: 图片必须直接上传到 GitHub Issue。`);
  }
  return images;
};

const loadIssues = async () => {
  if (fixturePath) return JSON.parse(await readFile(fixturePath, "utf8"));
  if (!repository || !token) throw new Error("缺少 GITHUB_REPOSITORY 或 GITHUB_TOKEN。");

  const issues = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/issues?state=open&per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "ando233-blog-cms"
        }
      }
    );
    if (!response.ok) throw new Error(`读取 GitHub Issues 失败：HTTP ${response.status}`);
    const pageItems = await response.json();
    issues.push(...pageItems);
    if (pageItems.length < 100) break;
  }
  return issues;
};

const readImage = async (url, issueNumber) => {
  if (url.startsWith("fixture://")) {
    if (!fixturePath || !fixtureAssetRoot) {
      throw new Error(`Issue #${issueNumber}: 测试图片目录未配置。`);
    }
    return readFile(path.join(fixtureAssetRoot, url.slice("fixture://".length)));
  }

  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "image/*",
      Authorization: `Bearer ${token}`,
      "User-Agent": "ando233-blog-cms"
    }
  });
  if (!response.ok) {
    throw new Error(`Issue #${issueNumber}: 下载图片失败，HTTP ${response.status}。`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Issue #${issueNumber}: 上传内容不是图片。`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > 25 * 1024 * 1024) {
    throw new Error(`Issue #${issueNumber}: 单张图片不能超过 25 MB。`);
  }
  return buffer;
};

const headerMarkup = (prefix, current = "blog") => `
    <header class="site-header" data-header>
      <a class="wordmark" href="${prefix}#top" aria-label="Yuqi Wang, home">
        <span class="wordmark-mark">YW</span>
        <span class="wordmark-name">Yuqi Wang</span>
      </a>
      <nav class="desktop-nav" aria-label="Primary navigation">
        <a href="${prefix}#research">Research</a>
        <a href="${prefix}#experience">Experience</a>
        <a href="${prefix}#about">About</a>
        <a href="${prefix}#interests">Interests</a>
        <a href="${prefix}blog/"${current === "blog" ? ' aria-current="page"' : ""}>Blog</a>
        <a href="${prefix}life/">Life</a>
        <a href="${prefix}notes/">Notes</a>
      </nav>
      <div class="header-actions">
        <button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark theme" aria-pressed="false">
          <span aria-hidden="true">◐</span>
        </button>
        <a class="header-contact" href="mailto:flairando@gmail.com">Email me</a>
        <button class="menu-toggle" type="button" data-menu-toggle aria-label="Open navigation" aria-controls="mobile-nav" aria-expanded="false">
          <span></span><span></span>
        </button>
      </div>
      <nav class="mobile-nav" id="mobile-nav" data-mobile-nav aria-label="Mobile navigation">
        <a href="${prefix}#research">Research</a>
        <a href="${prefix}#experience">Experience</a>
        <a href="${prefix}#about">About</a>
        <a href="${prefix}#interests">Interests</a>
        <a href="${prefix}blog/"${current === "blog" ? ' aria-current="page"' : ""}>Blog / 技术博客</a>
        <a href="${prefix}life/">Life / 生活</a>
        <a href="${prefix}notes/">Notes / 随笔</a>
        <a href="mailto:flairando@gmail.com">Email me</a>
      </nav>
    </header>`;

const themeScript = `
    <script>
      try {
        const theme = localStorage.getItem("theme");
        if (theme === "dark" || (!theme && matchMedia("(prefers-color-scheme: dark)").matches)) {
          document.documentElement.dataset.theme = "dark";
        }
      } catch {}
    </script>`;

const footerMarkup = (prefix) => `
    <footer class="blog-footer">
      <a class="wordmark footer-mark" href="${prefix}#top">
        <span class="wordmark-mark">YW</span>
        <span>Yuqi Wang</span>
      </a>
      <p>Research / Blog / Music / Philosophy / Life</p>
      <p>© <span data-year></span> Yuqi Wang</p>
    </footer>`;

const renderIndex = (posts) => {
  const content = posts.length
    ? `<div class="blog-list">
${posts.map((post) => `          <article class="blog-entry reveal">
            <time datetime="${post.date}">${post.displayDate}</time>
            <div>
              <h2>${escapeHtml(post.title)}</h2>
              <p>${escapeHtml(post.summary)}</p>
              ${post.tags.length ? `<div class="blog-entry-tags">${post.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
            </div>
            <span class="blog-entry-arrow" aria-hidden="true">↗</span>
            <a class="blog-entry-link" href="./${post.slug}/">阅读《${escapeHtml(post.title)}》</a>
          </article>`).join("\n")}
        </div>`
    : `<div class="blog-empty reveal">
          <div>
            <h2>第一篇文章正在写作中。</h2>
            <p>这里会收录完整的技术文章，包括图片、代码、实验记录和参考资料。</p>
          </div>
          <a class="inline-link" href="../">返回主页 <span aria-hidden="true">↗</span></a>
        </div>`;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#f3f4f0" />
    <meta name="description" content="王宇奇的技术博客：生成式视觉、模型研究、工程实现与研究复现。" />
    <meta name="author" content="Yuqi Wang" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="技术博客 - Yuqi Wang" />
    <meta property="og:description" content="关于生成式视觉、模型研究与工程实现的长期技术笔记。" />
    <meta property="og:url" content="${siteUrl}/blog/" />
    <meta property="og:image" content="${siteUrl}/assets/og-personal.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="canonical" href="${siteUrl}/blog/" />
    <link rel="alternate" type="application/rss+xml" title="Yuqi Wang 技术博客" href="./index.xml" />
    <link rel="preload" as="image" href="../assets/hero-editorial.webp" type="image/webp" />
    <link rel="stylesheet" href="../styles.css?v=6" />
    <link rel="stylesheet" href="./blog.css?v=1" />
    <link rel="icon" href="../favicon.ico" sizes="any" />
    <title>技术博客 - Yuqi Wang</title>
${themeScript}
  </head>
  <body>
    <a class="skip-link" href="#main">跳至正文</a>
    <div class="header-sentinel" data-header-sentinel aria-hidden="true"></div>
${headerMarkup("../")}
    <main class="blog-main" id="main">
      <section class="blog-hero">
        <div class="blog-hero-copy reveal">
          <h1>技术博客</h1>
          <p>记录生成式视觉、模型研究、工程实现和复现过程中真正有用的细节。</p>
        </div>
        <figure class="reveal">
          <img src="../assets/hero-editorial.webp" width="1122" height="1402" alt="胶片、光学玻璃、几何图形和蓝色音频波形组成的编辑式静物" fetchpriority="high" />
        </figure>
      </section>
      <section class="blog-feed" aria-label="技术文章">
        <h2 class="blog-feed-heading reveal">文章</h2>
        ${content}
      </section>
    </main>
${footerMarkup("../")}
    <script src="../script.js?v=4"></script>
  </body>
</html>
`;
};

const renderArticle = (post, bodyHtml) => {
  const canonical = `${siteUrl}/blog/${post.slug}/`;
  const ogImage = post.cover?.sitePath
    ? `${siteUrl}${post.cover.sitePath}`
    : `${siteUrl}/assets/og-personal.png`;
  const tags = post.tags.length
    ? `<div class="article-tags">${post.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";
  const cover = post.cover
    ? `<figure class="article-cover">
        <img src="${escapeHtml(post.cover.articlePath)}" width="${post.cover.width}" height="${post.cover.height}" alt="${escapeHtml(post.cover.alt)}" />
      </figure>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#f3f4f0" />
    <meta name="description" content="${escapeHtml(post.summary)}" />
    <meta name="author" content="Yuqi Wang" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(post.title)}" />
    <meta property="og:description" content="${escapeHtml(post.summary)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="article:published_time" content="${post.date}T00:00:00+08:00" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="canonical" href="${canonical}" />
    ${post.cover ? `<link rel="preload" as="image" href="${escapeHtml(post.cover.articlePath)}" type="image/webp" />` : ""}
    <link rel="stylesheet" href="../../styles.css?v=6" />
    <link rel="stylesheet" href="../blog.css?v=1" />
    <link rel="icon" href="../../favicon.ico" sizes="any" />
    <title>${escapeHtml(post.title)} - Yuqi Wang</title>
${themeScript}
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: post.summary,
      datePublished: post.date,
      dateModified: post.date,
      author: { "@type": "Person", name: "Yuqi Wang", url: `${siteUrl}/` },
      mainEntityOfPage: canonical,
      image: ogImage,
      keywords: post.tags.join(", ")
    }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <a class="skip-link" href="#main">跳至正文</a>
    <div class="header-sentinel" data-header-sentinel aria-hidden="true"></div>
${headerMarkup("../../")}
    <main class="article-main" id="main">
      <article>
        <header class="article-header">
          <div class="article-meta">
            <time class="article-date" datetime="${post.date}">${post.displayDate}</time>
            ${tags}
          </div>
          <div>
            <h1 class="article-title">${escapeHtml(post.title)}</h1>
            <p class="article-summary">${escapeHtml(post.summary)}</p>
          </div>
        </header>
        ${cover}
        <div class="article-layout">
          <aside class="article-aside">
            <a href="../"><span aria-hidden="true">←</span> 返回文章列表</a>
          </aside>
          <div class="article-body">
            ${bodyHtml}
            <div class="article-end">
              <a href="../">继续阅读技术博客</a>
            </div>
          </div>
        </div>
      </article>
    </main>
${footerMarkup("../../")}
    <script src="../../highlight.min.js"></script>
    <script>window.hljs?.highlightAll();</script>
    <script src="../../script.js?v=4"></script>
  </body>
</html>
`;
};

const renderRss = (posts) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Yuqi Wang 技术博客</title>
    <link>${siteUrl}/blog/</link>
    <description>生成式视觉、模型研究、工程实现与研究复现。</description>
    <language>zh-CN</language>
${posts.map((post) => `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${siteUrl}/blog/${post.slug}/</link>
      <guid>${siteUrl}/blog/${post.slug}/</guid>
      <pubDate>${new Date(`${post.date}T00:00:00+08:00`).toUTCString()}</pubDate>
      <description>${escapeXml(post.summary)}</description>
    </item>`).join("\n")}
  </channel>
</rss>
`;

const renderSitemap = (posts) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${siteUrl}/</loc></url>
  <url><loc>${siteUrl}/blog/</loc></url>
  <url><loc>${siteUrl}/life/</loc></url>
  <url><loc>${siteUrl}/notes/</loc></url>
${posts.map((post) => `  <url><loc>${siteUrl}/blog/${post.slug}/</loc><lastmod>${post.date}</lastmod></url>`).join("\n")}
</urlset>
`;

const buildPost = async (issue) => {
  const issueNumber = Number(issue.number);
  const title = plainText(String(issue.title || "").replace(/^\[Blog\]\s*/i, ""));
  if (!title) throw new Error(`Issue #${issueNumber}: 标题不能为空。`);

  const date = parseDate(section(issue.body || "", "日期"), issueNumber);
  const slug = parseSlug(section(issue.body || "", "链接名称"), issueNumber);
  const summary = plainText(section(issue.body || "", "摘要")).slice(0, 220);
  if (!summary) throw new Error(`Issue #${issueNumber}: 摘要不能为空。`);
  const tags = parseTags(section(issue.body || "", "标签"));
  const content = cleanResponse(section(issue.body || "", "正文"));
  if (!content) throw new Error(`Issue #${issueNumber}: 正文不能为空。`);
  const coverSource = cleanResponse(section(issue.body || "", "封面图片"));

  let images = [];
  if (fixturePath) {
    const fixturePattern = /!\[([^\]]*)\]\((fixture:\/\/[^)\s]+)\)/gi;
    const fixtureImages = [...`${coverSource}\n${content}`.matchAll(fixturePattern)].map((match, index) => ({
      url: match[2],
      alt: cleanAlt(match[1], `文章图片 ${index + 1}`)
    }));
    images = fixtureImages.filter(
      (image, index) => fixtureImages.findIndex((candidate) => candidate.url === image.url) === index
    );
  } else {
    images = extractImages(`${coverSource}\n${content}`, issueNumber);
  }

  const coverUrl = fixturePath
    ? [...coverSource.matchAll(/!\[([^\]]*)\]\((fixture:\/\/[^)\s]+)\)/gi)][0]?.[2]
    : extractImages(coverSource, issueNumber)[0]?.url;

  const assetMap = new Map();
  if (images.length) {
    const issueDirectory = path.join(nextAssets, `issue-${issueNumber}`);
    await mkdir(issueDirectory, { recursive: true });
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const buffer = await readImage(image.url, issueNumber);
      const fileName = `image-${String(index + 1).padStart(2, "0")}.webp`;
      const output = path.join(issueDirectory, fileName);
      const result = await sharp(buffer)
        .rotate()
        .resize({ width: 1800, height: 2600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82, effort: 6 })
        .toFile(output);
      const sitePath = `/assets/blog/managed/issue-${issueNumber}/${fileName}`;
      assetMap.set(image.url, {
        sitePath,
        articlePath: `../../assets/blog/managed/issue-${issueNumber}/${fileName}`,
        alt: image.alt,
        width: result.width,
        height: result.height
      });
    }
  }

  let localMarkdown = content;
  for (const [url, asset] of assetMap) {
    localMarkdown = localMarkdown.split(url).join(asset.articlePath);
  }

  return {
    issueNumber,
    title,
    date,
    displayDate: date.replaceAll("-", "."),
    slug,
    summary,
    tags,
    cover: coverUrl ? assetMap.get(coverUrl) : null,
    markdown: localMarkdown
  };
};

const main = async () => {
  await rm(nextBlog, { recursive: true, force: true });
  await rm(nextAssets, { recursive: true, force: true });
  await mkdir(nextBlog, { recursive: true });
  await mkdir(nextAssets, { recursive: true });

  try {
    const issues = await loadIssues();
    const owner = (repository || "Ando233/Ando233.github.io").split("/")[0].toLowerCase();
    const allowedAuthors = new Set([owner, "github-actions[bot]"]);
    const publishable = issues.filter((issue) => {
      if (issue.pull_request || issue.state === "closed") return false;
      if (!/^\[Blog\]\s*/i.test(issue.title || "")) return false;
      if (!allowedAuthors.has((issue.user?.login || "").toLowerCase())) return false;
      return isPublished(issue);
    });

    const posts = [];
    for (const issue of publishable) posts.push(await buildPost(issue));
    posts.sort((a, b) => b.date.localeCompare(a.date) || b.issueNumber - a.issueNumber);

    const duplicateSlugs = posts.filter((post, index) =>
      posts.findIndex((candidate) => candidate.slug === post.slug) !== index
    );
    if (duplicateSlugs.length) {
      throw new Error(`链接名称重复：${[...new Set(duplicateSlugs.map((post) => post.slug))].join(", ")}`);
    }

    for (const post of posts) {
      const articleDirectory = path.join(nextBlog, post.slug);
      await mkdir(articleDirectory, { recursive: true });
      const bodyHtml = await marked.parse(post.markdown, {
        gfm: true,
        breaks: false,
        renderer: markdownRenderer
      });
      await writeFile(path.join(articleDirectory, "index.html"), renderArticle(post, bodyHtml), "utf8");
    }

    const manifest = posts.map(({ issueNumber, title, date, displayDate, slug, summary, tags, cover }) => ({
      issueNumber,
      title,
      date,
      displayDate,
      slug,
      summary,
      tags,
      cover: cover ? { sitePath: cover.sitePath, alt: cover.alt, width: cover.width, height: cover.height } : null
    }));

    await writeFile(path.join(nextBlog, "index.html"), renderIndex(manifest), "utf8");
    await writeFile(path.join(nextBlog, "index.xml"), renderRss(manifest), "utf8");
    await writeFile(path.join(nextBlog, "root-index.xml"), renderRss(manifest), "utf8");
    await writeFile(path.join(nextBlog, "managed-posts.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(path.join(nextBlog, "sitemap.xml"), renderSitemap(manifest), "utf8");

    let previous = [];
    try {
      previous = JSON.parse(await readFile(manifestFile, "utf8"));
    } catch {}
    for (const post of previous) {
      if (post?.slug) await rm(path.join(blogDirectory, post.slug), { recursive: true, force: true });
    }

    for (const post of manifest) {
      const target = path.join(blogDirectory, post.slug);
      await rm(target, { recursive: true, force: true });
      await rename(path.join(nextBlog, post.slug), target);
    }

    for (const name of ["index.html", "index.xml", "managed-posts.json"]) {
      await rm(path.join(blogDirectory, name), { force: true });
      await rename(path.join(nextBlog, name), path.join(blogDirectory, name));
    }
    await rm(path.join(root, "sitemap.xml"), { force: true });
    await rename(path.join(nextBlog, "sitemap.xml"), path.join(root, "sitemap.xml"));
    await rm(path.join(root, "index.xml"), { force: true });
    await rename(path.join(nextBlog, "root-index.xml"), path.join(root, "index.xml"));
    await rm(nextBlog, { recursive: true, force: true });

    await rm(managedAssets, { recursive: true, force: true });
    await mkdir(path.dirname(managedAssets), { recursive: true });
    await rename(nextAssets, managedAssets);
    console.log(`已同步 ${manifest.length} 篇技术文章。`);
  } catch (error) {
    await rm(nextBlog, { recursive: true, force: true });
    await rm(nextAssets, { recursive: true, force: true });
    throw error;
  }
};

await main();
