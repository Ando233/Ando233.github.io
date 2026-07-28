import { readFile, writeFile, mkdir, rm, rename } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const root = process.cwd();
const managedAssets = path.join(root, "assets", "life", "managed");
const managedPostsFile = path.join(root, "life", "managed-posts.js");
const nextAssets = path.join(root, "assets", "life", `.managed-next-${process.pid}`);
const nextPostsFile = `${managedPostsFile}.next`;
const fixturePath = process.env.LIFE_ISSUES_FIXTURE;
const fixtureAssetRoot = process.env.LIFE_FIXTURE_ASSET_DIR;
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

const section = (body, label) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\n)###\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|$)`,
    "i"
  );
  return body.match(pattern)?.[1]?.trim() || "";
};

const isPublished = (issue) => {
  const publishSection = section(issue.body || "", "发布");
  const checked = /-\s*\[[xX]\]\s*发布到生活区/.test(publishSection);
  const labeled = (issue.labels || []).some((label) => {
    const name = typeof label === "string" ? label : label?.name;
    return name === "life:published";
  });
  return checked || labeled;
};

const parseDate = (value, issueNumber) => {
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Issue #${issueNumber}: 日期必须使用 YYYY-MM-DD 格式。`);
  }

  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Issue #${issueNumber}: 日期无效。`);
  }
  return date;
};

const parseParagraphs = (value) =>
  value
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && paragraph !== "_No response_");

const cleanAlt = (value, fallback) => {
  const cleaned = value
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return cleaned || fallback;
};

const extractImages = (value, issueNumber) => {
  const images = [];
  const seen = new Set();

  const add = (url, alt) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    images.push({
      url,
      alt: cleanAlt(alt || "", `生活记录图片 ${images.length + 1}`)
    });
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
    const host = new URL(url).hostname.toLowerCase();
    return !(
      (host === "github.com" && new URL(url).pathname.startsWith("/user-attachments/assets/")) ||
      host === "user-images.githubusercontent.com" ||
      host === "private-user-images.githubusercontent.com" ||
      host === "ando233.github.io"
    );
  });

  if (unsupported) {
    throw new Error(
      `Issue #${issueNumber}: 图片必须直接上传到 GitHub Issue。`
    );
  }

  return images;
};

const loadIssues = async () => {
  if (fixturePath) {
    return JSON.parse(await readFile(fixturePath, "utf8"));
  }

  if (!repository || !token) {
    throw new Error("缺少 GITHUB_REPOSITORY 或 GITHUB_TOKEN。");
  }

  const issues = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/issues?state=open&per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "ando233-life-cms"
        }
      }
    );

    if (!response.ok) {
      throw new Error(`读取 GitHub Issues 失败：HTTP ${response.status}`);
    }

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
    const name = url.slice("fixture://".length);
    return readFile(path.join(fixtureAssetRoot, name));
  }

  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "image/*",
      Authorization: `Bearer ${token}`,
      "User-Agent": "ando233-life-cms"
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

const buildPost = async (issue) => {
  const issueNumber = Number(issue.number);
  const date = parseDate(section(issue.body || "", "日期"), issueNumber);
  const text = parseParagraphs(section(issue.body || "", "文字"));
  const imageSection = section(issue.body || "", "图片");
  let images = [];

  if (fixturePath) {
    const fixturePattern = /!\[([^\]]*)\]\((fixture:\/\/[^)\s]+)\)/gi;
    images = [...imageSection.matchAll(fixturePattern)].map((match, index) => ({
      url: match[2],
      alt: cleanAlt(match[1], `生活记录图片 ${index + 1}`)
    }));
  } else {
    images = extractImages(imageSection, issueNumber);
  }

  if (!text.length && !images.length) {
    throw new Error(`Issue #${issueNumber}: 文字和图片不能同时为空。`);
  }

  const postImages = [];
  if (images.length) {
    const issueDirectory = path.join(nextAssets, `issue-${issueNumber}`);
    await mkdir(issueDirectory, { recursive: true });

    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const buffer = await readImage(image.url, issueNumber);
      const fileName = `image-${String(index + 1).padStart(2, "0")}.webp`;
      const output = path.join(issueDirectory, fileName);

      await sharp(buffer)
        .rotate()
        .resize({
          width: 1600,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true
        })
        .webp({ quality: 80, effort: 6 })
        .toFile(output);

      postImages.push({
        src: `../assets/life/managed/issue-${issueNumber}/${fileName}`,
        alt: image.alt
      });
    }
  }

  return {
    id: `life-issue-${issueNumber}`,
    issueNumber,
    date,
    displayDate: date.replaceAll("-", "."),
    text,
    images: postImages
  };
};

const main = async () => {
  await rm(nextAssets, { recursive: true, force: true });
  await rm(nextPostsFile, { force: true });
  await mkdir(nextAssets, { recursive: true });

  try {
    const issues = await loadIssues();
    const owner = (repository || "Ando233/Ando233.github.io").split("/")[0].toLowerCase();
    const allowedAuthors = new Set([owner, "github-actions[bot]"]);
    const publishable = issues.filter((issue) => {
      if (issue.pull_request || issue.state === "closed") return false;
      if (!/^\[Life\]\s*/i.test(issue.title || "")) return false;
      if (!allowedAuthors.has((issue.user?.login || "").toLowerCase())) return false;
      return isPublished(issue);
    });

    const posts = [];
    for (const issue of publishable) posts.push(await buildPost(issue));
    posts.sort((a, b) => b.date.localeCompare(a.date) || b.issueNumber - a.issueNumber);

    const output = `/*
  此文件由 GitHub Actions 根据带 [Life] 前缀的 Issues 自动生成。
  请勿手动编辑；手动维护的记录仍放在 posts.js。
*/
window.LIFE_MANAGED_POSTS = ${JSON.stringify(posts, null, 2)};
`;
    await writeFile(nextPostsFile, output, "utf8");

    await rm(managedAssets, { recursive: true, force: true });
    await rename(nextAssets, managedAssets);
    await rename(nextPostsFile, managedPostsFile);
    console.log(`已同步 ${posts.length} 条生活记录。`);
  } catch (error) {
    await rm(nextAssets, { recursive: true, force: true });
    await rm(nextPostsFile, { force: true });
    throw error;
  }
};

await main();
