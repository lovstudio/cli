import { spawnSync } from "node:child_process";

// Run a command inheriting stdio. Returns exit code.
export function runInherit(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.error) throw res.error;
  return res.status ?? 1;
}

// Run a command capturing stdout. Returns { status, stdout, stderr }.
export function runCapture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return {
    status: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    error: res.error,
  };
}

// Check if a binary exists in PATH (POSIX-style).
export function hasBin(bin) {
  const finder = process.platform === "win32" ? "where" : "which";
  const res = spawnSync(finder, [bin], { stdio: "ignore" });
  return res.status === 0;
}
