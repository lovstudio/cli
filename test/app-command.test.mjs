import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(repoRoot, "bin", "lovstudio.mjs");

async function createApp(path, { name, productName } = {}) {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "package.json"), `${JSON.stringify({ name }, null, 2)}\n`);
  if (productName) {
    await mkdir(join(path, "src-tauri"), { recursive: true });
    await writeFile(
      join(path, "src-tauri", "tauri.conf.json"),
      `${JSON.stringify({ productName }, null, 2)}\n`,
    );
  }
}

function run(args, { home, roots, cwd = repoRoot, input, path, env = {} }) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      LOVSTUDIO_HOME: home,
      LOVSTUDIO_APP_PATH: roots,
      TMUX: "",
      TMUX_PANE: "",
      ...(path ? { PATH: `${path}${delimiter}${process.env.PATH}` } : {}),
      ...env,
    },
  });
}

async function createAppWithPm(appDir, name, { packageManager, lockfile } = {}) {
  await mkdir(appDir, { recursive: true });
  await writeFile(
    join(appDir, "package.json"),
    `${JSON.stringify({ name, ...(packageManager ? { packageManager } : {}) }, null, 2)}\n`,
  );
  if (lockfile) await writeFile(join(appDir, lockfile), "# fixture lockfile\n");
}

async function createMockBin(binDir, name) {
  await mkdir(binDir, { recursive: true });
  const bin = join(binDir, name);
  await writeFile(bin, "#!/bin/sh\necho \"$(basename $0):$*\"\n");
  await chmod(bin, 0o755);
  return binDir;
}

async function createMockTmux(binDir) {
  await mkdir(binDir, { recursive: true });
  const bin = join(binDir, "tmux");
  await writeFile(bin, `#!/bin/sh
{
  for arg in "$@"; do printf '[%s]' "$arg"; done
  printf '\\n'
} >> "$TMUX_TEST_LOG"
if [ "$1" = "display-message" ]; then
  case "$5" in
    '#{pane_pipe}') printf '%s\\n' "\${TMUX_TEST_PANE_PIPE:-0}" ;;
    *) printf '%s\\n' "$TMUX_TEST_ORIGINAL_TITLE" ;;
  esac
elif [ "$1" = "show-options" ]; then
  printf '%s\\n' "$TMUX_TEST_BORDER_STATUS"
fi
`);
  await chmod(bin, 0o755);
  return binDir;
}

test("discovers an app by Tauri productName from LOVSTUDIO_APP_PATH", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-discovery-"));
  const root = join(fixture, "projects");
  const ataru = join(root, "lovcode");
  await createApp(ataru, { name: "lovcode", productName: "Ataru" });

  const resolved = run(["app", "path", "ataru"], {
    home: join(fixture, "home"),
    roots: root,
  });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(resolved.stdout.trim(), await realpath(ataru));

  const listed = run(["app", "list"], {
    home: join(fixture, "home"),
    roots: root,
  });
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /ataru\s+.*lovcode\s+\[auto\]/);
});

test("find-app resolves a local app from the top level", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-find-app-"));
  const root = join(fixture, "projects");
  const oneshot = join(root, "oneshot");
  await createApp(oneshot, { name: "oneshot", productName: "OneShot" });

  const resolved = run(["find-app", "oneshot"], {
    home: join(fixture, "home"),
    roots: root,
  });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(resolved.stdout.trim(), await realpath(oneshot));
});

test("find-app is documented in root and command help", () => {
  const rootHelp = run(["--help"], {});
  assert.equal(rootHelp.status, 0, rootHelp.stderr);
  assert.match(rootHelp.stdout, /find-app\s+print the path to a local app/);

  const commandHelp = run(["find-app", "--help"], {});
  assert.equal(commandHelp.status, 0, commandHelp.stderr);
  assert.match(commandHelp.stdout, /lovstudio find-app <name>/);
  assert.match(commandHelp.stdout, /alias for `lovstudio app path <name>`/);
});

test("find-app reports app discovery guidance when no app matches", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-find-app-missing-"));
  const emptyRoot = join(fixture, "empty");
  await mkdir(emptyRoot, { recursive: true });

  const missing = run(["find-app", "missing-app"], {
    home: join(fixture, "home"),
    roots: emptyRoot,
  });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /could not resolve app: missing-app/);
  assert.match(missing.stderr, /lovstudio app add missing-app/);
});

