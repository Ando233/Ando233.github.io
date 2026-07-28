# 生活区管理

## 新建记录

1. 打开 [发布生活记录](https://github.com/Ando233/Ando233.github.io/issues/new?template=life-post.yml)。
2. 填写日期与文字，在图片区域上传任意数量的照片。
3. 保存 Issue。
4. 勾选 **发布到生活区**，等待 GitHub Actions 完成后即可上线。

## 管理记录

- 从 [管理已有记录](https://github.com/Ando233/Ando233.github.io/issues?q=is%3Aissue+%5BLife%5D+in%3Atitle) 打开需要修改的条目。
- 编辑 Issue：修改日期、文字或图片。
- 取消勾选 **发布到生活区**：暂时隐藏。
- 重新勾选：再次发布。
- 关闭 Issue：归档并从生活区隐藏。
- 重新打开 Issue：恢复管理；仍需保持发布选项为勾选状态。

## 数据说明

- 自动管理的内容生成到 `life/managed-posts.js`。
- 自动处理后的图片保存在 `assets/life/managed/issue-编号/`。
- 图片会统一旋转到正确方向、限制尺寸、转换为 WebP，并移除原始元数据。
- 现有生活记录均已迁移到 Issues；`life/posts.js` 仅保留为空的兼容入口。
