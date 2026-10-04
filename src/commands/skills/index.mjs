import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parse as parseYaml } from "yaml";
import { hasBin, runCapture, runInherit } from "../../lib/exec.mjs";
import { hfetch } from "../../lib/fetch.mjs";
import { runHelper } from "../../lib/helper.mjs";
import { AccountError, requireAccountSession } from "../../lib/account.mjs";

const GALLERY = "lovstudio/skills";
const GALLERY_INSTALL_SOURCE = `https://github.com/${GALLERY}.git`;
const SKILLS_NPX_SPEC = "skills@latest";
const SKILL_PREFIX = "lov-";
const LEGACY_SKILL_PREFIX = "lovstudio-";
const ALL_SKILLS_NAMES = new Set(["*", "all", "skills", GALLERY]);
const CATALOG_URL = process.env.LOVSTUDIO_SKILLS_CATALOG_URL ||
  `https://api.github.com/repos/${GALLERY}/contents/skills.yaml?ref=main`;
const WEB_URL = (process.env.LOVSTUDIO_WEB_URL || "https://lovstudio.ai").replace(/\/$/, "");

function isAllSkillsName(name) {
  return ALL_SKILLS_NAMES.has(String(name).trim().toLowerCase());
}

export function skillSelector(name) {
  const value = String(name).trim();
  if (isAllSkillsName(value)) return "*";
  if (value.startsWith(SKILL_PREFIX)) return value;
  if (value.startsWith(LEGACY_SKILL_PREFIX)) {
    return `${SKILL_PREFIX}${value.slice(LEGACY_SKILL_PREFIX.length)}`;
  }
  if (value.startsWith("lovstudio:")) return `${SKILL_PREFIX}${value.slice("lovstudio:".length)}`;
  return `${SKILL_PREFIX}${value}`;
}

// Where `npx skills add -g` writes the canonical bundle (vercel-labs/skills convention).
function globalSkillDir(runtimeName) {
  return join(homedir(), ".agents", "skills", runtimeName);
}

function ensureNpx() {
  if (hasBin("npx")) return;
  console.error(`error: \`npx\` not found. Install Node.js 18+ first (nodejs.org).`);
  process.exit(127);
}

async function requireAccountToken() {
  console.log("\n正在确认本机连接的 Lovstudio 网站账号…");
  try {
    const session = await requireAccountSession({ clientName: "Lovstudio CLI / Skill 安装" });
    console.log(`✓ 网站账号：${session.email || session.user_id || "已连接"}`);
    return session.access_token;
  } catch (error) {
    const detail = error instanceof AccountError ? error.message : String(error);
    console.error(`网站账号连接未完成：${detail}`);
    process.exit(1);
  }
}

