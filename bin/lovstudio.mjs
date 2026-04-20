#!/usr/bin/env node
// lovstudio — thin installer/activator for Lovstudio skills.
//
// Composes two underlying tools:
//   1. `uvx lovstudio-skill-helper` — license activation + runtime decryption
//   2. `npx skills` (vercel-labs)   — marketplace + per-agent install
//
// We do not reimplement either one. We just resolve the flags users care
// about (skill name, license key, target agent) and fan them out.

import { spawn } from "node:child_process";

const HELP = `lovstudio — install and activate Lovstudio skills

Usage:
  npx lovstudio skills add <name> [options]      add a skill (and optionally activate a license)
  npx lovstudio skills activate <key>            activate/rebind a license key
  npx lovstudio skills list                      list all Lovstudio skills (free + paid)
  npx lovstudio license issue [options]          (admin) mint a new license key
  npx lovstudio --help                           this message

Options for \`skills add\`:
  -k, --key <key>           license key (lk-<64 hex>). Activates before install.
  -a, --agent <agents>      target agent(s), comma-separated. Default: interactive.
                            (see \`npx skills add --help\` for the full list — 40+ supported)
  -g, --global              install globally (user-level) instead of project-level
  -y, --yes                 skip confirmation prompts

Options for \`license issue\` (admin-only):
  --skills <csv>            skills to grant (comma-separated). Alias: --skill
  --scope global            shortcut: grant every skill in the catalog
  --scope category --scope-value <cat>   grant all skills in a category
  --user <uuid>             bind to an auth user (omit = anonymous key)
  --max-devices <n>         default: 1
  --expires-days <n>        default: 365 (0 = no expiry)
  --notes <text>            free-form note stored on the license row
  --force-new               mint new key even if user already has one
  --json                    raw JSON output

Examples:
  npx lovstudio skills add write-professional-book -k lk-abc... -y
  npx lovstudio skills add write-professional-book -a claude-code,cursor -y
  npx lovstudio skills activate lk-abc...
  npx lovstudio skills list
  npx lovstudio license issue --skills write-professional-book --notes "微信付款"
  npx lovstudio license issue --skill wxmp-cracker --expires-days 1 --notes "1天试用"
  npx lovstudio license issue --scope global --notes "全套体验"
`;

const INDEX_REPO = "lovstudio/skills";
const SKILL_PREFIX = "lovstudio:";

// Pin a minimum skill-helper version — the bare `uvx lovstudio-skill-helper`
// form happily reuses an older cached install and misses newer subcommands
// (e.g. `admin-issue-license` was added in 0.6.0).
const HELPER_MIN_VERSION = "0.6.0";
const HELPER_SPEC = `lovstudio-skill-helper>=${HELPER_MIN_VERSION}`;
const UVX_PREFIX = ["--from", HELPER_SPEC, "lovstudio-skill-helper"];

function die(msg, code = 1) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

// Run a child and inherit stdio so interactive prompts (login device flow,
// skills CLI's clack UI) still work. Returns the exit code.
function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        console.error(`error: '${cmd}' not found on PATH.`);
        if (cmd === "uvx") {
          console.error("  install uv: curl -LsSf https://astral.sh/uv/install.sh | sh");
        } else if (cmd === "npx") {
          console.error("  npx ships with Node.js >=18 — check your installation.");
        }
        resolve(127);
      } else {
        console.error(`error: failed to spawn ${cmd}: ${err.message}`);
        resolve(1);
      }
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

