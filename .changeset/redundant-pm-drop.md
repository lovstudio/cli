---
"lovstudio": patch
---

Drop a redundant package-manager prefix from `lovstudio app <name> <command...>` (e.g. `bun tauri dev` → `tauri dev`) instead of failing with a doubled command, and document that the package manager is added automatically.
