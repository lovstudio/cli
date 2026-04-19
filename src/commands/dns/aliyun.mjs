import { createHmac, randomUUID } from "node:crypto";
import { requireEnv } from "../../lib/env.mjs";
import { hfetch } from "../../lib/fetch.mjs";
import { DOMAIN } from "./constants.mjs";

// Aliyun DNS API signature v1.0 (RPC style)
// https://help.aliyun.com/document_detail/29745.html

const ENDPOINT = "https://alidns.aliyuncs.com/";

function percentEncode(s) {
  return encodeURIComponent(s)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}

function sign(method, params, secret) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");
  const stringToSign = `${method}&${percentEncode("/")}&${percentEncode(sorted)}`;
  return createHmac("sha1", `${secret}&`).update(stringToSign).digest("base64");
}

async function call(action, extra = {}) {
  const ak = requireEnv("ALI_AK");
  const sk = requireEnv("ALI_SK");
  const params = {
    Action: action,
    Format: "JSON",
    Version: "2015-01-09",
    AccessKeyId: ak,
    SignatureMethod: "HMAC-SHA1",
    Timestamp: new Date().toISOString().replace(/\.\d{3}/, ""),
    SignatureVersion: "1.0",
    SignatureNonce: randomUUID(),
    ...extra,
  };
  params.Signature = sign("POST", params, sk);
  const body = new URLSearchParams(params).toString();
  const res = await hfetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok || json.Code) {
    const code = json.Code || `HTTP${res.status}`;
    const msg = json.Message || JSON.stringify(json);
    const err = new Error(`Aliyun ${action}: ${code} ${msg}`);
    err.code = code;
    throw err;
  }
  return json;
}

export async function listAliRecords() {
  const res = await call("DescribeDomainRecords", {
    DomainName: DOMAIN,
    PageSize: "100",
  });
  return (res.DomainRecords?.Record || []).map((r) => ({
    rr: r.RR,
    type: r.Type,
    value: r.Value,
    priority: r.Priority ?? null,
    line: r.Line,
    recordId: r.RecordId,
  }));
}

export async function addAliRecord({ rr, type, value, priority }) {
  const extra = {
    DomainName: DOMAIN,
    RR: rr,
    Type: type,
    Value: value,
  };
  if (priority) extra.Priority = String(priority);
  try {
    return await call("AddDomainRecord", extra);
  } catch (err) {
    if (err.code === "DomainRecordDuplicate") return { Duplicate: true };
    throw err;
  }
}
