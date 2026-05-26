// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry } from "../src/registry/loader.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");

describe("loadRegistry", () => {
  it("loads templates/modifiers/palettes indexed by id, manifests by provider, and strategies", () => {
    const p = loadRegistry(join(fixtures, "good-project"));
    expect(Object.keys(p.registry.templates ?? {})).toEqual(["base_t"]);
    expect(Object.keys(p.registry.modifiers ?? {})).toEqual(["warm"]);
    expect(Object.keys(p.registry.palettes ?? {})).toEqual(["p"]);
    expect(Object.keys(p.manifests)).toEqual(["demo"]);
    expect(p.strategies).toEqual({ lights: { strategy: "merge_by", key: "name" } });
  });

  it("fails loudly on an invalid document, naming the file", () => {
    expect(() => loadRegistry(join(fixtures, "bad-project"))).toThrow(/template\.broken\.json/);
  });
});
