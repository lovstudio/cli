import { requireEnv } from "../../lib/env.mjs";
import { hfetch } from "../../lib/fetch.mjs";
import { DOMAIN } from "./constants.mjs";

function auth() {
  const key = requireEnv("GODADDY_API_KEY");
  const secret = process.env.GODADDY_SECRET || process.env.GODADDY_API_SECRET;
  if (!secret) {
    console.error("missing env: GODADDY_SECRET (or GODADDY_API_SECRET)");
    process.exit(1);
  }
  return `sso-key ${key}:${secret}`;
}

export async function getNameServers() {
  const res = await hfetch(`https://api.godaddy.com/v1/domains/${DOMAIN}`, {
    headers: { Authorization: auth() },
  });
  if (!res.ok) {
    throw new Error(`GoDaddy GET failed: HTTP ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return [...(body.nameServers || [])].sort();
}

export async function setNameServers(nsList) {
  const res = await hfetch(`https://api.godaddy.com/v1/domains/${DOMAIN}`, {
    method: "PATCH",
    headers: {
      Authorization: auth(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ nameServers: nsList }),
  });
  if (res.status !== 204) {
    throw new Error(`GoDaddy PATCH failed: HTTP ${res.status} ${await res.text()}`);
  }
}