// Minimal flag parser — keeps it dependency-free. Not a full getopt clone:
// we only support flags we actually declare. Unknown flags pass through to
// the underlying `npx skills` call where applicable.
function parseArgs(argv) {
  const out = { positional: [], flags: {}, passthrough: [] };
  const known = {
    "-k": "key", "--key": "key",
    "-a": "agent", "--agent": "agent",
    "-g": "global", "--global": "global",
    "-y": "yes", "--yes": "yes",
    "-h": "help", "--help": "help",
  };
  const valued = new Set(["key", "agent"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const name = known[a];
    if (name) {
      if (valued.has(name)) {
        const v = argv[++i];
        if (v === undefined) die(`${a} requires a value`);
        out.flags[name] = v;
      } else {
        out.flags[name] = true;
      }
    } else if (a.startsWith("-")) {
      out.passthrough.push(a);
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

async function cmdSkillsAdd(args) {
  const { positional, flags } = args;
  if (flags.help || positional.length === 0) {
    process.stdout.write(HELP);
    process.exit(flags.help ? 0 : 2);
  }
  const skillName = positional[0];

  // 1. Activate license first (if a key was passed). Skipping this when the
  //    user omits -k lets them install the encrypted bundle ahead of getting
  //    their key — e.g. they saw a friend use the skill and want it ready.
  if (flags.key) {
    const activateCode = await run("uvx", [...UVX_PREFIX, "activate", flags.key]);
    if (activateCode !== 0) {
      die(`activation failed (exit ${activateCode}). not installing skill.`, activateCode);
    }
  }

  // 2. Install the skill via vercel-labs/skills. We always pass the
  //    namespaced `lovstudio:<name>` form since that's how SKILL.md
  //    frontmatter declares it in the index.
  const skillArgs = ["-y", "skills", "add", INDEX_REPO,
    "-s", `${SKILL_PREFIX}${skillName}`];
  if (flags.agent) skillArgs.push("-a", flags.agent);
  if (flags.global) skillArgs.push("-g");
  if (flags.yes) skillArgs.push("-y");

  const installCode = await run("npx", skillArgs);
  if (installCode !== 0) {
    die(`skill install failed (exit ${installCode}).`, installCode);
  }

  console.log("");
  console.log(`✓ ${skillName} installed.`);
  if (!flags.key) {
    console.log(`  next: activate your license with`);
    console.log(`        npx lovstudio skills activate lk-<your-key>`);
  }
}

async function cmdSkillsActivate(args) {
  const { positional } = args;
  if (positional.length === 0) die("usage: npx lovstudio skills activate <license-key>");
  const code = await run("uvx", [...UVX_PREFIX, "activate", positional[0]]);
  process.exit(code);
}

async function cmdLicenseIssue(argv) {
  // Pass admin flags through verbatim to the hidden skill-helper subcommand.
  // `uvx` ensures any admin on any machine runs the same pinned version.
  const passthrough = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skills" || a === "--skill" || a === "--user" || a === "--max-devices" ||
        a === "--expires-days" || a === "--notes" || a === "--source" ||
        a === "--scope" || a === "--scope-value") {
      const v = argv[++i];
      if (v === undefined) die(`${a} requires a value`);
      // Accept --skill as an alias for --skills (common typo).
      passthrough.push(a === "--skill" ? "--skills" : a, v);
    } else if (a === "--force-new" || a === "--json") {
      passthrough.push(a);
    } else if (a === "-h" || a === "--help") {
      process.stdout.write(HELP);
      process.exit(0);
    } else {
      die(`unknown flag for 'license issue': ${a}`);
    }
  }
  const code = await run("uvx", [...UVX_PREFIX, "admin-issue-license", ...passthrough]);
  process.exit(code);
}

async function cmdSkillsList() {
  // Defer entirely to vercel-labs/skills — it already knows how to clone the
  // index and list SKILL.md entries. -l flag = "list without install".
  const code = await run("npx", ["-y", "skills", "add", INDEX_REPO, "-l"]);
  process.exit(code);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    process.exit(argv.length === 0 ? 2 : 0);
  }

  const noun = argv[0];
  const subcmd = argv[1];

  if (noun === "skills") {
    const rest = parseArgs(argv.slice(2));
    switch (subcmd) {
      case "add":      return cmdSkillsAdd(rest);
      case "activate": return cmdSkillsActivate(rest);
      case "list":     return cmdSkillsList();
      default:
        die(`unknown subcommand 'skills ${subcmd ?? "(none)"}'. try 'npx lovstudio --help'.`);
    }
  }

  if (noun === "license") {
    if (subcmd === "issue") return cmdLicenseIssue(argv.slice(2));
    die(`unknown subcommand 'license ${subcmd ?? "(none)"}'. try 'npx lovstudio --help'.`);
  }

  die(`unknown command '${noun}'. try 'npx lovstudio --help'.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
