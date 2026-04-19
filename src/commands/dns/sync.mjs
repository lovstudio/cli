import { listCfRecords } from "./cloudflare.mjs";
import { addAliRecord, listAliRecords } from "./aliyun.mjs";

function normalizeValue(type, v) {
  v = v.trim();
  if ((type === "CNAME" || type === "MX") && v.endsWith(".")) v = v.slice(0, -1);
  return v;
}

export async function syncAction(args) {
  const apply = args.includes("--apply");

  const [cf, ali] = await Promise.all([listCfRecords(), listAliRecords()]);

  const aliKeys = new Set(
    ali.map((r) => `${r.rr}\0${r.type}\0${normalizeValue(r.type, r.value)}`),
  );

  const toAdd = [];
  for (const rec of cf) {
    const key = `${rec.rr}\0${rec.type}\0${normalizeValue(rec.type, rec.value)}`;
    if (aliKeys.has(key)) continue;
    toAdd.push(rec);
  }

  console.log(
    `CF records: ${cf.length}   Aliyun records: ${ali.length}   missing in Aliyun: ${toAdd.length}`,
  );
  for (const r of toAdd) {
    const prio = r.priority ? ` prio=${r.priority}` : "";
    const v = r.value.length > 80 ? r.value.slice(0, 80) + "..." : r.value;
    console.log(`  + ${r.type.padEnd(5)} ${r.rr.padEnd(30)} -> ${v}${prio}`);
  }

  if (toAdd.length === 0) {
    console.log("in sync.");
    return;
  }

  if (!apply) {
    console.log("");
    console.log("dry-run. pass --apply to write these into Aliyun.");
    return;
  }

  console.log("");
  console.log("applying...");
  let ok = 0;
  let dup = 0;
  let fail = 0;
  for (const r of toAdd) {
    try {
      const res = await addAliRecord(r);
      if (res?.Duplicate) {
        dup++;
        console.log(`  DUP  ${r.type} ${r.rr}`);
      } else {
        ok++;
        console.log(`  OK   ${r.type} ${r.rr}`);
      }
    } catch (err) {
      fail++;
      console.log(`  FAIL ${r.type} ${r.rr}: ${err.message}`);
    }
  }
  console.log("");
  console.log(`done. added=${ok} duplicate=${dup} failed=${fail}`);
  if (fail > 0) process.exit(1);
}
