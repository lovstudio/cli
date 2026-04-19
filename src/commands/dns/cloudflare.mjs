import { requireEnv } from "../../lib/env.mjs";
import { hfetch } from "../../lib/fetch.mjs";
import { CF_ZONE_ID, DOMAIN } from "./constants.mjs";

function auth() {
  return `Bearer ${requireEnv("CLOUDFLARE_API_KEY")}`;
}

export async function listCfRecords() {
  const res = await hfetch(
    `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?per_page=200`,
    { headers: { Authorization: auth() } },
  );
  const body = await res.json();
  if (!body.success) {
    throw new Error(`CF list failed: ${JSON.stringify(body.errors)}`);
  }
  const records = [];
  for (const r of body.result || []) {
    if (r.type === "NS" || r.type === "SOA") continue;
    const name = r.name;
    let rr = name === DOMAIN ? "@" : name.slice(0, -(DOMAIN.length + 1));
    if (rr === "_domainconnect") continue;

    let content = r.content;
    if (r.type === "TXT" && content.startsWith('"') && content.endsWith('"')) {
      content = content.slice(1, -1).replace(/" "/g, "");
    }

    records.push({
      rr,
      type: r.type,
      value: content,
      priority: r.priority ?? null,
    });
  }
  return records;
}
