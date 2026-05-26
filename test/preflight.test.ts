// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { collectMissingReferences } from "../src/registry/preflight.ts";
import type { Registry } from "@mosvera/runtime";

const registry: Registry = {
  templates: { base_t: { id: "base_t" } },
  modifiers: { m1: { id: "m1" }, m2: { id: "m2" } },
};

describe("collectMissingReferences", () => {
  it("returns [] when base and all modifiers exist", () => {
    expect(collectMissingReferences({ base: "base_t", modifiers: ["m1", "m2"] }, registry)).toEqual([]);
  });

  it("flags a missing base", () => {
    expect(collectMissingReferences({ base: "nope", modifiers: ["m1"] }, registry)).toEqual(["nope"]);
  });

  it("flags missing modifiers in order", () => {
    expect(collectMissingReferences({ base: "base_t", modifiers: ["m1", "ghost", "phantom"] }, registry)).toEqual([
      "ghost",
      "phantom",
    ]);
  });

  it("flags a non-string base as the literal missing token", () => {
    expect(collectMissingReferences({ modifiers: [] }, registry)).toEqual(["<missing base>"]);
  });
});