test("add, path, and remove manage explicit app mappings", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-mapping-"));
  const app = join(fixture, "outside", "demo-project");
  const home = join(fixture, "home");
  const emptyRoot = join(fixture, "empty");
  await mkdir(emptyRoot, { recursive: true });
  await createApp(app, { name: "demo-project", productName: "Demo" });

  const added = run(["app", "add", "demo", app], {
    home,
    roots: emptyRoot,
    input: "n\n",
  });
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /added demo ->/);
  assert.match(added.stderr, /persistent app search root/);

  const registry = JSON.parse(await readFile(join(home, "apps.json"), "utf8"));
  assert.equal(registry.demo, await realpath(app));

  const resolved = run(["app", "path", "demo"], { home, roots: emptyRoot });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(resolved.stdout.trim(), await realpath(app));

  const removed = run(["app", "remove", "demo"], { home, roots: emptyRoot });
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(removed.stdout, /removed explicit mapping: demo/);

  const missing = run(["app", "path", "demo"], { home, roots: emptyRoot });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /could not resolve app: demo/);
  assert.match(missing.stderr, /lovstudio app add demo/);
});

test("app add accepts an app path and infers its primary name", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-add-path-"));
  const app = join(fixture, "outside", "demo-project");
  const home = join(fixture, "home");
  const emptyRoot = join(fixture, "empty");
  await mkdir(emptyRoot, { recursive: true });
  await createApp(app, { name: "demo-package", productName: "Demo Product" });

  const added = run(["app", "add", app], {
    home,
    roots: emptyRoot,
    input: "n\n",
  });
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /added demo-product ->/);

  const registry = JSON.parse(await readFile(join(home, "apps.json"), "utf8"));
  assert.equal(registry["demo-product"], await realpath(app));
});

test("app add reports an invalid explicit path instead of mapping the current app", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-add-invalid-path-"));
  const currentApp = join(fixture, "current-app");
  const missingApp = join(fixture, "missing-app");
  const home = join(fixture, "home");
  const emptyRoot = join(fixture, "empty");
  await mkdir(emptyRoot, { recursive: true });
  await createApp(currentApp, { name: "current-app" });

  const added = run(["app", "add", missingApp], {
    cwd: currentApp,
    home,
    roots: emptyRoot,
  });
  assert.equal(added.status, 1);
  assert.match(added.stderr, new RegExp(`not an app directory.*${missingApp}`));
});

test("app add with only a custom name still maps the current directory", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-add-name-"));
  const app = join(fixture, "current-app");
  const home = join(fixture, "home");
  const emptyRoot = join(fixture, "empty");
  await mkdir(emptyRoot, { recursive: true });
  await createApp(app, { name: "package-name" });

  const added = run(["app", "add", "custom-name"], {
    cwd: app,
    home,
    roots: emptyRoot,
    input: "n\n",
  });
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /added custom-name ->/);

  const registry = JSON.parse(await readFile(join(home, "apps.json"), "utf8"));
  assert.equal(registry["custom-name"], await realpath(app));
});

test("app add can persist the project's parent as a search root", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-persistent-root-"));
  const repositoryRoot = join(fixture, "yoda", "repositories");
  const gtd = join(repositoryRoot, "gtd");
  const sibling = join(repositoryRoot, "future-app");
  const emptyRoot = join(fixture, "empty");
  const home = join(fixture, "home");
  await mkdir(emptyRoot, { recursive: true });
  await createApp(gtd, { name: "gtd" });
  await createApp(sibling, { name: "future-app" });

  const added = run(["app", "add", "gtd", gtd], {
    home,
    roots: emptyRoot,
    input: "\n",
  });
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stderr, /Add .*repositories as a persistent app search root/);
  assert.match(added.stdout, /added app search root:/);

  const registry = JSON.parse(await readFile(join(home, "apps.json"), "utf8"));
  assert.equal(registry.apps.gtd, await realpath(gtd));
  assert.deepEqual(registry.roots, [await realpath(repositoryRoot)]);

  const resolvedSibling = run(["app", "path", "future-app"], {
    home,
    roots: emptyRoot,
  });
  assert.equal(resolvedSibling.status, 0, resolvedSibling.stderr);
  assert.equal(resolvedSibling.stdout.trim(), await realpath(sibling));

  const removedMapping = run(["app", "remove", "gtd"], { home, roots: emptyRoot });
  assert.equal(removedMapping.status, 0, removedMapping.stderr);
  assert.match(removedMapping.stdout, /still auto-discovered/);

  const registryAfterRemove = JSON.parse(await readFile(join(home, "apps.json"), "utf8"));
  assert.deepEqual(registryAfterRemove.apps, {});
  assert.deepEqual(registryAfterRemove.roots, [await realpath(repositoryRoot)]);

  const listed = run(["app", "list"], { home, roots: emptyRoot });
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, new RegExp(`Search roots:.*${await realpath(repositoryRoot)}`));
});

