import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { getNameServers, setNameServers } from "./godaddy.mjs";
import { ALI_NS, CF_NS, DOMAIN } from "./constants.mjs";

function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N] `, (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

async function waitFor(targetSorted, { timeoutMs = 5 * 60_000, intervalMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cur = await getNameServers();
    const ts = new Date().toISOString().slice(11, 19) + "Z";
    const match = cur.length === targetSorted.length && cur.every((v, i) => v === targetSorted[i]);
    process.stdout.write(`[${ts}] registrar NS = ${cur.join(", ")}${match ? "  ✓\n" : "\n"}`);
    if (match) return true;
    await sleep(intervalMs);
  }
  return false;
}

export async function switchAction(target, args) {
  const yes = args.includes("--yes") || args.includes("-y");
  const nsMap = { cf: CF_NS, aliyun: ALI_NS };
  const targetNs = nsMap[target];
  if (!targetNs) throw new Error(`invalid target: ${target}`);

  const current = await getNameServers();
  const sortedTarget = [...targetNs].sort();
  if (current.length === sortedTarget.length && current.every((v, i) => v === sortedTarget[i])) {
    console.log(`already on ${target} (${current.join(", ")})`);
    return;
  }

  console.log(`domain     : ${DOMAIN}`);
  console.log(`current NS : ${current.join(", ")}`);
  console.log(`target NS  : ${targetNs.join(", ")}`);
  if (target === "aliyun") {
    console.log("");
    console.log("⚠  Aliyun zone must contain ALL records (MX/SPF/DKIM/DMARC/sub-CNAMEs).");
    console.log("   run 'lovstudio dns sync --apply' first if unsure.");
  }
  console.log("");

  if (!yes) {
    const ok = await askYesNo(`Proceed with NS change?`);
    if (!ok) {
      console.log("cancelled.");
      return;
    }
  }

  await setNameServers(targetNs);
  console.log("registrar update submitted, waiting for GoDaddy to confirm...");
  const ok = await waitFor(sortedTarget);
  if (!ok) {
    console.log("timeout waiting for registrar-side confirmation (5 min).");
    console.log("check later with: lovstudio dns status");
    process.exit(1);
  }
  console.log("");
  console.log("registrar updated.");
  console.log(".ai TLD propagation to public resolvers takes ~15-60 min.");
  console.log("track progress: lovstudio dns status");
}
