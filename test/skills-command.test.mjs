import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogSkillDependencyClosure,
  catalogSkillInstallPlans,
  catalogSkillSelector,
  canonicalSkillName,
  findCatalogSkill,
  licenseStatusEntitlesSkill,
  paidSkillInstallSource,
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

test("catalogSkillInstallPlans groups adjacent selectors by delivery source", () => {
  const freeBrand = { name: "branding-consistency", runtime_name: "lov-branding-consistency", paid: false };
  const freeHuman = { name: "human-writing", runtime_name: "lov-human-writing", paid: false };
  const paidPublic = {
    name: "public-paid",
    runtime_name: "lov-public-paid",
    paid: true,
    public_source: true,
    repo: "lovstudio/public-paid-skill",
  };

  assert.deepEqual(
    catalogSkillInstallPlans([freeBrand, freeHuman, paidPublic]),
    [
      {
        source: "lovstudio/skills",
        selectors: ["lov-branding-consistency", "lov-human-writing"],
        skills: [freeBrand, freeHuman],
      },
      {
        source: "lovstudio/public-paid-skill",
        selectors: ["lov-public-paid"],
        skills: [paidPublic],
      },
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

test("paidSkillInstallSource distinguishes encrypted and public-source delivery", () => {
  assert.equal(
    paidSkillInstallSource({ paid: true, encrypted_bundle: true }),
    "lovstudio/skills",
  );
  assert.equal(
    paidSkillInstallSource({
      paid: true,
      public_source: true,
      repo: "lovstudio/media-creator-skill",
    }),
    "lovstudio/media-creator-skill",
  );
  assert.equal(paidSkillInstallSource({ paid: true }), null);
  assert.equal(paidSkillInstallSource({ paid: true, public_source: true }), null);
});

test("licenseStatusEntitlesSkill accepts catalog and runtime aliases", () => {
  const status = {
    licenses: [
      { entitled_skills: ["lov-media-creator", "lovstudio-write-professional-book"] },
    ],
  };
  assert.equal(licenseStatusEntitlesSkill(status, "media-creator"), true);
  assert.equal(licenseStatusEntitlesSkill(status, "lovstudio:write-professional-book"), true);
  assert.equal(licenseStatusEntitlesSkill(status, "subtitle-freedom"), false);
  assert.equal(licenseStatusEntitlesSkill({ activated: true }, "media-creator"), false);
});
