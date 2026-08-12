import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hasBin, runInherit } from "../../lib/exec.mjs";

const APP_PATHS = {
  vmux: ["lovstudio", "coding", "Vmux"],
};

function appPath(name) {
  const segments = APP_PATHS[String(name).trim().toLowerCase()];
  return segments ? join(homedir(), ...segments) : null;
}

function printAppList() {
  console.log("Configured Lovstudio apps:\n");
  for (const name of Object.keys(APP_PATHS)) {
    console.log(`  ${name.padEnd(12)} ${appPath(name)}`);
  }
}

function printHelp() {
  console.log(`Run pnpm commands inside a local Lovstudio app

Usage:
  lovstudio app <name> <command...>
  lovstudio app list

Examples:
  lovstudio app vmux tauri dev
  lovstudio app vmux install
  lovstudio app list
`);
}

export const appCommand = {
  summary: "run pnpm commands inside local apps",

  async run(args) {
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help" || args[0] === "help") {
      printHelp();
      return;
    }

    if (args[0] === "list") {
      printAppList();
      return;
    }

    const [name, ...command] = args;
    const cwd = appPath(name);
    if (!cwd) {
      console.error(`unknown app: ${name}`);
      console.error("run 'lovstudio app list' for configured apps");
      process.exit(2);
    }
    if (command.length === 0) {
      console.error(`missing command for app: ${name}`);
      console.error(`example: lovstudio app ${name} tauri dev`);
      process.exit(2);
    }
    if (!existsSync(cwd)) {
      console.error(`app directory not found: ${cwd}`);
      process.exit(1);
    }
    if (!hasBin("pnpm")) {
      console.error("pnpm is required but was not found in PATH");
      process.exit(127);
    }

    const code = runInherit("pnpm", command, { cwd });
    process.exit(code);
  },
};
