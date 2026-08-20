# lovstudio

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
