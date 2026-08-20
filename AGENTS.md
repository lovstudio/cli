# AGENTS.md

## 跨会话结论

- pnpm 会在 `packageManager` 声明为非 pnpm 的项目（如 `bun@1.3.11`）里直接报 `Unsupported package manager specification` 并退出 → `lovstudio app` 不可硬编码 pnpm，须先探测应用的 `packageManager` 字段或 lockfile 选定包管理器（2026-08-20, 8108e46）
- 在本仓库目录内跑裸 `npx lovstudio` 会被 npm exec **自引用为当前项目**，跑本地源码而非 npm 最新版（本地版本滞后时表现为"发版了 npx 还是旧版"且零联网请求）→ 验证/调试 npx 行为须到仓库目录外（如 /tmp）执行（2026-08-20, 1b9b6ba）
