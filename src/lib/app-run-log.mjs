import { mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { appRegistryPath, normalizeAppName } from "../commands/app/resolver.mjs";

function timestampForFilename(date) {
  return date.toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-");
}

function commandName(command) {
  return (normalizeAppName(command.slice(0, 2).join("-")) || "command").slice(0, 48);
}

export async function createAppRunLog(
  appName,
  command,
  { now = new Date(), pid = process.pid } = {},
) {
  const app = normalizeAppName(appName) || "app";
  const directory = join(dirname(appRegistryPath()), "logs", "apps", app);
  const filename = `${timestampForFilename(now)}-${pid}-${commandName(command)}.log`;
  const path = join(directory, filename);

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = await open(path, "wx", 0o600);
  await file.close();
  return path;
}

export function displayAppRunLogPath(path, home = homedir()) {
  const fromHome = relative(home, path);
  if (fromHome && fromHome !== ".." && !fromHome.startsWith(`..${sep}`)) {
    return `~/${fromHome}`;
  }
  return path;
}
