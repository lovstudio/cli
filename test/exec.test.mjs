import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const execModule = pathToFileURL(join(repoRoot, "src", "lib", "exec.mjs")).href;

test("runInheritAsync invokes cleanup before forwarding SIGINT", () => {
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
