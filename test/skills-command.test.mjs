import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  catalogSkillDependencyClosure,
  catalogSkillInstallPlans,
  catalogSkillSelector,
  canonicalSkillName,
  findCatalogSkill,
  locateExtractedSkill,
  skillSelector,
} from "../src/commands/skills/index.mjs";

test("catalogSkillDependencyClosure installs transitive Skill dependencies first", () => {
  const catalog = [
    { name: "branding-consistency", runtime_name: "lov-branding-consistency" },
    { name: "human-writing", runtime_name: "lov-human-writing", depends_on: ["branding-consistency"] },
    { name: "writing-style", runtime_name: "lov-writing-style", depends_on: ["branding-consistency", "human-writing"] },
  ];

  assert.deepEqual(
    catalogSkillDependencyClosure(catalog, catalog[2]).map((skill) => skill.name),
    ["branding-consistency", "human-writing", "writing-style"],
  );
});

test("catalogSkillDependencyClosure rejects missing and cyclic dependencies", () => {
  const missing = [{ name: "writing-style", depends_on: ["human-writing"] }];
  assert.throws(
    () => catalogSkillDependencyClosure(missing, missing[0]),
    /depends on missing catalog Skill: human-writing/,
  );

  const cyclic = [
    { name: "first", depends_on: ["second"] },
    { name: "second", depends_on: ["first"] },
  ];
  assert.throws(
    () => catalogSkillDependencyClosure(cyclic, cyclic[0]),
    /catalog dependency cycle: first -> second -> first/,
  );
});

test("catalogSkillInstallPlans groups free Skills and downloads each paid Skill on its own", () => {
  const freeBrand = { name: "branding-consistency", runtime_name: "lov-branding-consistency", paid: false };
  const freeHuman = { name: "human-writing", runtime_name: "lov-human-writing", paid: false };
  const paidA = { name: "proposal", runtime_name: "lov-proposal", paid: true };
  const paidB = { name: "event-poster", runtime_name: "lov-event-poster", paid: true };

  assert.deepEqual(
    catalogSkillInstallPlans([freeBrand, freeHuman, paidA, paidB]),
    [
      {
        paid: false,
        source: "https://github.com/lovstudio/skills.git",
        selectors: ["lov-branding-consistency", "lov-human-writing"],
        skills: [freeBrand, freeHuman],
      },
      { paid: true, source: null, selectors: ["lov-proposal"], skills: [paidA] },
      { paid: true, source: null, selectors: ["lov-event-poster"], skills: [paidB] },
    ],
  );
});

test("skillSelector maps catalog aliases to the current lov-* install id", () => {
  assert.equal(skillSelector("write-professional-book"), "lov-write-professional-book");
  assert.equal(skillSelector("lov-write-professional-book"), "lov-write-professional-book");
  assert.equal(skillSelector("lovstudio-write-professional-book"), "lov-write-professional-book");
  assert.equal(skillSelector("lovstudio:write-professional-book"), "lov-write-professional-book");
});

test("skillSelector preserves full-catalog aliases", () => {
  for (const alias of ["*", "all", "skills", "lovstudio/skills"]) {
    assert.equal(skillSelector(alias), "*");
  }
});

test("canonicalSkillName resolves current and legacy install ids to the catalog name", () => {
  assert.equal(canonicalSkillName("write-professional-book"), "write-professional-book");
  assert.equal(canonicalSkillName("lov-write-professional-book"), "write-professional-book");
  assert.equal(canonicalSkillName("lovstudio-write-professional-book"), "write-professional-book");
  assert.equal(canonicalSkillName("lovstudio:write-professional-book"), "write-professional-book");
});

test("catalogSkillSelector uses the runtime name declared by the catalog", () => {
  assert.equal(
    catalogSkillSelector({ name: "write-professional-book", runtime_name: "lov-write-professional-book" }),
    "lov-write-professional-book",
  );
  assert.equal(
    catalogSkillSelector({ name: "professional-infographic", runtime_name: "lovstudio:professional-infographic" }),
    "lovstudio:professional-infographic",
  );
  assert.equal(
    catalogSkillSelector({ name: "cc-migrate-session", runtime_name: "lov-cc-mv" }),
    "lov-cc-mv",
  );
  assert.equal(
    catalogSkillSelector({ name: "deep-research", runtime_name: "deep-research" }),
    "deep-research",
  );
});

test("catalogSkillSelector keeps the lov-* fallback for legacy catalogs", () => {
  assert.equal(catalogSkillSelector({ name: "write-professional-book" }), "lov-write-professional-book");
});

test("findCatalogSkill accepts both product slugs and exact runtime names", () => {
  const catalog = [
    { name: "write-professional-book", runtime_name: "lov-write-professional-book" },
    { name: "install-ai", runtime_name: "sgc-install-ai" },
    { name: "deep-research", runtime_name: "deep-research" },
    { name: "legacy-entry" },
  ];

  assert.equal(findCatalogSkill(catalog, "write-professional-book"), catalog[0]);
  assert.equal(findCatalogSkill(catalog, "lov-write-professional-book"), catalog[0]);
  assert.equal(findCatalogSkill(catalog, "sgc-install-ai"), catalog[1]);
  assert.equal(findCatalogSkill(catalog, "deep-research"), catalog[2]);
  assert.equal(findCatalogSkill(catalog, "lov-legacy-entry"), catalog[3]);
});

test("locateExtractedSkill resolves the Skill directory inside a GitHub archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "lovstudio-extract-"));
  await mkdir(join(root, "lovstudio-proposal-skill-abc", "src"), { recursive: true });
  await writeFile(join(root, "lovstudio-proposal-skill-abc", "src", "SKILL.md"), "---\nname: lov-proposal\n---\n");

  assert.equal(await locateExtractedSkill(root, "src"), join(root, "lovstudio-proposal-skill-abc", "src"));
  await assert.rejects(locateExtractedSkill(root, ""), /SKILL\.md not found at the repository root/);
});
