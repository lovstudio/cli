import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { runCapture, runInherit, runInheritAsync } from "../src/lib/exec.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const execModule = pathToFileURL(join(repoRoot, "src", "lib", "exec.mjs")).href;

test("runInheritAsync invokes cleanup before forwarding SIGINT", { skip: process.platform === "win32" }, () => {
  const program = `
    import { runInheritAsync } from ${JSON.stringify(execModule)};
    setTimeout(() => process.kill(process.pid, "SIGINT"), 100);
    const code = await runInheritAsync(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {},
      { onSignal: (signal) => console.log("cleanup:" + signal) },
    );
    console.log("exit:" + code);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
    encoding: "utf8",
    timeout: 5_000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /cleanup:SIGINT/);
  assert.match(result.stdout, /exit:130/);
});

test("command runners preserve native arguments and exit codes", async () => {
  const args = ["space here", 'a"quote', "a&b", "%PATH%", "", "路径"];
  const captured = runCapture(process.execPath, ["-e", "console.log(JSON.stringify(process.argv.slice(1))); process.exit(23)", "--", ...args]);
  assert.ok(!captured.error, captured.error?.message);
  assert.equal(captured.status, 23);
  assert.deepEqual(JSON.parse(captured.stdout), args);
  assert.equal(runInherit(process.execPath, ["-e", "process.exit(23)"], { stdio: "ignore" }), 23);
  assert.equal(await runInheritAsync(process.execPath, ["-e", "process.exit(23)"], { stdio: "ignore" }), 23);
});

test("command runners report missing executables", async () => {
  const missing = "lovstudio-nonexistent-command-568d2eb1";
  assert.equal(runCapture(missing, []).error?.code, "ENOENT");
  assert.throws(() => runInherit(missing, []), { code: "ENOENT" });
  await assert.rejects(runInheritAsync(missing, []), { code: "ENOENT" });
});

test("npx can be launched through the command runner", () => {
  const result = runCapture("npx", ["--version"], { timeout: 30_000 });
  assert.ok(!result.error, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("Windows npm shims preserve arguments through all command runners", { skip: process.platform !== "win32" }, async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio exec spaces "));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const binDir = join(fixture, "node_modules", ".bin");
  await mkdir(binDir, { recursive: true });
  const script = join(fixture, "echo-args.cjs");
  const output = join(fixture, "args.json");
  await writeFile(script, `
    const args = JSON.stringify(process.argv.slice(2));
    require('node:fs').writeFileSync(process.env.LOVSTUDIO_TEST_ARGS, args);
    console.log(args);
    process.exit(23);
  `);
  for (const command of ["npm", "npx", "pnpm", "yarn"]) {
    await writeFile(join(binDir, `${command}.cmd`), `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
  env.PATH = `${binDir}${delimiter}${process.env.PATH || process.env.Path || ""}`;
  env.LOVSTUDIO_TEST_ARGS = output;
  const args = ["-y", "skills", "add", "lovstudio/test-skill", "--skill", "lov-test", "-a", "codex", "--global", "--yes", "space here", 'a"quote', "a&b", "x|y", "(a)", "%PATH%", "a^b", "", "路径", "C:\\path with spaces\\"];
  for (const command of ["npm", "npx", "pnpm", "yarn", join(binDir, "npx.cmd")]) {
    const result = runCapture(command, args, { env });
    assert.ok(!result.error, result.error?.message);
    assert.equal(result.status, 23, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), args);
    assert.equal(runInherit(command, args, { env, stdio: "ignore" }), 23);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), args);
    await writeFile(output, "null");
    assert.equal(await runInheritAsync(command, args, { env, stdio: "ignore" }), 23);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), args);
  }
});
