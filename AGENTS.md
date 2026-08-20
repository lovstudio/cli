# AGENTS.md

## 跨会话结论

- pnpm 会在 `packageManager` 声明为非 pnpm 的项目（如 `bun@1.3.11`）里直接报 `Unsupported package manager specification` 并退出 → `lovstudio app` 不可硬编码 pnpm，须先探测应用的 `packageManager` 字段或 lockfile 选定包管理器（2026-08-20, 8108e46）
