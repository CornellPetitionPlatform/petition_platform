import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePetitionUrl,
  normalizeSlug,
  parseSlugFromPetitionUrl,
  slugify
} from "../src/index.js";

test("slugify removes non-alphanumerics", () => {
  assert.equal(
    slugify("petition-kd_fppftdeepv9cbcvxb"),
    "petitionkdfppftdeepv9cbcvxb"
  );
});

test("normalizeSlug preserves underscores in slugs", () => {
  assert.equal(
    normalizeSlug("petition-kd_fppftdeepv9cbcvxb"),
    "petition-kd_fppftdeepv9cbcvxb"
  );
});

test("parseSlugFromPetitionUrl preserves underscored slugs", () => {
  const slug = parseSlugFromPetitionUrl(
    "https://cornellpetitionplatform.github.io/petition_platform/petitions/petition-kd_fppftdeepv9cbcvxb/"
  );
  assert.equal(slug, "petition-kd_fppftdeepv9cbcvxb");
});

test("normalizePetitionUrl preserves underscored slugs in path", () => {
  const normalized = normalizePetitionUrl(
    "https://cornellpetitionplatform.github.io/petition_platform/petitions/petition-kd_fppftdeepv9cbcvxb/"
  );
  assert.equal(
    normalized,
    "https://cornellpetitionplatform.github.io/petition_platform/petitions/petition-kd_fppftdeepv9cbcvxb/"
  );
});
