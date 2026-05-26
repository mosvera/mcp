// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { createValidator } from "@mosvera/runtime";
import { runResolveComposition } from "../src/tools/resolve-composition.ts";
import type { ToolContext } from "../src/types.ts";

function ctx(): ToolContext {
  return {
    registryDir: "/tmp/mosvera-test",
    registryWritable: false,
    readOnlyMode: true,
    fallbackRegistry: false,
    loadDiagnostics: [],
    project: {
      registry: {
        templates: { multi: { id: "multi", $extends: ["a", "b"] }, base_t: { id: "base_t", medium: "x" } },
        modifiers: {},
        palettes: {},
      },
      manifests: {},
      strategies: {},
    },
    validator: createValidator(),
    baseStrategies: {},
  };
}

describe("resolve_composition edge cases", () => {
  it("rejects multiple inheritance", () => {
    // composition validates (base is a string); the runtime rejects the list-valued $extends.
    const res = runResolveComposition(ctx(), { composition: { base: "multi" } });
    expect(res).toEqual({ error: "multiple_inheritance_unsupported" });
  });

  it("honors an inline merge_strategies override (append)", () => {
    const c = ctx();
    c.project.registry.templates = { base_t: { id: "base_t", tags: ["a"] } };
    c.project.registry.modifiers = { add: { id: "add", tags: ["b"] } };
    const res = runResolveComposition(c, {
      composition: { base: "base_t", modifiers: ["add"] },
      merge_strategies: { tags: { strategy: "append" } },
    });
    expect(res).toEqual({ canonical: { tags: ["a", "b"] } });
  });
});
