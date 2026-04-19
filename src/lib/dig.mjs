import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export async function dig(args) {
  try {
    const { stdout } = await pexec("dig", args, { timeout: 10_000 });
    return stdout
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