async function loadCatalog() {
  const response = await hfetch(CATALOG_URL, {
    headers: { accept: "application/vnd.github+json, text/yaml, text/plain" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`catalog request failed: HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  let text;
  if (contentType.includes("application/json")) {
    const payload = await response.json();
    if (typeof payload?.content !== "string") {
      throw new Error("GitHub API catalog response has no encoded content");
    }
    text = Buffer.from(payload.content, "base64").toString("utf8");
  } else {
    text = await response.text();
  }
  const data = parseYaml(text) || {};
  return Array.isArray(data.skills) ? data.skills.filter((skill) => !skill.test) : [];
}

export function canonicalSkillName(name) {
  const value = String(name).trim();
  if (value.startsWith(SKILL_PREFIX)) return value.slice(SKILL_PREFIX.length);
  if (value.startsWith(LEGACY_SKILL_PREFIX)) return value.slice(LEGACY_SKILL_PREFIX.length);
  if (value.startsWith("lovstudio:")) return value.slice("lovstudio:".length);
  return value;
}

export function catalogSkillSelector(skill) {
  const runtimeName = String(skill?.runtime_name || "").trim();
  return runtimeName || skillSelector(skill?.name || "");
}

export function findCatalogSkill(catalog, name) {
  const requested = String(name).trim();
  const canonical = canonicalSkillName(requested);
  return catalog.find((entry) =>
    entry?.name === requested ||
    entry?.name === canonical ||
    catalogSkillSelector(entry) === requested
  );
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
  const skill = findCatalogSkill(catalog, name);
  if (!skill) {
    console.error(`目录中没有找到 Skill：${canonicalSkillName(name)}`);
    console.error(`查看可用 Skill：npx -y lovstudio@latest skills list`);
    process.exit(2);
  }
  return { catalog, skill };
}

export function catalogSkillDependencyClosure(catalog, rootSkill) {
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(skill, path) {
    const name = canonicalSkillName(skill?.name || "");
    if (!name) throw new Error("catalog dependency has no Skill name");
    if (visiting.has(name)) {
      throw new Error(`catalog dependency cycle: ${[...path, name].join(" -> ")}`);
    }
    if (visited.has(name)) return;

    visiting.add(name);
    for (const dependency of skill?.depends_on || []) {
      const resolved = findCatalogSkill(catalog, dependency);
      if (!resolved) {
        throw new Error(`${name} depends on missing catalog Skill: ${dependency}`);
      }
      visit(resolved, [...path, name]);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(skill);
  }

  visit(rootSkill, []);
  return ordered;
}

export function catalogSkillInstallPlans(skills) {
  const plans = [];
  for (const skill of skills) {
    const selector = catalogSkillSelector(skill);
    if (skill?.paid) {
      // Paid sources are private; each one is downloaded on its own once the
      // account's entitlement is confirmed.
      plans.push({ paid: true, source: null, selectors: [selector], skills: [skill] });
      continue;
    }
    const current = plans.at(-1);
    if (current && !current.paid) {
      current.selectors.push(selector);
      current.skills.push(skill);
    } else {
      plans.push({ paid: false, source: GALLERY_INSTALL_SOURCE, selectors: [selector], skills: [skill] });
    }
  }
  return plans;
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
    .map(catalogSkillSelector)
    .filter(Boolean);
  if (!selectors.length) {
    console.error("统一目录中没有可直接安装的免费 Skill。");
    process.exit(1);
  }
  return selectors;
}

async function fetchRedemptionPrice(name, token) {
  const url = `${WEB_URL}/api/skills/price?name=${encodeURIComponent(name)}`;
  const response = await hfetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
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

// Owning a paid Skill — a Credits purchase or a license bound to the account —
// is what the download endpoint checks, so this only has to make sure the
// account owns it before the archive is requested.
async function redeemPaidSkill(skill, yes, token) {
  let price;
  try {
    price = await fetchRedemptionPrice(skill.name, token);
  } catch (error) {
    console.error(`读取「${skill.name}」的 Credits 兑换价失败：${error instanceof Error ? error.message : String(error)}`);
    console.error("价格未确认前不会安装付费 Skill。");
    process.exit(1);
  }
  if (price.owned === true) {
    console.log(`✓ 网站账号已拥有「${skill.name}」，直接安装，不会再次确认或扣除 Credits。`);
    return;
  }
  if (!(await confirmPurchase(skill.name, price, yes))) {
    console.log("已取消兑换，未安装付费 Skill。");
    process.exit(0);
  }
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
      console.error(`充值后重新运行：npx -y lovstudio@latest skills add ${skill.name}`);
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

export async function locateExtractedSkill(root, skillPath = "") {
  const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) throw new Error(`unexpected archive layout (${entries.length} top-level directories)`);
  const dir = join(root, entries[0].name, skillPath || "");
  if (!existsSync(join(dir, "SKILL.md"))) {
    throw new Error(`SKILL.md not found at ${skillPath || "the repository root"}`);
  }
  return dir;
}

// Paid Skill sources live in private repositories. The website checks the
// account's entitlement and returns a short-lived archive URL; the installed
// copy is plain source.
async function downloadPaidSkill(skill, token) {
  const response = await hfetch(`${WEB_URL}/api/skills/download`, {
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
  if (!response.ok || typeof body.download_url !== "string") {
    console.error(`获取「${skill.name}」的下载地址失败：${body.error || `HTTP ${response.status}`}`);
    process.exit(1);
  }

  const archive = await hfetch(body.download_url, { signal: AbortSignal.timeout(180_000) });
  if (!archive.ok) {
    console.error(`下载「${skill.name}」失败：HTTP ${archive.status}`);
    process.exit(1);
  }
  const workDir = await mkdtemp(join(tmpdir(), "lovstudio-skill-"));
  const tarball = join(workDir, "source.tar.gz");
  const extracted = join(workDir, "source");
  await writeFile(tarball, Buffer.from(await archive.arrayBuffer()));
  await mkdir(extracted);
  const untar = runCapture("tar", ["-xzf", tarball, "-C", extracted]);
  if (untar.status !== 0) {
    await rm(workDir, { recursive: true, force: true });
    console.error(`解压「${skill.name}」失败：${untar.stderr || `tar exited ${untar.status}`}`);
    process.exit(1);
  }
  try {
    const skillDir = await locateExtractedSkill(extracted, body.skill_path);
    return { workDir, skillDir, version: body.version, ref: body.ref };
  } catch (error) {
    await rm(workDir, { recursive: true, force: true });
    console.error(`「${skill.name}」的源码包无法安装：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter / dependency preflight
// ─────────────────────────────────────────────────────────────────────────────

async function readSkillFrontmatter(runtimeName) {
  const path = join(globalSkillDir(runtimeName), "SKILL.md");
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
  //    also the paid gate: purchase/login completes before npx downloads from
  //    the delivery source declared by the catalog.
  const installAll = isAllSkillsName(args.name);
  let installPlans;
  let selectedSkills = [];
  let accountToken = null;
  if (!installAll) {
    const { catalog, skill } = await resolveCatalogSkill(args.name);
    try {
      selectedSkills = catalogSkillDependencyClosure(catalog, skill);
      installPlans = catalogSkillInstallPlans(selectedSkills);
    } catch (error) {
      console.error(`无法解析「${skill.name}」的 Skill 依赖：${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    for (const selected of selectedSkills) {
      if (!selected.paid) continue;
      accountToken ??= await requireAccountToken();
      await redeemPaidSkill(selected, args.yes, accountToken);
    }
  } else {
    // The aggregate command is intentionally free-only. Paid Skills must be
    // redeemed one at a time so the user sees the exact Credits cost.
    const selectors = await resolveFreeCatalogSelectors();
    installPlans = [{ source: GALLERY_INSTALL_SOURCE, selectors, skills: [] }];
  }

  // 3. Install via vercel-labs/skills. Use the namespaced form — that's how
  //    SKILL.md frontmatter declares skills in the index. Historical issue
  //    messages told users to pass `lovstudio/skills`; keep that as an alias
  //    for "install the whole catalog" so older copy-paste instructions work.
  const dependencyCount = installAll ? 0 : Math.max(0, selectedSkills.length - 1);
  const dependencyLabel = dependencyCount
    ? ` with ${dependencyCount} Skill dependenc${dependencyCount === 1 ? "y" : "ies"}`
    : "";
  console.log(`Installing ${installAll ? "all free Lovstudio skills" : args.name}${dependencyLabel}...`);
  for (const plan of installPlans) {
    let source = plan.source;
    let workDir = null;
    if (plan.paid) {
      const download = await downloadPaidSkill(plan.skills[0], accountToken);
      source = download.skillDir;
      workDir = download.workDir;
      const version = download.version ? ` v${download.version}` : "";
      console.log(`✓ 已下载「${plan.skills[0].name}」${version}（${download.ref}）`);
    }
    const skillArgs = [
      "-y", SKILLS_NPX_SPEC, "add", source,
      "--skill", ...plan.selectors,
    ];
    if (args.agent) skillArgs.push("-a", args.agent);
    if (args.global) skillArgs.push("--global");
    if (args.yes) skillArgs.push("--yes");
    skillArgs.push(...args.extra);

    const installCode = runInherit("npx", skillArgs);
    if (workDir) await rm(workDir, { recursive: true, force: true });
    if (installCode !== 0) {
      console.error(`\nnpx skills add exited ${installCode}`);
      process.exit(installCode);
    }
  }

  // 4. Preflight deps from placeholder frontmatter. Only meaningful for
  //    single global installs — project installs land in ./skills/ with no
  //    easy way to locate from here, and full-catalog installs would need to
  //    aggregate many frontmatters.
  if (args.global && !installAll) {
    for (const selected of selectedSkills) {
      const runtimeName = catalogSkillSelector(selected);
      const fm = await readSkillFrontmatter(runtimeName);
      if (!fm) continue;
      const missing = preflightReport(selected.name, fm.dependencies);
      const code = resolveMissing(missing, args.withDeps);
      if (code !== 0) process.exit(code);
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
  process.exit(runInherit("npx", ["-y", SKILLS_NPX_SPEC, "add", GALLERY_INSTALL_SOURCE, "--list"]));
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
      --with-deps      auto-install missing executable deps declared in SKILL.md

\`add\` installs from ${GALLERY} (no need to type the gallery path). Free Skills
install directly. A paid Skill signs in, redeems its Credits unless the account
already owns it (purchase or bound license), then downloads its source from
lovstudio.ai and installs it as plain files. Passing \`skills\`, \`all\`,
\`*\`, or \`${GALLERY}\` installs all free entries; paid entries are added one at a time after redemption. Single-skill installs
automatically include the catalog's transitive \`depends_on\` Skill closure, then
read each installed Skill's executable \`dependencies:\` frontmatter and run its
\`check\` commands. With --with-deps, missing executable dependencies are installed automatically.
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
