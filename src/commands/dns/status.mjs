import { getNameServers } from "./godaddy.mjs";
import { dig } from "../../lib/dig.mjs";
import { DOMAIN, providerOf } from "./constants.mjs";

// Approximate terminal display width. CJK + fullwidth punctuation counts as 2.
function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    // CJK Unified Ideographs, Hangul, Hiragana/Katakana, fullwidth forms, CJK symbols
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0x303e) ||
      (cp >= 0x3041 && cp <= 0x33ff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xa000 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function pad(s, w) {
  s = String(s);
  return s + " ".repeat(Math.max(0, w - displayWidth(s)));
}

export async function statusAction() {
  const registrarNs = await getNameServers();
  const registrarProv = providerOf(registrarNs.join(","));

  const publicNs = (await dig(["NS", DOMAIN, "@8.8.8.8", "+short"]))
    .map((s) => s.replace(/\.$/, ""))
    .sort();
  const publicProv = publicNs.length ? providerOf(publicNs.join(",")) : "(no response)";

  const aRec = (await dig(["A", DOMAIN, "@8.8.8.8", "+short"]))[0] || "(none)";
  const mxRows = await dig(["MX", DOMAIN, "@8.8.8.8", "+short"]);
  const mxSorted = mxRows
    .map((line) => line.split(/\s+/))
    .filter((p) => p.length >= 2)
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  const primaryMx = mxSorted[0] ? mxSorted[0][1].replace(/\.$/, "") : "(none)";

  const consistent = registrarProv === publicProv;
  const propagation = consistent
    ? "一致 ✓"
    : "过渡中(TLD 缓存未刷,通常 15-60 分钟)";

  // The *declared* mode comes from the registrar (authoritative source).
  // What public resolvers see may lag during the 15-60 min TLD propagation window.
  let mode;
  if (registrarProv === "Cloudflare") mode = "国际常态 · 所有地区走 Cloudflare";
  else if (registrarProv === "Aliyun")
    mode = "大陆分流 · 大陆走 HK 154.219.107.66,海外走 Vercel";
  else mode = "未知";

  const rows = [
    ["域名", DOMAIN],
    ["注册商 (GoDaddy)", `${registrarProv}  (${registrarNs.join(", ")})`],
    ["全球公共 DNS 看到", `${publicProv}  (${publicNs.join(", ") || "-"})`],
    ["传播状态", propagation],
    ["当前根域解析 A", aRec],
    ["当前邮件入口 MX", primaryMx],
    ["当前模式", mode],
  ];
  const labelW = Math.max(...rows.map(([k]) => displayWidth(k)));
  for (const [k, v] of rows) {
    console.log(`${pad(k, labelW)}  ${v}`);
  }
}
