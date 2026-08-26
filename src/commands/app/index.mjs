import { unlink } from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute } from "node:path";
import { createInterface } from "node:readline/promises";
import { createAppRunLog, displayAppRunLogPath } from "../../lib/app-run-log.mjs";
import { hasBin, runInheritAsync } from "../../lib/exec.mjs";
import {
  formatTmuxPaneTitle,
  setTmuxPaneTitle,
  startTmuxPaneLog,
} from "../../lib/tmux-pane-title.mjs";
import {
  addAppMapping,
  addAppFromPath,
  addAppSearchRoot,
  AmbiguousAppError,
  appRegistryPath,
  appSearchRoots,
  inspectApp,
  listApps,
  removeAppMapping,
  resolveApp,
} from "./resolver.mjs";

function printHelp() {
  console.log(`Run commands inside local apps with their package manager

Usage:
  lovstudio app <name> <command...>
  lovstudio app add <path>
  lovstudio app add <name> [path]
  lovstudio app remove <name>
  lovstudio app path <name>
  lovstudio app list
  lovstudio find-app <name>

Discovery:
  LOVSTUDIO_APP_PATH uses ${delimiter === ":" ? "colon" : "semicolon"}-separated app roots, like PATH.
  app add can remember the project's parent directory as a persistent search root.
  Apps are matched by directory name, package.json name, or Tauri productName.

Examples:
  lovstudio app ataru tauri dev
  lovstudio app add ~/projects/lovcode
  lovstudio app add ataru ~/projects/lovcode
  lovstudio app path ataru
  lovstudio find-app oneshot
  lovstudio app remove ataru
  lovstudio app list
`);
}

function printFindAppHelp() {
  console.log(`Find the path to a local app

Usage:
  lovstudio find-app <name>

Apps are matched by directory name, package.json name, or Tauri productName.
This command is an alias for \`lovstudio app path <name>\`.

Example:
  lovstudio find-app oneshot
`);
}

async function printSearchHelp(name) {
  console.error(`could not resolve app: ${name}`);
  console.error("searched app roots:");
  for (const root of await appSearchRoots()) console.error(`  ${root}`);
  console.error(`add it explicitly: lovstudio app add ${name} /path/to/app`);
  console.error("or set LOVSTUDIO_APP_PATH to your app root directories");
}

async function offerPersistentSearchRoot(app) {
  const root = dirname(app.path);
  if ((await appSearchRoots()).includes(root)) return;

  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    while (true) {
      let answer;
      try {
        answer = await prompt.question(
          `Add ${root} as a persistent app search root so sibling apps can be discovered automatically? [Y/n] `,
        );
      } catch {
        return;
      }

      const choice = answer.trim().toLowerCase();
      if (!choice || choice === "y" || choice === "yes") {
        const result = await addAppSearchRoot(root);
        console.log(`${result.added ? "added" : "already configured"} app search root: ${result.path}`);
        return;
      }
      if (choice === "n" || choice === "no") return;
      if (!process.stdin.isTTY) return;
      console.error("Enter yes or no.");
    }
  } finally {
    prompt.close();
  }
}

async function chooseAmbiguousApp(error) {
  console.error(`Multiple apps match '${error.appName}':`);
  error.matches.forEach((app, index) => {
    console.error(`  ${index + 1}) ${basename(app.path)}  ${app.path}`);
  });

  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    while (true) {
      let answer;
      try {
        answer = await prompt.question(
          `Choose an app [1-${error.matches.length}] (selection will be remembered): `,
        );
      } catch {
        throw error;
      }
      const choice = Number(answer.trim());
      if (Number.isInteger(choice) && choice >= 1 && choice <= error.matches.length) {
        return error.matches[choice - 1];
      }
      if (!process.stdin.isTTY && !answer.trim()) throw error;
      console.error(`Enter a number from 1 to ${error.matches.length}.`);
    }
  } finally {
    prompt.close();
  }
}

async function resolveAppForCommand(name) {
  try {
    return await resolveApp(name);
  } catch (error) {
    if (!(error instanceof AmbiguousAppError)) throw error;
    const selected = await chooseAmbiguousApp(error);
    const remembered = await addAppMapping(name, selected.path);
    console.error(`Remembered ${remembered.name} -> ${remembered.path}`);
    return remembered;
  }
}

