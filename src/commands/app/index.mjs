import { delimiter } from "node:path";
import { hasBin, runInherit } from "../../lib/exec.mjs";
import {
  addAppMapping,
  appRegistryPath,
  appSearchRoots,
  listApps,
  removeAppMapping,
  resolveApp,
} from "./resolver.mjs";

function printHelp() {
  console.log(`Run pnpm commands inside local apps

Usage:
  lovstudio app <name> <command...>
  lovstudio app add <name> [path]
  lovstudio app remove <name>
  lovstudio app path <name>
  lovstudio app list

Discovery:
  LOVSTUDIO_APP_PATH uses ${delimiter === ":" ? "colon" : "semicolon"}-separated app roots, like PATH.
  Apps are matched by directory name, package.json name, or Tauri productName.

Examples:
  lovstudio app ataru tauri dev
  lovstudio app add ataru ~/projects/lovcode
  lovstudio app path ataru
  lovstudio app remove ataru
  lovstudio app list
`);
}

function printSearchHelp(name) {
  console.error(`could not resolve app: ${name}`);
  console.error("searched app roots:");
  for (const root of appSearchRoots()) console.error(`  ${root}`);
  console.error(`add it explicitly: lovstudio app add ${name} /path/to/app`);
  console.error("or set LOVSTUDIO_APP_PATH to your app root directories");
}

async function addAction(args) {
  const [name, path = "."] = args;
  if (!name) {
    console.error("usage: lovstudio app add <name> [path]");
    process.exit(2);
  }
  const app = await addAppMapping(name, path);
  console.log(`${app.replaced ? "updated" : "added"} ${app.name} -> ${app.path}`);
}

async function removeAction(args) {
  const [name] = args;
  if (!name) {
    console.error("usage: lovstudio app remove <name>");
    process.exit(2);
  }
  if (!(await removeAppMapping(name))) {
    console.error(`no explicit mapping for app: ${name}`);
    console.error(`mappings file: ${appRegistryPath()}`);
    process.exit(2);
  }
  console.log(`removed explicit mapping: ${name}`);
  const fallback = await resolveApp(name);
  if (fallback) console.log(`still auto-discovered at ${fallback.path}`);
}

async function pathAction(args) {
  const [name] = args;
  if (!name) {
    console.error("usage: lovstudio app path <name>");
    process.exit(2);
  }
  const app = await resolveApp(name);
  if (!app) {
    printSearchHelp(name);
    process.exit(2);
  }
  if (app.source === "missing") {
    console.error(`mapped app directory is unavailable: ${app.path}`);
    process.exit(1);
  }
  console.log(app.path);
}

async function listAction() {
  const apps = await listApps();
  if (!apps.length) {
    console.log("No Lovstudio apps found.");
  } else {
    console.log("Lovstudio apps:\n");
    const width = Math.max(12, ...apps.map((app) => app.name.length + 2));
    for (const app of apps) {
      console.log(`  ${app.name.padEnd(width)} ${app.path}  [${app.source}]`);
    }
  }
  console.log(`\nMappings: ${appRegistryPath()}`);
  console.log(`Search roots: ${appSearchRoots().join(delimiter)}`);
}

async function runAppCommand(args) {
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help" || args[0] === "help") {
    printHelp();
    return;
  }

  const [action, ...rest] = args;
  if (action === "add") return addAction(rest);
  if (action === "remove") return removeAction(rest);
  if (action === "path") return pathAction(rest);
  if (action === "list") return listAction();

  const [name, ...command] = args;
  if (command.length === 0) {
    console.error(`missing command for app: ${name}`);
    console.error(`example: lovstudio app ${name} tauri dev`);
    process.exit(2);
  }

  const app = await resolveApp(name);
  if (!app) {
    printSearchHelp(name);
    process.exit(2);
  }
  if (app.source === "missing") {
    console.error(`mapped app directory is unavailable: ${app.path}`);
    process.exit(1);
  }
  if (!hasBin("pnpm")) {
    console.error("pnpm is required but was not found in PATH");
    process.exit(127);
  }

  if (app.source === "auto") console.log(`Discovered ${name} at ${app.path}`);
  const code = runInherit("pnpm", command, { cwd: app.path });
  process.exit(code);
}

export const appCommand = {
  summary: "discover and run pnpm commands inside local apps",

  async run(args) {
    try {
      await runAppCommand(args);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
};
