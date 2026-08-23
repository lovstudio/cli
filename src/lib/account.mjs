import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { hfetch } from "./fetch.mjs";

const REFRESH_SKEW_SECONDS = 60;

export class AccountError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = "AccountError";
    this.code = code;
    this.status = status;
  }
}

export function accountHome() {
  return process.env.LOVSTUDIO_HOME || join(homedir(), ".lovstudio");
}

export function accountFilePath() {
  return join(accountHome(), "auth.yml");
}

function webUrl() {
  return (process.env.LOVSTUDIO_WEB_URL || "https://lovstudio.ai").replace(/\/$/, "");
}

export async function readAccountSession() {
  try {
    return parseYaml(await readFile(accountFilePath(), "utf8")) || null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new AccountError(`无法读取本机 Lovstudio 账号会话：${error?.message || error}`);
  }
}

function normalizedSession(payload) {
  const accessToken = payload?.accessToken || payload?.access_token;
  const refreshToken = payload?.refreshToken || payload?.refresh_token;
  const expiresIn = Number(payload?.expiresIn || payload?.expires_in || 3600);
  const expiresAt = Number(
    payload?.expiresAt || payload?.expires_at || Math.floor(Date.now() / 1000) + expiresIn,
  );
  const user = payload?.user || {};
  if (!accessToken || !refreshToken) {
    throw new AccountError("Lovstudio 网站没有返回完整账号会话。", { code: "invalid_session" });
  }
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    user_id: user.id || payload?.user_id || "",
    email: user.email || payload?.email || "",
  };
}

export async function saveAccountSession(payload) {
  const session = normalizedSession(payload);
  const path = accountFilePath();
  const tmpPath = `${path}.tmp-${process.pid}`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700).catch(() => {});
  await writeFile(tmpPath, stringifyYaml(session), { mode: 0o600 });
  await chmod(tmpPath, 0o600);
  await rename(tmpPath, path);
  return session;
}

export async function clearAccountSession() {
  await unlink(accountFilePath()).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

function isFresh(session) {
  return Boolean(
    session?.access_token &&
      Number(session?.expires_at || 0) - REFRESH_SKEW_SECONDS > Math.floor(Date.now() / 1000),
  );
}

async function jsonRequest(path, body, { token } = {}) {
  const response = await hfetch(`${webUrl()}/api/cli/auth/${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AccountError(data.detail || data.error || `HTTP ${response.status}`, {
      code: data.error,
      status: response.status,
    });
  }
  return data;
}

export async function refreshAccountSession(existingSession = null) {
  const session = existingSession ?? (await readAccountSession());
  if (!session?.refresh_token) {
    throw new AccountError("本机尚未绑定 Lovstudio 网站账号。", { code: "not_connected" });
  }
  const payload = await jsonRequest("refresh", { refreshToken: session.refresh_token });
  return saveAccountSession(payload);
}

function openVerificationPage(url) {
  if (process.env.LOVSTUDIO_NO_BROWSER === "1") return false;
  const command =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command[0], command[1], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function startDeviceConnection(clientName) {
  const start = await jsonRequest("start", {
    clientName,
    scope: "cli",
  });
  const verificationUrl = start.verificationUriComplete || start.verification_uri_complete;
  const userCode = start.userCode || start.user_code;
  const deviceCode = start.deviceCode || start.device_code;
  const expiresIn = Number(start.expiresIn || start.expires_in || 600);
  let interval = Number(start.interval || 5);
  if (!verificationUrl || !userCode || !deviceCode) {
    throw new AccountError("Lovstudio 网站没有返回完整的设备绑定信息。", {
      code: "invalid_device_flow",
    });
  }

  console.log(`→ 打开 Lovstudio 网站确认本机账号：${verificationUrl}`);
  console.log(`  设备确认码：${userCode}`);
  if (!openVerificationPage(verificationUrl)) {
    console.log("  未自动打开浏览器，请复制上面的地址。");
  }
  console.log("  等待网站确认…");

  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    await wait(interval * 1000);
    const poll = await jsonRequest("poll", { deviceCode });
    const error = poll.error;
    if (error === "authorization_pending" || poll.status === "pending") continue;
    if (error === "slow_down") {
      interval += 2;
      continue;
    }
    if (error === "expired_token") {
      throw new AccountError("设备确认码已过期，请重新运行连接命令。", { code: error });
    }
    if (error === "access_denied") {
      throw new AccountError("网站账号没有批准本机连接。", { code: error });
    }
    if (poll.status === "authenticated" || poll.accessToken || poll.access_token) {
      return saveAccountSession(poll);
    }
    throw new AccountError(error || "网站返回了未知的设备绑定状态。", {
      code: error || "invalid_device_status",
    });
  }
  throw new AccountError("等待网站确认超时，请重新运行连接命令。", { code: "device_timeout" });
}

export async function requireAccountSession({ clientName = "Lovstudio CLI" } = {}) {
  const session = await readAccountSession();
  if (isFresh(session)) return session;
  if (session?.refresh_token) {
    try {
      return await refreshAccountSession(session);
    } catch (error) {
      if (!(error instanceof AccountError) || error.status == null || error.status >= 500) throw error;
      // An invalid/expired refresh token requires a new one-time device binding.
    }
  }
  return startDeviceConnection(clientName);
}

export async function currentAccountSession() {
  const session = await readAccountSession();
  if (!session) return null;
  if (isFresh(session)) return session;
  return refreshAccountSession(session);
}

export async function disconnectAccount() {
  const session = await readAccountSession();
  let remoteError = null;
  if (session?.access_token || session?.refresh_token) {
    try {
      await jsonRequest(
        "signout",
        { refreshToken: session.refresh_token || null },
        { token: session.access_token || undefined },
      );
    } catch (error) {
      remoteError = error;
    }
  }
  await clearAccountSession();
  return { remoteError };
}