async function addAction(args) {
  const [name, path] = args;
  if (!name) {
    console.error("usage: lovstudio app add <path> | <name> [path]");
    process.exit(2);
  }

  let app;
  if (path !== undefined) {
    app = await addAppMapping(name, path);
  } else {
    const detected = await inspectApp(name);
    const explicitPath = isAbsolute(name)
      || name === "."
      || name === ".."
      || /^(?:~|\.{1,2})[\\/]/.test(name);
    app = detected || explicitPath
      ? await addAppFromPath(name)
      : await addAppMapping(name, ".");
  }
  console.log(`${app.replaced ? "updated" : "added"} ${app.name} -> ${app.path}`);
  await offerPersistentSearchRoot(app);
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
  try {
    const fallback = await resolveApp(name);
    if (fallback) console.log(`still auto-discovered at ${fallback.path}`);
  } catch (error) {
    if (!(error instanceof AmbiguousAppError)) throw error;
    console.log("multiple auto-discovered apps remain; the next command will ask you to choose");
  }
}

async function pathAction(args, usage = "lovstudio app path <name>") {
  const [name] = args;
  if (!name) {
    console.error(`usage: ${usage}`);
    process.exit(2);
  }
  const app = await resolveAppForCommand(name);
  if (!app) {
    await printSearchHelp(name);
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
  console.log(`Search roots: ${(await appSearchRoots()).join(delimiter)}`);
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

  const app = await resolveAppForCommand(name);
  if (!app) {
    await printSearchHelp(name);
    process.exit(2);
  }
  if (app.source === "missing") {
    console.error(`mapped app directory is unavailable: ${app.path}`);
    process.exit(1);
  }
  const packageManager = app.packageManager || "pnpm";
  if (!hasBin(packageManager)) {
    console.error(`${packageManager} is required but was not found in PATH`);
    process.exit(127);
  }

  let runCommand = command;
  if (runCommand[0] === packageManager) {
    runCommand = runCommand.slice(1);
    console.error(`note: dropped redundant '${packageManager}' — it is added automatically`);
  }
  if (runCommand.length === 0) {
    console.error(`missing command for app: ${name}`);
    console.error(`example: lovstudio app ${name} tauri dev`);
    process.exit(2);
  }

  let logPath = null;
  let stopPaneLog = null;
  if (process.env.TMUX && process.env.TMUX_PANE) {
    try {
      logPath = await createAppRunLog(app.displayName || name, runCommand);
      stopPaneLog = startTmuxPaneLog(logPath);
      if (!stopPaneLog) {
        await unlink(logPath).catch(() => {});
        console.error(
          "warning: could not attach an app log to this tmux pane; command will continue",
        );
        logPath = null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`warning: app log unavailable: ${message}`);
      logPath = null;
    }
  }

  if (app.source === "auto") console.log(`Discovered ${name} at ${app.path}`);
  if (packageManager !== "pnpm") console.error(`Using ${packageManager} for ${name}`);
  if (logPath) console.error(`Log: ${logPath}`);
  const paneTitle = formatTmuxPaneTitle(
    app.displayName || name,
    runCommand,
    logPath ? displayAppRunLogPath(logPath) : null,
  );
  const restorePaneTitle = setTmuxPaneTitle(paneTitle);
  let code;
  try {
    code = await runInheritAsync(
      packageManager,
      runCommand,
      { cwd: app.path },
      { onSignal: restorePaneTitle },
    );
  } finally {
    stopPaneLog?.();
    restorePaneTitle();
  }
  process.exit(code);
}

export const appCommand = {
  summary: "discover and run commands inside local apps",

  async run(args) {
    try {
      await runAppCommand(args);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
};

export const findAppCommand = {
  summary: "print the path to a local app",

  async run(args) {
    if (
      args.length === 0
      || args[0] === "-h"
      || args[0] === "--help"
      || args[0] === "help"
    ) {
      printFindAppHelp();
      return;
    }

    try {
      await pathAction(args, "lovstudio find-app <name>");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
};
