export const DOMAIN = "lovstudio.ai";
export const CF_ZONE_ID = "8ac61d219ae3b0857e8a5cad957f8447";
export const CF_NS = ["christian.ns.cloudflare.com", "nova.ns.cloudflare.com"];
export const ALI_NS = ["ns1.alidns.com", "ns2.alidns.com"];

export function providerOf(nsValue) {
  if (/cloudflare/i.test(nsValue)) return "Cloudflare";
  if (/alidns/i.test(nsValue)) return "Aliyun";
  return `Other(${nsValue})`;
}
