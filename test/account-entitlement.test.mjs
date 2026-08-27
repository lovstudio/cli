import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(repoRoot, "bin", "lovstudio.mjs");

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HTTPS_PROXY: "",
        HTTP_PROXY: "",
        https_proxy: "",
        http_proxy: "",
        LOVSTUDIO_NO_BROWSER: "1",
        LOVSTUDIO_SKIP_LOCAL_LICENSE: "1",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function authenticatedSession(email = "buyer@example.com") {
  return {
    status: "authenticated",
    accessToken: "fresh-access-token",
    refreshToken: "fresh-refresh-token",
    expiresIn: 3600,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-123", email },
  };
}

test("account status silently refreshes the shared website session", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-account-refresh-"));
  const home = join(fixture, ".lovstudio");
  await mkdir(home, { recursive: true });
  await writeFile(
    join(home, "auth.yml"),
    stringifyYaml({
      access_token: "expired-access-token",
      refresh_token: "existing-refresh-token",
      expires_at: 1,
      user_id: "user-123",
      email: "buyer@example.com",
    }),
  );
  let refreshCalls = 0;
  let startCalls = 0;
  const api = await listen(async (req, res) => {
    if (req.url === "/api/cli/auth/refresh") {
      refreshCalls += 1;
      return json(res, 200, authenticatedSession());
    }
    if (req.url === "/api/cli/auth/start") startCalls += 1;
    return json(res, 404, { error: "not_found" });
  });
  try {
    const result = await run(["account", "status"], {
      LOVSTUDIO_HOME: home,
      LOVSTUDIO_WEB_URL: api.baseUrl,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /buyer@example\.com/);
    assert.equal(refreshCalls, 1);
    assert.equal(startCalls, 0);
    const saved = parseYaml(await readFile(join(home, "auth.yml"), "utf8"));
    assert.equal(saved.access_token, "fresh-access-token");
    assert.equal((await stat(join(home, "auth.yml"))).mode & 0o777, 0o600);
  } finally {
    await api.close();
  }
});

test("account connect binds a logged-in website account once through device flow", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-account-connect-"));
  const home = join(fixture, ".lovstudio");
  let startCalls = 0;
  let pollCalls = 0;
  const api = await listen(async (req, res) => {
    if (req.url === "/api/cli/auth/start") {
      startCalls += 1;
      return json(res, 200, {
        deviceCode: "device-code",
        userCode: "ABCD-EFGH",
        verificationUriComplete: `${api.baseUrl}/cli/authorize?code=ABCD-EFGH`,
        expiresIn: 60,
        interval: 0.01,
      });
    }
    if (req.url === "/api/cli/auth/poll") {
      pollCalls += 1;
      return json(res, 200, authenticatedSession());
    }
    return json(res, 404, { error: "not_found" });
  });
  try {
    const result = await run(["account", "connect"], {
      LOVSTUDIO_HOME: home,
      LOVSTUDIO_WEB_URL: api.baseUrl,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /设备确认码：ABCD-EFGH/);
    assert.match(result.stdout, /本机已连接 Lovstudio 网站账号：buyer@example\.com/);
    assert.equal(startCalls, 1);
    assert.equal(pollCalls, 1);
    const saved = parseYaml(await readFile(join(home, "auth.yml"), "utf8"));
    assert.equal(saved.user_id, "user-123");
  } finally {
    await api.close();
  }
});

