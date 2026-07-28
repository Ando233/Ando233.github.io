import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const manualPostsFile = path.join(root, "life", "posts.js");
const managedPostsFile = path.join(root, "life", "managed-posts.js");
const migratedIds = new Set(["life-opens", "seoul-diary-2026-07-09"]);

globalThis.window = {};
await import(`${pathToFileURL(manualPostsFile).href}?source=${Date.now()}`);
await import(`${pathToFileURL(managedPostsFile).href}?managed=${Date.now()}`);

const manualPosts = Array.isArray(window.LIFE_POSTS) ? window.LIFE_POSTS : [];
const managedPosts = Array.isArray(window.LIFE_MANAGED_POSTS) ? window.LIFE_MANAGED_POSTS : [];

const openingPost = managedPosts.find(
  (post) =>
    post.date === "2026-07-27" &&
    post.text?.includes("生活区，开张。之后在这里放些文字和照片。")
);
const seoulPost = managedPosts.find(
  (post) =>
    post.date === "2026-07-09" &&
    post.text?.includes("Seoul Diary") &&
    post.images?.length === 9
);

if (!openingPost || !seoulPost) {
  throw new Error("自动记录尚未完整生成，保留旧数据并停止迁移。");
}

const remainingPosts = manualPosts.filter((post) => !migratedIds.has(post?.id));
const output = `/*
  手动记录可继续放在这里；通过 GitHub Issues 管理的记录保存在 managed-posts.js。
*/
window.LIFE_POSTS = ${JSON.stringify(remainingPosts, null, 2)};
`;

await writeFile(manualPostsFile, output, "utf8");
console.log("已确认两条自动记录完整，旧的手动数据已移除。");
