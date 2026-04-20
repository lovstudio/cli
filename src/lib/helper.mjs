// Central definition of the uvx → lovstudio-skill-helper invocation.
// Every subcommand that touches the helper goes through here so the pinned
// version stays consistent. The bare `uvx lovstudio-skill-helper` form reuses
// any older cached install, which silently misses newer subcommands — hence
// the `--from <pinned>` form.

import { hasBin, runInherit } from "./exec.mjs";

export const HELPER_MIN_VERSION = "0.6.7";
export const HELPER_SPEC = `lovstudio-skill-helper>=${HELPER_MIN_VERSION}`;
export const UVX_PREFIX = ["--from", HELPER_SPEC, "lovstudio-skill-helper"];

export function ensureUvx() {
  if (hasBin("uvx")) return;
  console.error(`error: \`uvx\` not found in PATH.

This command shells out to \`uvx lovstudio-skill-helper\` (Python).
Install uv first (one command, no Python env fuss):

  curl -LsSf https://astral.sh/uv/install.sh | sh

Then re-run this command.`);
  process.exit(127);
}

export function runHelper(args) {
  ensureUvx();
  return runInherit("uvx", [...UVX_PREFIX, ...args]);
}
