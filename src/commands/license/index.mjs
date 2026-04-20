import { runHelper } from "../../lib/helper.mjs";

const DIRECT_SUBS = new Set([
  "activate",
  "status",
  "login",
  "logout",
  "whoami",
  "deactivate",
  "heartbeat",
]);

const ADMIN_ISSUE_FLAGS_VALUED = new Set([
  "--skills", "--skill", "--user", "--max-devices",
  "--expires-days", "--notes", "--nickname",
  "--source", "--scope", "--scope-value",
]);

const ADMIN_ISSUE_FLAGS_BOOL = new Set(["--force-new", "--json"]);

// license issue — forwards to the helper's hidden `admin-issue-license`
// subcommand. Only admins with the right DB creds succeed.
function runLicenseIssue(argv) {
  const passthrough = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (ADMIN_ISSUE_FLAGS_VALUED.has(a)) {
      const v = argv[++i];
      if (v === undefined) {
        console.error(`error: ${a} requires a value`);
        process.exit(2);
      }
      // Normalize: --skill is a common typo alias of --skills.
      passthrough.push(a === "--skill" ? "--skills" : a, v);
    } else if (ADMIN_ISSUE_FLAGS_BOOL.has(a)) {
      passthrough.push(a);
    } else {
      console.error(`error: unknown flag for 'license issue': ${a}`);
      process.exit(2);
    }
  }
  process.exit(runHelper(["admin-issue-license", ...passthrough]));
}

function printHelp() {
  console.log(`lovstudio license — manage your Lovstudio license

Usage:
  lovstudio license <key>              activate a license key (alias of \`activate\`)
  lovstudio license activate <key>
  lovstudio license status             show local license state
  lovstudio license login              sign in via browser (device flow)
  lovstudio license logout             forget the local session
  lovstudio license whoami             show signed-in email
  lovstudio license deactivate [<key>] [--all]
  lovstudio license issue [options]    (admin) mint a new license key

Admin \`license issue\` options:
  --skills <csv>                       skills to grant (comma-separated, alias: --skill)
  --scope global                       shortcut: grant every skill in the catalog
  --scope category --scope-value <cat> grant all skills in a category
  --user <uuid>                        bind to an auth user (omit = anonymous key)
  --nickname <name>                    recipient label
  --max-devices <n>                    default: 1
  --expires-days <n>                   default: 365 (0 = no expiry)
  --notes <text>                       admin note stored on the license row
  --force-new                          mint new key even if user already has one
  --json                               raw JSON output

All commands shell out to \`uvx lovstudio-skill-helper\` (pinned version).
`);
}

export const licenseCommand = {
  summary: "activate / manage your Lovstudio license",
  async run(args) {
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
      printHelp();
      return;
    }
    const [first, ...rest] = args;

    // Shortcut: `lovstudio license <key>` → activate <key>.
    // Helper's canonical key format is `lk-<64 hex chars>` but we accept any
    // `lk-...` as a shortcut so stale short keys still get routed right and
    // the helper itself returns the precise error.
    if (/^lk-[0-9a-f]+$/i.test(first)) {
      process.exit(runHelper(["activate", first, ...rest]));
    }

    if (first === "issue") {
      return runLicenseIssue(rest);
    }

    if (DIRECT_SUBS.has(first)) {
      process.exit(runHelper([first, ...rest]));
    }

    console.error(`unknown subcommand: ${first}`);
    console.error(`run 'lovstudio license --help' for usage`);
    process.exit(2);
  },
};
