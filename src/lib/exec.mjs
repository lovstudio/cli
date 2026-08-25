import { spawn, spawnSync } from "node:child_process";
import { constants } from "node:os";

const WINDOWS_CMD_SHIMS = new Set(["npm", "npx", "pnpm", "yarn"]);

export function commandForPlatform(cmd) {
  if (process.platform !== "win32") return cmd;
  if (!WINDOWS_CMD_SHIMS.has(cmd)) return cmd;
  return `${cmd}.cmd`;
}

// Run a command inheriting stdio. Returns exit code.
export function runInherit(cmd, args, opts = {}) {
  const res = spawnSync(commandForPlatform(cmd), args, { stdio: "inherit", ...opts });
  if (res.error) throw res.error;
  return res.status ?? 1;
}

// Run a command inheriting stdio without blocking Node's signal handlers.
// The callback runs before the signal is forwarded so callers can restore UI state.
export function runInheritAsync(cmd, args, opts = {}, { onSignal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandForPlatform(cmd), args, { stdio: "inherit", ...opts });
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
    let receivedSignal = null;

    const handlers = new Map(signals.map((signal) => [signal, () => {
      receivedSignal ||= signal;
      onSignal?.(signal);
      child.kill(signal);
    }]));
    for (const [signal, handler] of handlers) process.on(signal, handler);

    const removeHandlers = () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    };

    child.once("error", (error) => {
      removeHandlers();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      removeHandlers();
      const finalSignal = receivedSignal || signal;
      if (finalSignal) {
        resolve(128 + (constants.signals[finalSignal] || 1));
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

// Run a command capturing stdout. Returns { status, stdout, stderr }.
export function runCapture(cmd, args, opts = {}) {
  const res = spawnSync(commandForPlatform(cmd), args, { encoding: "utf8", ...opts });
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
  const candidates = process.platform === "win32"
    ? [commandForPlatform(bin), bin]
    : [bin];
  return candidates.some((candidate) => {
    const res = spawnSync(finder, [candidate], { stdio: "ignore" });
    return res.status === 0;
  });
}
