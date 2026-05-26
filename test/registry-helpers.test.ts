// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { composeStrategies, mergeRegistry } from "../src/registry/strategies.ts";

describe("composeStrategies", () => {
  it("layers later sources over earlier ones by field name", () => {
    const schema = { modifiers: { strategy: "replace" as const } };
    const project = { lights: { strategy: "merge_by" as const, key: "name" } };
    const inline = { lights: { strategy: "append" as const } };
    expect(composeStrategies(schema, project, inline)).toEqual({
      modifiers: { strategy: "replace" },
      lights: { strategy: "append" },
    });
  });

  it("ignores undefined layers", () => {
    expect(composeStrategies({ a: { strategy: "replace" } }, undefined)).toEqual({
      a: { strategy: "replace" },
    });
  });
});

describe("mergeRegistry", () => {
  const base = {
    templates: { t1: { id: "t1" }, t2: { id: "t2" } },
    modifiers: { m1: { id: "m1" } },
    palettes: { p1: { id: "p1" } },
  };

  it("returns base unchanged when no inline override", () => {
    expect(mergeRegistry(base, undefined)).toEqual(base);
  });

  it("shadows by id per collection and adds new ids", () => {
    const inline = { templates: { t2: { id: "t2", patched: true }, t3: { id: "t3" } } };
    const out = mergeRegistry(base, inline);
    expect(out.templates).toEqual({
      t1: { id: "t1" },
      t2: { id: "t2", patched: true },
      t3: { id: "t3" },
    });
    expect(out.modifiers).toEqual({ m1: { id: "m1" } });
    expect(out.palettes).toEqual({ p1: { id: "p1" } });
  });
});
