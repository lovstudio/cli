import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
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

function run(args, { home, roots, cwd = repoRoot }) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      LOVSTUDIO_HOME: home,
      LOVSTUDIO_APP_PATH: roots,
    },
  });
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

  const added = run(["app", "add", "demo", app], { home, roots: emptyRoot });
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /added demo ->/);

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

test("an explicit mapping takes precedence over auto-discovery", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-app-precedence-"));
  const root = join(fixture, "projects");
  const automatic = join(root, "demo-auto");
  const explicit = join(fixture, "explicit", "demo");
  const home = join(fixture, "home");
  await createApp(automatic, { name: "demo", productName: "Demo" });
  await createApp(explicit, { name: "demo-explicit", productName: "Demo Explicit" });

  const added = run(["app", "add", "demo", explicit], { home, roots: root });
  assert.equal(added.status, 0, added.stderr);

  const resolved = run(["app", "path", "demo"], { home, roots: root });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(resolved.stdout.trim(), await realpath(explicit));
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
