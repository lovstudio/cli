import { spawnSync } from "node:child_process";
import { open } from "node:fs/promises";

const TMUX_TIMEOUT_MS = 1_000;
const MAX_TITLE_LENGTH = 96;
const LOG_TAIL_BYTES = 64 * 1024;
const WEB_ADDRESS_POLL_MS = 250;
const VISIBLE_PANE_BORDER_FORMAT =
  '#[align=left]#{?pane_active,#[reverse],#[fg=colour117]}## #{?#{e|<:#{pane_index},10},0,}#{pane_index}: #{pane_title}#[default]';

function runTmux(args, { capture = false } = {}) {
  try {
    const result = spawnSync("tmux", args, {
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "ignore"] : "ignore",
      timeout: TMUX_TIMEOUT_MS,
    });
    if (result.error || result.status !== 0) return null;
    return capture ? (result.stdout || "").replace(/\r?\n$/, "") : "";
  } catch {
    return null;
  }
}

function cleanTitlePart(value, maxLength = MAX_TITLE_LENGTH) {
  const cleaned = String(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return maxLength === null
    ? cleaned
    : Array.from(cleaned).slice(0, maxLength).join("");
}

export function formatTmuxPaneTitle(appName, command, logPath, webAddress) {
  const name = cleanTitlePart(appName);
  const invocation = cleanTitlePart(command.join(" "));
  const address = cleanTitlePart(webAddress || "", null);
  // Keep the log address complete so it can be copied from `#{pane_title}` even
  // when the visible border has to clip a long custom LOVSTUDIO_HOME path.
  const log = cleanTitlePart(logPath || "", null);
  return [name, invocation, address, log].filter(Boolean).join(" · ");
}

function isPrivateHostname(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (["localhost", "::1", "0.0.0.0"].includes(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (/^(?:10|127|192\.168|169\.254)\./.test(host)) return true;
  const match = host.match(/^172\.(\d{1,3})\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return /^(?:fc|fd|fe80):/i.test(host);
}

function webAddressCandidate(line) {
  const plain = line.replace(
    /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g,
    "",
  );
  const matches = plain.matchAll(
    /https?:\/\/(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?(?:\/[^\s"'<>]*)?/gi,
  );
  let best = null;
  for (const match of matches) {
    const raw = match[0].replace(/[),.;!?]+$/, "");
    let address;
    try {
      const parsed = new URL(raw);
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      address = parsed.toString();
    } catch {
      continue;
    }

    const parsed = new URL(address);
    const localLabel = /(?:^|\s)local\s*:/i.test(plain);
    const networkLabel = /(?:^|\s)network\s*:/i.test(plain);
    const serviceLabel = /\b(?:listening|running at|ready (?:at|on)|available at)\b/i.test(plain);
    const privateHost = isPrivateHostname(parsed.hostname);
    if (!privateHost && !localLabel && !networkLabel && !serviceLabel && !parsed.port) continue;

    const score = localLabel
      ? 100
      : ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase())
        ? 90
        : networkLabel
          ? 80
          : privateHost
            ? 70
            : serviceLabel
              ? 60
              : 50;
    if (!best || score > best.score) best = { address, score };
  }
  return best;
}

function findWebAddressCandidate(text) {
  let best = null;
  for (const line of String(text).split(/\r?\n/)) {
    const candidate = webAddressCandidate(line);
    if (!candidate || (best && candidate.score <= best.score)) continue;
    best = candidate;
  }
  return best;
}

export function extractWebAccessAddress(text) {
  return findWebAddressCandidate(text)?.address || null;
}

async function readLogTail(path) {
  let file;
  try {
    file = await open(path, "r");
    const { size } = await file.stat();
    const length = Math.min(size, LOG_TAIL_BYTES);
    if (length === 0) return "";
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await file.read(buffer, 0, length, size - length);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return "";
  } finally {
    await file?.close().catch(() => {});
  }
}

export function startTmuxPaneWebAddressWatcher(
  appName,
  command,
  logPath,
  displayLogPath,
  { env = process.env, intervalMs = WEB_ADDRESS_POLL_MS } = {},
) {
  if (!env.TMUX || !env.TMUX_PANE || !logPath) return async () => {};

  let bestScore = -1;
  let pending = Promise.resolve();
  const refresh = async () => {
    const candidate = findWebAddressCandidate(await readLogTail(logPath));
    if (!candidate || candidate.score <= bestScore) return;
    bestScore = candidate.score;
    setTmuxPaneTitle(
      formatTmuxPaneTitle(appName, command, displayLogPath, candidate.address),
      env,
    );
  };
  const poll = () => {
    pending = pending.then(refresh).catch(() => {});
  };

  poll();
  const timer = setInterval(poll, intervalMs);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pending;
    await refresh();
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

// Copy pane output to a file without putting a pipe between the app and its TTY.
// Return null when tmux is unavailable or the pane already has a user-managed pipe.
export function startTmuxPaneLog(path, env = process.env) {
  const pane = env.TMUX_PANE;
  if (!env.TMUX || !pane || !path) return null;

  const existingPipe = runTmux([
    "display-message",
    "-p",
    "-t",
    pane,
    "#{pane_pipe}",
  ], { capture: true });
  if (existingPipe === null || existingPipe === "1") return null;

  const command = `cat >> ${shellQuote(path)}`;
  if (runTmux(["pipe-pane", "-O", "-t", pane, command]) === null) return null;

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    runTmux(["pipe-pane", "-t", pane]);
  };
}

// Set a visible title for the current tmux pane. The title intentionally remains
// after the app exits so the command and completed run log stay discoverable.
// tmux failures are deliberately ignored so pane decoration can never block an app command.
export function setTmuxPaneTitle(title, env = process.env) {
  const pane = env.TMUX_PANE;
  if (!env.TMUX || !pane || !title) return;

  if (runTmux(["select-pane", "-t", pane, "-T", title]) === null) return;
  // Shell prompts commonly emit OSC title sequences after the child exits.
  // Disable those updates for this pane so the completed run title and log
  // address remain available until LovStudio explicitly titles it again.
  runTmux(["set-option", "-p", "-t", pane, "allow-set-title", "off"]);

  // Pane titles are only visible when pane borders are enabled. Preserve an existing
  // top/bottom preference; otherwise enable the default top title for this window.
  const borderStatus = runTmux([
    "show-options",
    "-wAv",
    "-t",
    pane,
    "pane-border-status",
  ], { capture: true });
  if (borderStatus === "off") {
    runTmux(["set-option", "-w", "-t", pane, "pane-border-status", "top"]);
  }
  // Some themes intentionally make inactive pane borders very dark. Give the title
  // its own foreground so every pane remains identifiable without focusing it.
  runTmux([
    "set-option",
    "-w",
    "-t",
    pane,
    "pane-border-format",
    VISIBLE_PANE_BORDER_FORMAT,
  ]);
}
