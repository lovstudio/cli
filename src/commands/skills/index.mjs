import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parse as parseYaml } from "yaml";
import { hasBin, runCapture, runInherit } from "../../lib/exec.mjs";
import { hfetch } from "../../lib/fetch.mjs";
import { runHelper } from "../../lib/helper.mjs";

const GALLERY = "lovstudio/skills";
const SKILLS_NPX_SPEC = "skills@latest";
const SKILL_PREFIX = "lovstudio-";
const ALL_SKILLS_NAMES = new Set(["*", "all", "skills", GALLERY]);
const CATALOG_URL = process.env.LOVSTUDIO_SKILLS_CATALOG_URL ||
  `https://raw.githubusercontent.com/${GALLERY}/main/skills.yaml`;
const WEB_URL = (process.env.LOVSTUDIO_WEB_URL || "https://lovstudio.ai").replace(/\/$/, "");

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

function authFilePath() {
  const root = process.env.LOVSTUDIO_HOME || join(homedir(), ".lovstudio");
  return join(root, "auth.yml");
}

async function readAccountSession() {
  try {
    return parseYaml(await readFile(authFilePath(), "utf8")) || null;
  } catch {
    return null;
  }
}

async function requireAccountToken() {
  let session = await readAccountSession();
  const expiresAt = Number(session?.expires_at || 0);
  if (!session?.access_token || expiresAt <= Math.floor(Date.now() / 1000) + 60) {
    console.log("\n需要登录 Lovstudio 账户，正在打开登录确认页…");
    const code = runHelper(["login"]);
    if (code !== 0) {
      console.error(`登录未完成（退出码 ${code}），未安装付费 Skill。`);
      process.exit(code || 1);
    }
    session = await readAccountSession();
  }
  if (!session?.access_token) {
    console.error("登录状态未找到，未安装付费 Skill。请重新运行并完成登录。 ");
    process.exit(1);
  }
  return session.access_token;
}

async function loadCatalog() {
  const response = await hfetch(CATALOG_URL, {
    headers: { accept: "text/yaml, text/plain" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`catalog request failed: HTTP ${response.status}`);
  }
  const data = parseYaml(await response.text()) || {};
  return Array.isArray(data.skills) ? data.skills.filter((skill) => !skill.test) : [];
}

function canonicalSkillName(name) {
  const value = String(name).trim();
  if (value.startsWith(SKILL_PREFIX)) return value.slice(SKILL_PREFIX.length);
  if (value.startsWith("lovstudio:")) return value.slice("lovstudio:".length);
  return value;
}

async function resolveCatalogSkill(name) {
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (error) {
    console.error(`读取 Lovstudio Skills 目录失败：${error instanceof Error ? error.message : String(error)}`);
    console.error("为保护付费 Skill，目录不可用时不会继续安装。稍后重试即可。");
    process.exit(1);
  }
  const canonical = canonicalSkillName(name);
  const skill = catalog.find((entry) => entry?.name === canonical);
  if (!skill) {
    console.error(`目录中没有找到 Skill：${canonical}`);
    console.error(`查看可用 Skill：npx lovstudio skills list`);
    process.exit(2);
  }
  return skill;
}

async function resolveFreeCatalogSelectors() {
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (error) {
    console.error(`读取 Lovstudio Skills 目录失败：${error instanceof Error ? error.message : String(error)}`);
    console.error("为保护付费 Skill，目录不可用时不会继续批量安装。稍后重试即可。");
    process.exit(1);
  }
  const selectors = catalog
    .filter((skill) => !skill?.paid)
    .map((skill) => skillSelector(skill.name))
    .filter(Boolean);
  if (!selectors.length) {
    console.error("统一目录中没有可直接安装的免费 Skill。");
    process.exit(1);
  }
  return selectors;
}

async function fetchRedemptionPrice(name) {
  const url = `${WEB_URL}/api/skills/price?name=${encodeURIComponent(name)}`;
  const response = await hfetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.price_credits !== "number") {
    throw new Error(body.error || `price request failed: HTTP ${response.status}`);
  }
  return body;
}

