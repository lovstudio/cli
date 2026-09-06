---
"lovstudio": patch
---

Fix Windows Skill installation failing with `spawnSync npx.cmd EINVAL`. Use cross-spawn for command execution so npm, npx, pnpm, and yarn shims launch with correctly escaped arguments in synchronous and asynchronous calls.
