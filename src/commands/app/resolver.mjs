import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";

const DEFAULT_ROOT_PARTS = [
  ["lovstudio", "coding"],
  ["projects"],
];

const KNOWN_PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun", "cnpm"]);

const LOCKFILE_MANAGERS = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

export class AmbiguousAppError extends Error {
  constructor(name, root, matches) {
    const paths = matches.map((app) => app.path).join(", ");
    super(`app '${name}' is ambiguous in ${root}: ${paths}`);
    this.name = "AmbiguousAppError";
    this.appName = String(name);
    this.root = root;
    this.matches = matches;
  }
}

function expandHome(value) {
  const input = String(value).trim();
  if (input === "~") return homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(homedir(), input.slice(2));
  }
  return resolve(input);
}

export function normalizeAppName(value) {
  const unscoped = String(value).trim().toLowerCase().replace(/^@[^/]+\//, "");
  return unscoped
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function appSearchRoots() {
  const configured = process.env.LOVSTUDIO_APP_PATH;
  const roots = configured !== undefined
    ? configured.split(delimiter).filter(Boolean).map(expandHome)
    : DEFAULT_ROOT_PARTS.map((parts) => join(homedir(), ...parts));
  return [...new Set(roots)];
}

export function appRegistryPath() {
  const root = process.env.LOVSTUDIO_HOME
    ? expandHome(process.env.LOVSTUDIO_HOME)
    : join(homedir(), ".lovstudio");
  return join(root, "apps.json");
}

export async function readAppMappings() {
  try {
    const data = JSON.parse(await readFile(appRegistryPath(), "utf8"));
    const mappings = data?.apps && typeof data.apps === "object" ? data.apps : data;
    return Object.fromEntries(
      Object.entries(mappings || {})
        .filter(([, value]) => typeof value === "string")
        .map(([name, value]) => [normalizeAppName(name), expandHome(value)]),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`cannot read app mappings: ${error.message}`);
  }
}

async function writeAppMappings(mappings) {
  const file = appRegistryPath();
  const sorted = Object.fromEntries(Object.entries(mappings).sort(([a], [b]) => a.localeCompare(b)));
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(sorted, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

// Parse the `packageManager` field ("bun@1.3.11", "pnpm@9.0.0+sha224...") down to
// the manager name. Returns null for unknown managers so we can fall back.
export function parsePackageManager(spec) {
  if (typeof spec !== "string") return null;
  const at = spec.indexOf("@");
  const name = at > 0 ? spec.slice(0, at) : spec;
  return KNOWN_PACKAGE_MANAGERS.has(name) ? name : null;
}

async function detectPackageManager(directory, pkg) {
  const declared = parsePackageManager(pkg?.packageManager);
  if (declared) return declared;
  for (const [lockfile, manager] of LOCKFILE_MANAGERS) {
    try {
      await stat(join(directory, lockfile));
      return manager;
    } catch {
      // keep looking
    }
  }
  return null;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function inspectApp(path) {
  let directory;
  try {
    directory = await realpath(expandHome(path));
    if (!(await stat(directory)).isDirectory()) return null;
  } catch {
    return null;
  }

  const pkg = await readJson(join(directory, "package.json"));
  if (!pkg || typeof pkg !== "object") return null;

  const tauri = await readJson(join(directory, "src-tauri", "tauri.conf.json"));
  const names = [tauri?.productName, pkg.name, basename(directory)]
    .filter((name) => typeof name === "string" && name.trim())
    .map(normalizeAppName)
    .filter(Boolean);
  const aliases = [...new Set(names)];

  return {
    name: aliases[0] || normalizeAppName(basename(directory)),
    path: directory,
    aliases,
    packageManager: await detectPackageManager(directory, pkg),
  };
}

async function rootCandidates(root) {
  const candidates = [];
  const rootApp = await inspectApp(root);
  if (rootApp) candidates.push(rootApp);

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return candidates;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const app = await inspectApp(join(root, entry.name));
    if (app) candidates.push(app);
  }
  return candidates;
}

export async function discoverApps() {
  const apps = [];
  const seenPaths = new Set();
  const seenNames = new Set();

  for (const root of appSearchRoots()) {
    for (const app of await rootCandidates(root)) {
      if (seenPaths.has(app.path) || seenNames.has(app.name)) continue;
      seenPaths.add(app.path);
      seenNames.add(app.name);
      apps.push({ ...app, source: "auto" });
    }
  }
  return apps;
}

export async function resolveApp(name) {
  const key = normalizeAppName(name);
  if (!key) return null;

  const mappings = await readAppMappings();
  if (mappings[key]) {
    const app = await inspectApp(mappings[key]);
    return app ? { ...app, name: key, source: "mapped" } : {
      name: key,
      path: mappings[key],
      aliases: [key],
      source: "missing",
    };
  }

  for (const root of appSearchRoots()) {
    const matches = (await rootCandidates(root)).filter((app) => app.aliases.includes(key));
    if (matches.length === 1) return { ...matches[0], name: key, source: "auto" };
    if (matches.length > 1) {
      throw new AmbiguousAppError(name, root, matches);
    }
  }
  return null;
}

export async function listApps() {
  const mappings = await readAppMappings();
  const result = [];
  const seenPaths = new Set();
  const seenNames = new Set();

  for (const [name, path] of Object.entries(mappings).sort(([a], [b]) => a.localeCompare(b))) {
    const app = await inspectApp(path);
    result.push({ name, path: app?.path || path, source: app ? "mapped" : "missing" });
    seenNames.add(name);
    if (app) seenPaths.add(app.path);
  }

  for (const app of await discoverApps()) {
    if (seenPaths.has(app.path) || seenNames.has(app.name)) continue;
    result.push({ name: app.name, path: app.path, source: app.source });
    seenPaths.add(app.path);
    seenNames.add(app.name);
  }
  return result;
}

export async function addAppMapping(name, path) {
  const key = normalizeAppName(name);
  if (!key) throw new Error("app name cannot be empty");
  const app = await inspectApp(path);
  if (!app) throw new Error(`not an app directory (package.json required): ${expandHome(path)}`);
  const mappings = await readAppMappings();
  const replaced = Object.hasOwn(mappings, key);
  mappings[key] = app.path;
  await writeAppMappings(mappings);
  return { ...app, name: key, source: "mapped", replaced };
}

export async function removeAppMapping(name) {
  const key = normalizeAppName(name);
  const mappings = await readAppMappings();
  if (!mappings[key]) return false;
  delete mappings[key];
  await writeAppMappings(mappings);
  return true;
}