async function confirmPurchase(name, price, yes) {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    console.error(`付费 Skill 需要确认兑换 ${price.price_credits} Credits；非交互环境请追加 --yes。`);
    return false;
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`「${name}」需要 ${price.price_credits} Credits，继续兑换并安装吗？[y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

async function redeemPaidSkill(skill, yes) {
  if (!skill.encrypted_bundle) {
    console.error(`Skill「${skill.name}」已标记为付费，但聚合目录还没有可分发的加密包。`);
    console.error("发布者需要先完成加密打包；本次不会下载明文代码。");
    process.exit(1);
  }

  let price;
  try {
    price = await fetchRedemptionPrice(skill.name);
  } catch (error) {
    console.error(`读取「${skill.name}」的 Credits 兑换价失败：${error instanceof Error ? error.message : String(error)}`);
    console.error("价格未确认前不会安装付费 Skill。");
    process.exit(1);
  }
  if (!(await confirmPurchase(skill.name, price, yes))) {
    console.log("已取消兑换，未安装付费 Skill。");
    process.exit(0);
  }

  const token = await requireAccountToken();
  const response = await hfetch(`${WEB_URL}/api/skills/purchase`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ skill_name: skill.name }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 402) {
      console.error(`Credits 余额不足，需要 ${price.price_credits} Credits。`);
      console.error(`充值后重新运行：npx lovstudio skills add ${skill.name}`);
    } else if (response.status === 401) {
      console.error("Lovstudio 登录状态已失效，请重新运行命令完成登录。 ");
    } else {
      console.error(`兑换「${skill.name}」失败：${body.error || `HTTP ${response.status}`}`);
    }
    process.exit(1);
  }
  const balance = typeof body.remaining_balance === "number" ? `，余额 ${body.remaining_balance} Credits` : "";
  console.log(body.already_owned ? `✓ 已拥有「${skill.name}」，无需重复扣除 Credits${balance}。` : `✓ 已兑换「${skill.name}」${balance}。`);
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

  // 1. Keep the legacy license-key option for existing users. New paid Skills
  //    use the Lovstudio account + Credits path below.
  if (args.key) {
    const code = runHelper(["activate", args.key]);
    if (code !== 0) {
      console.error(`activation failed (exit ${code}). not installing skill.`);
      process.exit(code);
    }
  }

  // 2. Resolve the unified catalog before installing a single Skill. This is
  //    also the paid gate: purchase/login completes before npx downloads the
  //    encrypted bundle.
  const selector = skillSelector(args.name);
  const installAll = selector === "*";
  let selectors = [selector];
  if (!installAll) {
    const skill = await resolveCatalogSkill(args.name);
    if (skill.paid) await redeemPaidSkill(skill, args.yes);
  } else {
    // The aggregate command is intentionally free-only. Paid Skills must be
    // redeemed one at a time so the user sees the exact Credits cost and the
    // installer never pulls a paid bundle before entitlement is confirmed.
    selectors = await resolveFreeCatalogSelectors();
  }

  // 3. Install via vercel-labs/skills. Use the namespaced form — that's how
  //    SKILL.md frontmatter declares skills in the index. Historical issue
  //    messages told users to pass `lovstudio/skills`; keep that as an alias
  //    for "install the whole catalog" so older copy-paste instructions work.
  console.log(`Installing ${installAll ? "all free Lovstudio skills" : args.name} from ${GALLERY}...`);
  const skillArgs = [
    "-y", SKILLS_NPX_SPEC, "add", GALLERY,
    "--skill", ...selectors,
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

  // 4. Preflight deps from placeholder frontmatter. Only meaningful for
  //    single global installs — project installs land in ./skills/ with no
  //    easy way to locate from here, and full-catalog installs would need to
  //    aggregate many frontmatters.
  if (args.global && !installAll) {
    const fm = await readSkillFrontmatter(args.name);
    if (fm) {
      const missing = preflightReport(args.name, fm.dependencies);
      const code = resolveMissing(missing, args.withDeps);
      process.exit(code);
    }
  }

  console.log(`\n✓ ${installAll ? "all free Lovstudio skills" : args.name} installed.`);
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
  lovstudio skills add skills [options]        install all free Lovstudio skills
  lovstudio skills activate <key>              activate a license (alias of \`license <key>\`)
  lovstudio skills list                        list all Lovstudio skills
  lovstudio skills remove [<name>...]          uninstall
  lovstudio skills find [query]                search (delegates to npx skills)
  lovstudio skills update [<name>...]          update

Options for \`add\`:
  -k, --key <key>      legacy license key. Activates before install.
  -a, --agent <list>   target agent(s), comma-separated (see \`npx skills add --help\`)
  -g, --global         install globally into ~/.agents/skills/ and agent dirs (default)
      --project        install into ./skills/ for the current project
  -y, --yes            skip confirmation prompts
      --with-deps      auto-install missing runtime deps declared in SKILL.md

\`add\` installs from ${GALLERY} (no need to type the gallery path). Free Skills
install directly. A paid Skill must have an encrypted bundle, then the command
signs in and redeems its Credits before downloading. Passing \`skills\`, \`all\`,
\`*\`, or \`${GALLERY}\` installs all free entries; paid entries are added one at a time after redemption. Single-skill installs read
the Skill's \`dependencies:\` frontmatter and run each \`check\` command. With
--with-deps, missing ones are installed automatically.
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