test("account disconnect revokes the website session and removes the shared local credential", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-account-disconnect-"));
  const home = join(fixture, ".lovstudio");
  await mkdir(home, { recursive: true });
  await writeFile(
    join(home, "auth.yml"),
    stringifyYaml({
      access_token: "valid-access-token",
      refresh_token: "valid-refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user_id: "user-123",
      email: "buyer@example.com",
    }),
  );
  let signoutCalls = 0;
  const api = await listen(async (req, res) => {
    if (req.url === "/api/cli/auth/signout") {
      signoutCalls += 1;
      assert.equal(req.headers.authorization, "Bearer valid-access-token");
      return json(res, 200, { success: true });
    }
    return json(res, 404, { error: "not_found" });
  });
  try {
    const result = await run(["account", "disconnect"], {
      LOVSTUDIO_HOME: home,
      LOVSTUDIO_WEB_URL: api.baseUrl,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(signoutCalls, 1);
    await assert.rejects(readFile(join(home, "auth.yml"), "utf8"), { code: "ENOENT" });
  } finally {
    await api.close();
  }
});

test("an already-owned website Skill installs without purchase confirmation or purchase mutation", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-account-owned-"));
  const home = join(fixture, ".lovstudio");
  const bin = join(fixture, "bin");
  await mkdir(home, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(
    join(home, "auth.yml"),
    stringifyYaml({
      access_token: "valid-access-token",
      refresh_token: "valid-refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user_id: "user-123",
      email: "buyer@example.com",
    }),
  );
  const npx = join(bin, "npx");
  await writeFile(npx, "#!/bin/sh\necho \"MOCK_NPX:$*\"\n");
  await chmod(npx, 0o755);
  let purchaseCalls = 0;
  const api = await listen(async (req, res) => {
    if (req.url === "/skills.yaml") {
      res.writeHead(200, { "content-type": "text/yaml" });
      return res.end(`skills:\n- name: write-professional-book\n  runtime_name: lov-write-professional-book\n  paid: true\n  encrypted_bundle: true\n`);
    }
    if (req.url?.startsWith("/api/skills/price")) {
      assert.equal(req.headers.authorization, "Bearer valid-access-token");
      return json(res, 200, {
        skill_id: 7,
        skill_name: "write-professional-book",
        price_credits: 100,
        list_price_credits: 100,
        discount_percent: 0,
        owned: true,
      });
    }
    if (req.url === "/api/skills/purchase") {
      purchaseCalls += 1;
      return json(res, 500, { error: "must_not_purchase" });
    }
    return json(res, 404, { error: "not_found" });
  });
  try {
    const result = await run(
      ["skills", "add", "write-professional-book", "-g", "-a", "codex", "-y"],
      {
        LOVSTUDIO_HOME: home,
        LOVSTUDIO_WEB_URL: api.baseUrl,
        LOVSTUDIO_SKILLS_CATALOG_URL: `${api.baseUrl}/skills.yaml`,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /网站账号已拥有.*直接安装/);
    assert.match(result.stdout, /MOCK_NPX:.*--skill lov-write-professional-book/);
    assert.equal(purchaseCalls, 0);
  } finally {
    await api.close();
  }
});

test("an already-owned public-source paid Skill installs from its source repository", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-account-public-source-"));
  const home = join(fixture, ".lovstudio");
  const bin = join(fixture, "bin");
  await mkdir(home, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(
    join(home, "auth.yml"),
    stringifyYaml({
      access_token: "valid-access-token",
      refresh_token: "valid-refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user_id: "user-123",
      email: "buyer@example.com",
    }),
  );
  const npx = join(bin, "npx");
  await writeFile(npx, "#!/bin/sh\necho \"MOCK_NPX:$*\"\n");
  await chmod(npx, 0o755);
  let purchaseCalls = 0;
  const api = await listen(async (req, res) => {
    if (req.url === "/skills.yaml") {
      res.writeHead(200, { "content-type": "text/yaml" });
      return res.end(`skills:\n- name: media-creator\n  runtime_name: lov-media-creator\n  repo: lovstudio/media-creator-skill\n  paid: true\n  public_source: true\n`);
    }
    if (req.url?.startsWith("/api/skills/price")) {
      assert.equal(req.headers.authorization, "Bearer valid-access-token");
      return json(res, 200, {
        skill_id: 637,
        skill_name: "media-creator",
        price_credits: 1394,
        list_price_credits: 1394,
        discount_percent: 0,
        owned: true,
      });
    }
    if (req.url === "/api/skills/purchase") {
      purchaseCalls += 1;
      return json(res, 500, { error: "must_not_purchase" });
    }
    return json(res, 404, { error: "not_found" });
  });
  try {
    const result = await run(
      ["skills", "add", "media-creator", "-g", "-a", "codex", "-y"],
      {
        LOVSTUDIO_HOME: home,
        LOVSTUDIO_WEB_URL: api.baseUrl,
        LOVSTUDIO_SKILLS_CATALOG_URL: `${api.baseUrl}/skills.yaml`,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /网站账号已拥有.*直接安装/);
    assert.match(
      result.stdout,
      /MOCK_NPX:.*add lovstudio\/media-creator-skill .*--skill lov-media-creator/,
    );
    assert.equal(purchaseCalls, 0);
  } finally {
    await api.close();
  }
});

test("a local license entitlement installs a paid Skill without account or Credits requests", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lovstudio-local-license-owned-"));
  const home = join(fixture, ".lovstudio");
  const bin = join(fixture, "bin");
  await mkdir(home, { recursive: true });
  await mkdir(bin, { recursive: true });

  const uvx = join(bin, "uvx");
  await writeFile(
    uvx,
    "#!/bin/sh\nprintf '%s\\n' '{\"activated\":true,\"licenses\":[{\"entitled_skills\":[\"media-creator\"]}]}'\n",
  );
  await chmod(uvx, 0o755);
  const npx = join(bin, "npx");
  await writeFile(npx, "#!/bin/sh\necho \"MOCK_NPX:$*\"\n");
  await chmod(npx, 0o755);

  let priceCalls = 0;
  let purchaseCalls = 0;
  const api = await listen(async (req, res) => {
    if (req.url === "/skills.yaml") {
      res.writeHead(200, { "content-type": "text/yaml" });
      return res.end(`skills:\n- name: media-creator\n  runtime_name: lov-media-creator\n  repo: lovstudio/media-creator-skill\n  paid: true\n  public_source: true\n`);
    }
    if (req.url?.startsWith("/api/skills/price")) priceCalls += 1;
    if (req.url === "/api/skills/purchase") purchaseCalls += 1;
    return json(res, 500, { error: "must_not_call_account_or_credits" });
  });
  try {
    const result = await run(
      ["skills", "add", "media-creator", "-g", "-a", "codex", "-y"],
      {
        LOVSTUDIO_HOME: home,
        LOVSTUDIO_WEB_URL: api.baseUrl,
        LOVSTUDIO_SKILLS_CATALOG_URL: `${api.baseUrl}/skills.yaml`,
        LOVSTUDIO_SKIP_LOCAL_LICENSE: "0",
        PATH: `${bin}${delimiter}${process.env.PATH}`,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /本机 license 已授权.*不需要 Credits/);
    assert.match(
      result.stdout,
      /MOCK_NPX:.*add lovstudio\/media-creator-skill .*--skill lov-media-creator/,
    );
    assert.equal(priceCalls, 0);
    assert.equal(purchaseCalls, 0);
  } finally {
    await api.close();
  }
});
