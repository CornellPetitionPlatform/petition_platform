import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePetitionUrl,
  parseSlugFromPetitionUrl,
  slugify
} from "../src/index.js";

test("slugify removes non-alphanumerics", () => {
  assert.equal(
    slugify("kd_fppftdeepv9cbcvxb"),
    "kdfppftdeepv9cbcvxb"
  );
});

test("parseSlugFromPetitionUrl strips underscores and hyphens", () => {
  const slug = parseSlugFromPetitionUrl(
    "https://cornellpetitionplatform.github.io/petition_platform/petitions/kd_fppftdeepv9cbcvxb/"
  );
  assert.equal(slug, "kdfppftdeepv9cbcvxb");
});

test("normalizePetitionUrl strips underscores and hyphens in path", () => {
  const normalized = normalizePetitionUrl(
    "https://cornellpetitionplatform.github.io/petition_platform/petitions/kd_fppftdeepv9cbcvxb/"
  );
  assert.equal(
    normalized,
    "https://cornellpetitionplatform.github.io/petition_platform/petitions/kdfppftdeepv9cbcvxb/"
  );
});
