import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { hasBin, runCapture, runInherit } from "../../lib/exec.mjs";
import { runHelper } from "../../lib/helper.mjs";

const GALLERY = "lovstudio/skills";
const SKILLS_NPX_SPEC = "skills@latest";
const SKILL_PREFIX = "lovstudio-";
const ALL_SKILLS_NAMES = new Set(["*", "all", "skills", GALLERY]);

function isAllSkillsName(name) {
  return ALL_SKILLS_NAMES.has(String(name).trim().toLowerCase());
}

function skillSelector(name) {
  const value = String(name).trim();
  if (isAllSkillsName(value)) return "*";
  if (value.startsWith(SKILL_PREFIX)) return value;
  if (value.startsWith("lovstudio:")) return `${SKILL_PREFIX}${value.slice("lovstudio:".length)}`;
  return `${SKILL_PREFIX}${value}`;
}

// Where `npx skills add -g` writes the canonical bundle (vercel-labs/skills convention).
function globalSkillDir(name) {
  return join(homedir(), ".agents", "skills", skillSelector(name));
}

function ensureNpx() {
  if (hasBin("npx")) return;
  console.error(`error: \`npx\` not found. Install Node.js 18+ first (nodejs.org).`);
  process.exit(127);
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter / dependency preflight
// ─────────────────────────────────────────────────────────────────────────────

async function readSkillFrontmatter(name) {
  const path = join(globalSkillDir(name), "SKILL.md");
  if (!existsSync(path)) return null;
  const md = await readFile(path, "utf8");
  const m = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return null;
  try {
    const fm = parseYaml(m[1]) || {};
    if (!Array.isArray(fm.dependencies)) fm.dependencies = [];
    return fm;
  } catch {
    return null;
  }
}

function checkDep(dep) {
  if (!dep.check) return { ok: true };
  const res = runCapture("sh", ["-c", dep.check]);
  return { ok: res.status === 0 };
}

function preflightReport(name, deps) {
  if (!deps.length) return [];
  console.log(`\nDependency check for ${name}:`);
  const missing = [];
  for (const dep of deps) {
    const ok = checkDep(dep).ok;
    console.log(`  ${ok ? "✓" : "✗"} ${dep.name}`);
    if (!ok) missing.push(dep);
  }
  return missing;
}

function resolveMissing(missing, withDeps) {
  if (!missing.length) {
    console.log("\nAll dependencies satisfied.");
    return 0;
  }
  console.log(`\nMissing ${missing.length} dependenc${missing.length === 1 ? "y" : "ies"}:\n`);
  for (const dep of missing) {
    console.log(`  ${dep.name}`);
    console.log(`    install: ${dep.install ?? "(no install hint provided)"}`);
  }
  if (!withDeps) {
    console.log("\nRe-run with --with-deps to install them automatically,");
    console.log("or run each command above yourself.");
    return 0;
  }
  console.log("\nInstalling missing dependencies...");
  let failed = 0;
  for (const dep of missing) {
    if (!dep.install) {
      console.log(`  ! skipping ${dep.name} — no install command`);
      failed += 1;
      continue;
    }
    console.log(`\n$ ${dep.install}`);
    const status = runInherit("sh", ["-c", dep.install]);
    if (status !== 0) {
      console.log(`  ! ${dep.name} install exited ${status}`);
      failed += 1;
    }
  }
  return failed === 0 ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Arg parsing (mirrors 0.2.3's -k/-a/-g/-y surface)
// ─────────────────────────────────────────────────────────────────────────────

function parseAddArgs(argv) {
  const out = { name: null, key: null, agent: null, global: true, yes: false, withDeps: false, help: false, extra: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h": case "--help":
        out.help = true; break;
      case "-k": case "--key":
        out.key = argv[++i]; break;
      case "-a": case "--agent":
        out.agent = argv[++i]; break;
      case "-g": case "--global":
        out.global = true; break;
      case "-y": case "--yes":
        out.yes = true; break;
      case "--with-deps":
        out.withDeps = true; break;
      case "--project":
        out.global = false; break;
      default:
        if (a.startsWith("-")) out.extra.push(a);
        else if (out.name === null) out.name = a;
        else out.extra.push(a);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcommands
// ─────────────────────────────────────────────────────────────────────────────

async function addAction(rawArgs) {
  const args = parseAddArgs(rawArgs);
  if (args.help) {
    printHelp();
    return;
  }
  ensureNpx();
  if (!args.name) {
    console.error("usage: lovstudio skills add <name> [-k <license-key>] [-a <agent>] [-g] [-y] [--with-deps]");
    process.exit(2);
  }

  // 1. Optional license activation first. Install proceeds anyway if no -k
  //    was passed — lets people prep the bundle before they have a key.
  if (args.key) {
    const code = runHelper(["activate", args.key]);
    if (code !== 0) {
      console.error(`activation failed (exit ${code}). not installing skill.`);
      process.exit(code);
    }
  }

  // 2. Install via vercel-labs/skills. Use the namespaced form — that's how
  //    SKILL.md frontmatter declares skills in the index. Historical issue
  //    messages told users to pass `lovstudio/skills`; keep that as an alias
  //    for "install the whole catalog" so older copy-paste instructions work.
  const selector = skillSelector(args.name);
  const installAll = selector === "*";
  console.log(`Installing ${installAll ? "all Lovstudio skills" : args.name} from ${GALLERY}...`);
  const skillArgs = [
    "-y", SKILLS_NPX_SPEC, "add", GALLERY,
    "--skill", selector,
  ];
  if (args.agent) skillArgs.push("-a", args.agent);
  if (args.global) skillArgs.push("--global");
  if (args.yes) skillArgs.push("--yes");
  skillArgs.push(...args.extra);

  const installCode = runInherit("npx", skillArgs);
  if (installCode !== 0) {
    console.error(`\nnpx skills add exited ${installCode}`);
    process.exit(installCode);
  }

  // 3. Preflight deps from placeholder frontmatter. Only meaningful for
  //    single global installs — project installs land in ./skills/ with no
  //    easy way to locate from here, and full-catalog installs would need to
  //    aggregate many frontmatters.
  if (args.global && !installAll) {
    const fm = await readSkillFrontmatter(args.name);
    if (fm) {
      const missing = preflightReport(args.name, fm.dependencies);
      const code = resolveMissing(missing, args.withDeps);
      if (existsSync(join(globalSkillDir(args.name), "MANIFEST.enc.json")) && !args.key) {
        console.log("\nThis is a paid skill (encrypted). If you haven't activated yet:");
        console.log("  lovstudio license <your-key>");
      }
      process.exit(code);
    }
  }

  console.log(`\n✓ ${installAll ? "all Lovstudio skills" : args.name} installed.`);
  if (!args.key) {
    console.log(`  next: activate your license with`);
    console.log(`        lovstudio license <your-key>`);
  }
}

async function activateAction(rest) {
  if (rest.length === 0) {
    console.error("usage: lovstudio skills activate <license-key>");
    process.exit(2);
  }
  // Retained as a 0.2.3 alias — `lovstudio license <key>` is now preferred.
  process.exit(runHelper(["activate", rest[0]]));
}

async function listAction() {
  ensureNpx();
  // Defer to vercel-labs/skills — it clones the index and lists SKILL.md entries.
  process.exit(runInherit("npx", ["-y", SKILLS_NPX_SPEC, "add", GALLERY, "--list"]));
}

async function delegate(sub, args) {
  ensureNpx();
  process.exit(runInherit("npx", ["-y", SKILLS_NPX_SPEC, sub, ...args]));
}

function printHelp() {
  console.log(`lovstudio skills — install / manage Lovstudio skills

Usage:
  lovstudio skills add <name> [options]        install a skill
  lovstudio skills add skills [options]        install all Lovstudio skills
  lovstudio skills activate <key>              activate a license (alias of \`license <key>\`)
  lovstudio skills list                        list all Lovstudio skills
  lovstudio skills remove [<name>...]          uninstall
  lovstudio skills find [query]                search (delegates to npx skills)
  lovstudio skills update [<name>...]          update

Options for \`add\`:
  -k, --key <key>      license key. Activates before install (skip to activate later).
  -a, --agent <list>   target agent(s), comma-separated (see \`npx skills add --help\`)
  -g, --global         install globally into ~/.agents/skills/ and agent dirs (default)
      --project        install into ./skills/ for the current project
  -y, --yes            skip confirmation prompts
      --with-deps      auto-install missing runtime deps declared in SKILL.md

\`add\` installs from ${GALLERY} (no need to type the gallery path). Passing
\`skills\`, \`all\`, \`*\`, or \`${GALLERY}\` installs the full catalog. Single-skill
installs read the skill's \`dependencies:\` frontmatter and run each \`check\`
command. With --with-deps, missing ones are installed automatically.
`);
}

export const skillsCommand = {
  summary: "install / manage Lovstudio skills",
  async run(args) {
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
      printHelp();
      return;
    }
    const [sub, ...rest] = args;
    switch (sub) {
      case "add":
      case "a":
        return addAction(rest);
      case "activate":
        return activateAction(rest);
      case "list":
      case "ls":
        return listAction();
      case "remove":
      case "rm":
      case "find":
      case "update":
      case "upgrade":
        return delegate(sub, rest);
      default:
        console.error(`unknown subcommand: ${sub}`);
        console.error(`run 'lovstudio skills --help' for usage`);
        process.exit(2);
    }
  },
};
