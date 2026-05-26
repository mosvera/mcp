// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { createValidator } from "@mosvera/runtime";
import { runGetPalette } from "../src/tools/get-palette.ts";
import type { ToolContext } from "../src/types.ts";

function ctx(): ToolContext {
  return {
    project: {
      registry: {
        templates: {},
        modifiers: {},
        palettes: {
          warm: { $schema: "https://mosvera.io/schema/0.1/palette", id: "warm", roles: { accent: "#c8943f" } },
          child: { $schema: "https://mosvera.io/schema/0.1/palette", id: "child", $extends: "warm", roles: { accent: "#fff" } },
        },
      },
      manifests: {},
      strategies: {},
    },
    validator: createValidator(),
    baseStrategies: {},
  };
}

describe("get_palette", () => {
  it("returns the stored palette by name", () => {
    expect(runGetPalette(ctx(), { name: "warm" })).toEqual({
      palette: { $schema: "https://mosvera.io/schema/0.1/palette", id: "warm", roles: { accent: "#c8943f" } },
    });
  });

  it("flags inheritance_unresolved when the palette declares $extends (v0.1 deferral)", () => {
    const res = runGetPalette(ctx(), { name: "child" });
    expect(res).toMatchObject({ inheritance_unresolved: true });
  });

  it("returns unknown_reference for a missing palette", () => {
    expect(runGetPalette(ctx(), { name: "ghost" })).toEqual({ error: "unknown_reference", detail: { name: "ghost" } });
  });
});
