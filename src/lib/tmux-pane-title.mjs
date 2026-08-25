import { spawnSync } from "node:child_process";

const TMUX_TIMEOUT_MS = 1_000;
const MAX_TITLE_LENGTH = 96;
const VISIBLE_PANE_BORDER_FORMAT =
  '#{?pane_active,#[reverse],#[fg=colour117]} ###{pane_index}: #{pane_title} #[default]';

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

function cleanTitlePart(value) {
  const cleaned = String(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(cleaned).slice(0, MAX_TITLE_LENGTH).join("");
}

export function formatTmuxPaneTitle(appName, command) {
  const name = cleanTitlePart(appName);
  const invocation = cleanTitlePart(command.join(" "));
  return [name, invocation].filter(Boolean).join(" · ");
}

// Set a visible title for the current tmux pane and return a restore callback.
// tmux failures are deliberately ignored so pane decoration can never block an app command.
export function setTmuxPaneTitle(title, env = process.env) {
  const pane = env.TMUX_PANE;
  if (!env.TMUX || !pane || !title) return () => {};

  const originalTitle = runTmux([
    "display-message",
    "-p",
    "-t",
    pane,
    "#{pane_title}",
  ], { capture: true });
  if (originalTitle === null) return () => {};

  if (runTmux(["select-pane", "-t", pane, "-T", title]) === null) return () => {};

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

  return () => {
    runTmux(["select-pane", "-t", pane, "-T", originalTitle]);
  };
}
