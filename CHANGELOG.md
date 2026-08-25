# lovstudio

## 0.4.17

### Patch Changes

- 5d2448a: Zero-pad tmux pane numbers to two digits and left-align pane labels for a stable scan column.

## 0.4.16

### Patch Changes

- 895290b: Prefix tmux pane numbers with a hash so labels read like `#1: app · command`.

## 0.4.15

### Patch Changes

- c182f4f: Render unfocused tmux pane titles in a high-contrast light cyan that remains distinct from the focused pane highlight.

## 0.4.14

### Patch Changes

- d27b9d8: Render unfocused tmux pane titles in an explicit high-contrast light gray so dark themes cannot make them unreadable.

## 0.4.13

### Patch Changes

- bff708e: Automatically label the current tmux pane while `lovstudio app` runs, keep every pane title visibly labeled without focusing it, and restore the previous title on exit or interruption.

## 0.4.12

### Patch Changes

- 8d99ff8: Add `lovstudio find-app <name>` as a top-level shortcut for resolving and printing a local app path.

## 0.4.11

### Patch Changes

- 5cdf94b: Allow `lovstudio app add <path>` to register an app directly, inferring its name from the app metadata.

## 0.4.10

### Patch Changes

- Add a website-account bridge for local Agents. A device is confirmed once through `lovstudio.ai`, sessions refresh silently, and paid Skill installs check existing website ownership before showing any Credits confirmation or purchase mutation.
- Add `lovstudio account connect|status|disconnect`; keep `license login|whoami|logout` as backward-compatible aliases.

## 0.4.9

### Patch Changes

- Resolve every catalog product slug through its declared `runtime_name` before calling the underlying Skills installer, so current `lov-*`, `sgc-*`, unprefixed, and legacy runtime IDs install correctly. Catalog and historical CLI aliases remain accepted.

## 0.4.8

### Patch Changes

- f134c1c: Let `lovstudio app add` persist the project's parent directory as an app search root, so sibling projects are auto-discovered by future commands.

## 0.4.7

### Patch Changes

- 65edecb: Drop a redundant package-manager prefix from `lovstudio app <name> <command...>` (e.g. `bun tauri dev` → `tauri dev`) instead of failing with a doubled command, and document that the package manager is added automatically.

## 0.4.6

### Patch Changes

- 8108e46: Run `lovstudio app` commands with the app's own package manager — detected from the `packageManager` field or lockfile (`bun`, `yarn`, `npm`) — instead of always invoking pnpm, which rejects non-pnpm projects like `bun@1.3.11`.

## 0.4.5

### Patch Changes

- Prompt for ambiguous local apps and remember the selected directory for later commands.

## 0.4.4

### Patch Changes

- Add PATH-style local app discovery and persistent `app add`, `remove`, `path`, and `list` commands.

## 0.4.3

- Add `lovstudio app <name> <command...>` for running pnpm commands inside mapped local app repositories, starting with `vmux` mapped to `~/lovstudio/coding/Vmux`.
- Add `lovstudio app list`, command help, directory validation, and clear errors for unknown apps or missing commands.
- Gate paid Skill installs through Lovstudio account sign-in and Credits redemption before downloading encrypted bundles.
- Install only free Skills during full-catalog installs and keep legacy license-key activation compatibility.
