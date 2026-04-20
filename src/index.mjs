import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dnsCommand } from "./commands/dns/index.mjs";
import { licenseCommand } from "./commands/license/index.mjs";
import { skillsCommand } from "./commands/skills/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Command registry. Add future commands here.
const COMMANDS = {
  dns: dnsCommand,
  license: licenseCommand,
  skills: skillsCommand,
};

async function readVersion() {
  const pkgPath = join(__dirname, "..", "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  return pkg.version;
}

function printRootHelp(version) {
  const cmds = Object.keys(COMMANDS)
    .map((n) => `  ${n.padEnd(10)} ${COMMANDS[n].summary}`)
    .join("\n");
  console.log(`lovstudio v${version} — install skills, activate licenses, ops

Usage:
  lovstudio <command> [subcommand] [options]

Commands:
${cmds}

Global:
  -h, --help      show help
  -v, --version   show version

Examples:
  lovstudio license <your-key>
  lovstudio skills add wxmp-cracker --with-deps
  lovstudio skills list
  lovstudio dns status
`);
}

export async function run(argv) {
  const version = await readVersion();

  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help") {
    printRootHelp(version);
    return;
  }
  if (argv[0] === "-v" || argv[0] === "--version") {
    console.log(version);
    return;
  }

  const [name, ...rest] = argv;
  const cmd = COMMANDS[name];
  if (!cmd) {
    console.error(`unknown command: ${name}`);
    console.error(`run 'lovstudio --help' for a list of commands`);
    process.exit(2);
  }

  await cmd.run(rest);
}
