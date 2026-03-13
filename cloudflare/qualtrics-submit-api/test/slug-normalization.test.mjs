import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePetitionUrl,
  normalizeSlug,
  parseSlugFromPetitionUrl
} from "../src/index.js";

test("normalizeSlug replaces underscores with hyphens", () => {
  assert.equal(
    normalizeSlug("petition-kd_fppftdeepv9cbcvxb"),
    "petition-kd-fppftdeepv9cbcvxb"
  );
});

test("parseSlugFromPetitionUrl normalizes underscored slugs", () => {
  const slug = parseSlugFromPetitionUrl(
    "https://cornellpetitionplatform.github.io/petition_platform/petitions/petition-kd_fppftdeepv9cbcvxb/"
  );
  assert.equal(slug, "petition-kd-fppftdeepv9cbcvxb");
});

test("normalizePetitionUrl rewrites underscored slugs in path", () => {
  const normalized = normalizePetitionUrl(
    "https://cornellpetitionplatform.github.io/petition_platform/petitions/petition-kd_fppftdeepv9cbcvxb/"
  );
  assert.equal(
    normalized,
    "https://cornellpetitionplatform.github.io/petition_platform/petitions/petition-kd-fppftdeepv9cbcvxb/"
  );
});
