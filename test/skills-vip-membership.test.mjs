import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = process.env.LOVSTUDIO_TEST_CLI_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const skillName = "3d-motion-media-creator";
const paidCatalog = `skills:\n- name: ${skillName}\n  runtime_name: lov-${skillName}\n  repo: lovstudio/${skillName}-skill\n  paid: true\n`;
const freeCatalog = paidCatalog.replace("paid: true", "paid: false");

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "lovstudio-vip-install-"));
  const home = join(dir, "account");
  const bin = join(dir, "bin");
  await mkdir(home);
  await mkdir(bin);
  await writeFile(join(home, "auth.yml"), `access_token: valid-access-token\nrefresh_token: valid-refresh-token\nexpires_at: ${Math.floor(Date.now() / 1000) + 3600}\nuser_id: fixture-user\nemail: fixture@example.com\n`);
  await writeFile(join(bin, "npx"), '#!/bin/sh\necho "MOCK_NPX:$*"\nif [ -f "$4/SKILL.md" ]; then cat "$4/SKILL.md"; fi\n');
  await chmod(join(bin, "npx"), 0o755);
  const archiveDir = join(dir, "archive");
  await mkdir(join(archiveDir, "skill-v0.1.1"), { recursive: true });
  await writeFile(join(archiveDir, "skill-v0.1.1", "SKILL.md"), `---\nname: lov-${skillName}\n---\nVIP_PLAIN_SOURCE\n`);
  const tarball = join(dir, "skill.tar.gz");
  const packed = spawnSync("tar", ["-czf", tarball, "-C", archiveDir, "skill-v0.1.1"]);
  assert.equal(packed.status, 0, String(packed.stderr));
  return { dir, home, bin, archive: await readFile(tarball) };
}

function run(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(repoRoot, "bin/lovstudio.mjs"), "skills", "add", skillName, "--project", "-a", "codex", "-y"], {
      cwd: repoRoot,
      env: { ...process.env, HTTPS_PROXY: "", HTTP_PROXY: "", https_proxy: "", http_proxy: "", LOVSTUDIO_NO_BROWSER: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const scenarios = [
  { name: "active VIP installs without Credits requests", active: true, owned: true, status: 0 },
  { name: "existing license owner installs without VIP or Credits requests", active: false, owned: true, status: 0 },
  { name: "mismatched Skill entitlement cannot download or install", active: true, owned: true, membershipName: "another-skill", status: 1, nameMismatch: true },
  { name: "missing Skill name in entitlement cannot download or install", active: true, owned: true, missingName: true, status: 1, nameMismatch: true },
  { name: "account without entitlement receives VIP link and cannot download", active: false, owned: false, status: 1, vip: true },
  { name: "guest device binding failure cannot download", guest: true, status: 1 },
  { name: "expired session refreshes before membership and download", active: true, owned: true, expired: true, status: 0 },
  { name: "rejected membership session requires reconnect and cannot download", membershipStatus: 401, status: 1 },
  { name: "download entitlement refusal receives VIP link", active: true, owned: true, downloadStatus: 403, status: 1, vip: true },
  { name: "free Skill installs without account, membership or download requests", free: true, status: 0 },
];

for (const scenario of scenarios) {
  test(scenario.name, async () => {
    const f = await fixture();
    if (scenario.guest || scenario.free) await rm(join(f.home, "auth.yml"));
    if (scenario.expired) {
      await writeFile(join(f.home, "auth.yml"), "access_token: expired-access-token\nrefresh_token: valid-refresh-token\nexpires_at: 1\nuser_id: fixture-user\n");
    }
    const requests = [];
    const api = createServer(async (req, res) => {
      requests.push(req.url);
      if (req.url === "/skills.yaml") {
        res.writeHead(200, { "content-type": "text/yaml" });
        return res.end(scenario.free ? freeCatalog : paidCatalog);
      }
      if (req.url === "/api/cli/auth/start") return json(res, 401, { error: "unauthorized" });
      if (req.url === "/api/cli/auth/refresh") return json(res, 200, {
        accessToken: "refreshed-access-token", refreshToken: "refreshed-refresh-token", expiresIn: 3600,
        expiresAt: Math.floor(Date.now() / 1000) + 3600, user: { id: "fixture-user", email: "fixture@example.com" },
      });
      if (req.url === `/api/membership?skill=${skillName}`) {
        assert.equal(req.headers.authorization, `Bearer ${scenario.expired ? "refreshed" : "valid"}-access-token`);
        if (scenario.membershipStatus) return json(res, scenario.membershipStatus, { error: "unauthorized" });
        return json(res, 200, { plan: {}, membership: scenario.active ? { active: true, lifetime: true, expiresAt: null } : null, skill: { ...(scenario.missingName ? {} : { name: scenario.membershipName || skillName }), owned: scenario.owned === true } });
      }
      if (req.url === "/api/skills/download") {
        assert.equal(req.headers.authorization, `Bearer ${scenario.expired ? "refreshed" : "valid"}-access-token`);
        let body = "";
        for await (const chunk of req) body += chunk;
        assert.deepEqual(JSON.parse(body), { skill_name: skillName });
        if (scenario.downloadStatus) return json(res, scenario.downloadStatus, { error: "ownership_required", vip_url: `/vip?from=skill:${skillName}` });
        return json(res, 200, { download_url: `${baseUrl}/archive.tar.gz`, version: "0.1.1", ref: "v0.1.1", skill_path: "" });
      }
      if (req.url === "/archive.tar.gz") {
        res.writeHead(200, { "content-type": "application/gzip" });
        return res.end(f.archive);
      }
      return json(res, 404, { error: "not_found" });
    });
    await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${api.address().port}`;
    try {
      const result = await run({ LOVSTUDIO_HOME: f.home, LOVSTUDIO_WEB_URL: baseUrl, LOVSTUDIO_SKILLS_CATALOG_URL: `${baseUrl}/skills.yaml`, PATH: `${f.bin}${delimiter}${process.env.PATH}` });
      assert.equal(result.status, scenario.status, result.stderr);
      assert.equal(requests.filter((url) => /^\/api\/skills\/(price|purchase)/.test(url)).length, 0, "removed Credits endpoints must never be requested");
      if (scenario.status === 0) {
        assert.match(result.stdout, /MOCK_NPX/);
        assert.doesNotMatch(result.stdout, /MOCK_NPX:.*--global/, "--project must not install globally");
        if (!scenario.free) {
          assert.match(result.stdout, /VIP_PLAIN_SOURCE/);
          assert.ok(requests.indexOf(`/api/membership?skill=${skillName}`) < requests.indexOf("/api/skills/download"));
        }
      } else {
        assert.doesNotMatch(result.stdout, /MOCK_NPX/);
        if (!scenario.downloadStatus) assert.equal(requests.filter((url) => url === "/api/skills/download").length, 0);
      }
      if (scenario.vip) assert.ok(result.stderr.includes(`/vip?from=skill:${skillName}`), result.stderr);
      if (scenario.membershipStatus === 401) assert.match(result.stderr, /登录状态已失效/);
      if (scenario.nameMismatch) assert.match(result.stderr, /会员权益响应未匹配请求/);
      if (scenario.guest) assert.match(result.stderr, /网站账号连接未完成/);
      if (scenario.expired) assert.equal(requests.filter((url) => url === "/api/cli/auth/refresh").length, 1);
      if (scenario.free) assert.equal(requests.filter((url) => url.startsWith("/api/")).length, 0);
    } finally {
      await new Promise((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
      await rm(f.dir, { recursive: true, force: true });
    }
  });
}
