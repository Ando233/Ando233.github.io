import process from "node:process";

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

if (!repository || !token) {
  throw new Error("缺少 GITHUB_REPOSITORY 或 GITHUB_TOKEN。");
}

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "ando233-life-migration"
};

const seoulImages = [
  ["首尔红色电话亭旁的人像", "seoul-diary-01.webp"],
  ["首尔街头咖啡店门前的人像", "seoul-diary-02.webp"],
  ["Mooney Moon Coffee 店外的人像", "seoul-diary-03.webp"],
  ["首尔街头傍晚的人像", "seoul-diary-04.webp"],
  ["首尔拍贴照片", "seoul-diary-05.webp"],
  ["首尔甜品店内的人像", "seoul-diary-06.webp"],
  ["首尔便利店货架前的人像", "seoul-diary-07.webp"],
  ["酒吧里的蓝色饮品与小食", "seoul-diary-08.webp"],
  ["暖色灯光下的人像", "seoul-diary-09.webp"]
];

const issueBody = ({ date, text, images = [] }) => `### 日期

${date}

### 文字

${text}

### 图片

${images.length ? images.map(([alt, file]) => `![${alt}](https://ando233.github.io/assets/life/2026-07-09/${file})`).join("\n\n") : "_No response_"}

### 发布

- [x] 发布到生活区
`;

const records = [
  {
    title: "[Life] 生活区，开张",
    body: issueBody({
      date: "2026-07-27",
      text: "生活区，开张。之后在这里放些文字和照片。"
    })
  },
  {
    title: "[Life] Seoul Diary",
    body: issueBody({
      date: "2026-07-09",
      text: "Seoul Diary",
      images: seoulImages
    })
  }
];

const request = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers }
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`GitHub API 请求失败：HTTP ${response.status} ${details}`);
  }
  return response.json();
};

const loadExistingIssues = async () => {
  const issues = [];
  for (let page = 1; ; page += 1) {
    const pageItems = await request(
      `https://api.github.com/repos/${repository}/issues?state=all&per_page=100&page=${page}`
    );
    issues.push(...pageItems.filter((item) => !item.pull_request));
    if (pageItems.length < 100) break;
  }
  return issues;
};

const existingIssues = await loadExistingIssues();

for (const record of records) {
  const existing = existingIssues.find((issue) => issue.title === record.title);
  if (existing) {
    console.log(`已存在 Issue #${existing.number}：${record.title}`);
    continue;
  }

  const created = await request(`https://api.github.com/repos/${repository}/issues`, {
    method: "POST",
    body: JSON.stringify(record)
  });
  existingIssues.push(created);
  console.log(`已创建 Issue #${created.number}：${record.title}`);
}