test("an explicit mapping takes precedence over auto-discovery", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-precedence-"));
  const root = join(fixture, "projects");
  const automatic = join(root, "demo-auto");
  const explicit = join(fixture, "explicit", "demo");
  const home = join(fixture, "home");
  await createApp(automatic, { name: "demo", productName: "Demo" });
  await createApp(explicit, { name: "demo-explicit", productName: "Demo Explicit" });

  const added = run(["app", "add", "demo", explicit], {
    home,
    roots: root,
    input: "n\n",
  });
  assert.equal(added.status, 0, added.stderr);

  const resolved = run(["app", "path", "demo"], { home, roots: root });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(resolved.stdout.trim(), await realpath(explicit));
});

test("an ambiguous app choice is prompted once and remembered", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-remember-choice-"));
  const root = join(fixture, "projects");
  const home = join(fixture, "home");
  const exact = join(root, "ataru");
  const variant = join(root, "ataru-index-throughput");
  await createApp(exact, { name: "ataru", productName: "Ataru" });
  await createApp(variant, { name: "ataru", productName: "Ataru" });

  const selected = run(["app", "path", "ataru"], {
    home,
    roots: root,
    input: "2\n",
  });
  assert.equal(selected.status, 0, selected.stderr);
  assert.match(selected.stderr, /Multiple apps match 'ataru'/);
  assert.match(selected.stderr, /selection will be remembered/);
  assert.match(selected.stderr, /Remembered ataru ->/);
  assert.equal(selected.stdout.trim(), await realpath(variant));

  const registry = JSON.parse(await readFile(join(home, "apps.json"), "utf8"));
  assert.equal(registry.ataru, await realpath(variant));

  const remembered = run(["app", "path", "ataru"], { home, roots: root });
  assert.equal(remembered.status, 0, remembered.stderr);
  assert.doesNotMatch(remembered.stderr, /Multiple apps match/);
  assert.equal(remembered.stdout.trim(), await realpath(variant));
});

test("LOVSTUDIO_APP_PATH uses PATH ordering", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-path-order-"));
  const firstRoot = join(fixture, "first");
  const secondRoot = join(fixture, "second");
  const first = join(firstRoot, "demo-one");
  const second = join(secondRoot, "demo-two");
  await createApp(first, { name: "demo", productName: "Demo" });
  await createApp(second, { name: "demo", productName: "Demo" });

  const resolved = run(["app", "path", "demo"], {
    home: join(fixture, "home"),
    roots: `${firstRoot}${delimiter}${secondRoot}`,
  });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(resolved.stdout.trim(), await realpath(first));
});

test("runs the app's declared package manager instead of hardcoded pnpm", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-pm-declared-"));
  const binDir = await createMockBin(join(fixture, "bin"), "bun");
  const root = join(fixture, "projects");
  await createAppWithPm(join(root, "wxmp-cracker-app"), "wxmp-cracker-app", {
    packageManager: "bun@1.3.11",
  });

  const resolved = run(["app", "wxmp-cracker-app", "dev"], {
    home: join(fixture, "home"),
    roots: root,
    path: binDir,
  });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.match(resolved.stdout, /bun:dev/);
  assert.match(resolved.stderr, /Using bun for wxmp-cracker-app/);
});

test("falls back to the lockfile package manager when none is declared", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-pm-lockfile-"));
  const binDir = await createMockBin(join(fixture, "bin"), "bun");
  const root = join(fixture, "projects");
  await createAppWithPm(join(root, "bun-app"), "bun-app", { lockfile: "bun.lock" });

  const resolved = run(["app", "bun-app", "dev"], {
    home: join(fixture, "home"),
    roots: root,
    path: binDir,
  });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.match(resolved.stdout, /bun:dev/);
});

test("drops a redundant package-manager prefix from the command", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-pm-prefix-"));
  const binDir = await createMockBin(join(fixture, "bin"), "bun");
  const root = join(fixture, "projects");
  await createAppWithPm(join(root, "wxmp-cracker-app"), "wxmp-cracker-app", {
    packageManager: "bun@1.3.11",
  });

  const resolved = run(["app", "wxmp-cracker-app", "bun", "run", "dev"], {
    home: join(fixture, "home"),
    roots: root,
    path: binDir,
  });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.match(resolved.stdout, /bun:run dev/);
  assert.match(resolved.stderr, /dropped redundant 'bun'/);
});

test("defaults to pnpm when no package manager is declared or detected", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-pm-default-"));
  const binDir = await createMockBin(join(fixture, "bin"), "pnpm");
  const root = join(fixture, "projects");
  await createAppWithPm(join(root, "plain-app"), "plain-app");

  const resolved = run(["app", "plain-app", "dev"], {
    home: join(fixture, "home"),
    roots: root,
    path: binDir,
  });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.match(resolved.stdout, /pnpm:dev/);
});

