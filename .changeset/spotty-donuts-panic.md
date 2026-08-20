---
"lovstudio": patch
---

Run `lovstudio app` commands with the app's own package manager — detected from the `packageManager` field or lockfile (`bun`, `yarn`, `npm`) — instead of always invoking pnpm, which rejects non-pnpm projects like `bun@1.3.11`.
