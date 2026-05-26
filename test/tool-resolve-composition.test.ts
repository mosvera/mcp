// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { createValidator } from "@mosvera/runtime";
import { runResolveComposition } from "../src/tools/resolve-composition.ts";
import type { ToolContext } from "../src/types.ts";

function ctx(): ToolContext {
  return {
    project: {
      registry: {
        templates: { base_t: { id: "base_t", medium: "photographic" } },
        modifiers: { warm: { id: "warm", color_temperature: "warm" } },
        palettes: {},
      },
      manifests: {},
      strategies: {},
    },
    validator: createValidator(),
    baseStrategies: {},
  };
}

describe("resolve_composition", () => {
  it("resolves a valid composition to its canonical model", () => {
    const res = runResolveComposition(ctx(), { composition: { base: "base_t", modifiers: ["warm"] } });
    expect(res).toEqual({ canonical: { medium: "photographic", color_temperature: "warm" } });
  });

  it("returns invalid_document for a composition missing base", () => {
    const res = runResolveComposition(ctx(), { composition: { modifiers: [] } });
    expect(res).toMatchObject({ error: "invalid_document" });
  });

  it("returns unknown_reference for a missing modifier", () => {
    const res = runResolveComposition(ctx(), { composition: { base: "base_t", modifiers: ["ghost"] } });
    expect(res).toEqual({ error: "unknown_reference", detail: { missing: ["ghost"] } });
  });

  it("returns inheritance_cycle for a cyclic template lineage", () => {
    const c = ctx();
    c.project.registry.templates = {
      a: { id: "a", $extends: "b" },
      b: { id: "b", $extends: "a" },
    };
    const res = runResolveComposition(c, { composition: { base: "a" } });
    expect(res).toEqual({ error: "inheritance_cycle" });
  });

  it("returns invalid_document with an errors array (not a bare string) for unparseable input", () => {
    const res = runResolveComposition(ctx(), { composition: "::: not yaml :::" });
    expect(res).toMatchObject({ error: "invalid_document", detail: { errors: [{ path: "" }] } });
  });
});