test("labels a tmux pane while an app command runs and restores its original title", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-tmux-title-"));
  const binDir = join(fixture, "bin");
  await createMockBin(binDir, "pnpm");
  await createMockTmux(binDir);
  const root = join(fixture, "projects");
  await createApp(join(root, "lumos"), { name: "lumos", productName: "Lumos" });
  const log = join(fixture, "tmux.log");
  const home = join(fixture, "home");

  const resolved = run(["app", "lumos", "dev"], {
    home,
    roots: root,
    path: binDir,
    env: {
      TMUX: "/tmp/tmux-test/default,1,0",
      TMUX_PANE: "%7",
      TMUX_TEST_LOG: log,
      TMUX_TEST_ORIGINAL_TITLE: "original shell",
      TMUX_TEST_BORDER_STATUS: "off",
    },
  });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.match(resolved.stderr, /Log: .*logs\/apps\/lumos\/.*-dev\.log/);

  const appLogs = await readdir(join(home, "logs", "apps", "lumos"));
  assert.equal(appLogs.length, 1);
  const appLog = join(home, "logs", "apps", "lumos", appLogs[0]);

  const calls = await readFile(log, "utf8");
  assert.ok(calls.includes(`[pipe-pane][-O][-t][%7][cat >> '${appLog}']`));
  assert.ok(calls.includes(
    `[select-pane][-t][%7][-T][Lumos · dev · log ${appLog}]`,
  ));
  assert.match(
    calls,
    /\[set-option\]\[-w\]\[-t\]\[%7\]\[pane-border-status\]\[top\]/,
  );
  assert.ok(calls.includes(
    "[set-option][-w][-t][%7][pane-border-format]"
      + "[#[align=left]#{?pane_active,#[reverse],#[fg=colour117]}## #{?#{e|<:#{pane_index},10},0,}#{pane_index}: #{pane_title}#[default]]",
  ));
  assert.match(calls, /\[show-options\]\[-wAv\]/);
  assert.match(calls, /\[pipe-pane\]\[-t\]\[%7\]/);
  assert.match(calls, /\[select-pane\]\[-t\]\[%7\]\[-T\]\[original shell\]\s*$/);
});

test("preserves an existing tmux pane pipe instead of replacing it", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-tmux-existing-pipe-"));
  const binDir = join(fixture, "bin");
  await createMockBin(binDir, "pnpm");
  await createMockTmux(binDir);
  const root = join(fixture, "projects");
  await createApp(join(root, "lumos"), { name: "lumos", productName: "Lumos" });
  const home = join(fixture, "home");
  const tmuxLog = join(fixture, "tmux.log");

  const resolved = run(["app", "lumos", "dev"], {
    home,
    roots: root,
    path: binDir,
    env: {
      TMUX: "/tmp/tmux-test/default,1,0",
      TMUX_PANE: "%9",
      TMUX_TEST_LOG: tmuxLog,
      TMUX_TEST_ORIGINAL_TITLE: "existing pipe",
      TMUX_TEST_BORDER_STATUS: "top",
      TMUX_TEST_PANE_PIPE: "1",
    },
  });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.doesNotMatch(resolved.stderr, /Log:/);
  assert.match(resolved.stderr, /could not attach an app log/);
  assert.deepEqual(await readdir(join(home, "logs", "apps", "lumos")), []);

  const calls = await readFile(tmuxLog, "utf8");
  assert.doesNotMatch(calls, /\[pipe-pane\]/);
  assert.match(calls, /\[select-pane\]\[-t\]\[%9\]\[-T\]\[Lumos · dev\]/);
});

test("restores the tmux pane title when the app command fails", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-tmux-failure-"));
  const binDir = join(fixture, "bin");
  await createMockTmux(binDir);
  const pnpm = join(binDir, "pnpm");
  await writeFile(pnpm, "#!/bin/sh\nexit 23\n");
  await chmod(pnpm, 0o755);
  const root = join(fixture, "projects");
  await createApp(join(root, "lumos"), { name: "lumos", productName: "Lumos" });
  const log = join(fixture, "tmux.log");

  const resolved = run(["app", "lumos", "dev"], {
    home: join(fixture, "home"),
    roots: root,
    path: binDir,
    env: {
      TMUX: "/tmp/tmux-test/default,1,0",
      TMUX_PANE: "%8",
      TMUX_TEST_LOG: log,
      TMUX_TEST_ORIGINAL_TITLE: "before failure",
      TMUX_TEST_BORDER_STATUS: "top",
    },
  });
  assert.equal(resolved.status, 23, resolved.stderr);

  const calls = await readFile(log, "utf8");
  assert.doesNotMatch(calls, /\[set-option\].*\[pane-border-status\]/);
  assert.match(calls, /\[pane-border-format\]/);
  assert.match(calls, /\[select-pane\]\[-t\]\[%8\]\[-T\]\[before failure\]\s*$/);
});
