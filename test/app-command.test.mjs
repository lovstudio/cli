import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
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

function run(args, { home, roots, cwd = repoRoot, input, path }) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      LOVSTUDIO_HOME: home,
      LOVSTUDIO_APP_PATH: roots,
      ...(path ? { PATH: `${path}${delimiter}${process.env.PATH}` } : {}),
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
