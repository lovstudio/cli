import { statusAction } from "./status.mjs";
import { switchAction } from "./switch.mjs";
import { syncAction } from "./sync.mjs";

const SUB = {
  status: { run: statusAction, summary: "show DNS provider status" },
  cf: {
    run: (args) => switchAction("cf", args),
    summary: "switch registrar NS to Cloudflare (intl default)",
  },
  aliyun: {
    run: (args) => switchAction("aliyun", args),
    summary: "switch registrar NS to Aliyun (CN split-horizon)",
  },
  ali: {
    run: (args) => switchAction("aliyun", args),
    summary: "alias of aliyun",
    hidden: true,
  },
  sync: {
    run: syncAction,
    summary: "sync CF DNS records into Aliyun standby zone",
  },
};

function printHelp() {
  const lines = Object.entries(SUB)
    .filter(([, v]) => !v.hidden)
    .map(([k, v]) => `  ${k.padEnd(10)} ${v.summary}`)
    .join("\n");
  console.log(`lovstudio dns — manage lovstudio.ai DNS

Usage:
  lovstudio dns <subcommand> [options]

Subcommands:
${lines}

Options:
  --yes           skip confirmation prompt on destructive actions
  --apply         for 'sync', actually write changes (otherwise dry-run)
`);
}

export const dnsCommand = {
  summary: "manage lovstudio.ai DNS (provider switch + sync)",
  async run(args) {
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
      printHelp();
      return;
    }
    const [sub, ...rest] = args;
    const handler = SUB[sub];
    if (!handler) {
      console.error(`unknown dns subcommand: ${sub}`);
      printHelp();
      process.exit(2);
    }
    await handler.run(rest);
  },
};
