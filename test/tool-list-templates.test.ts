// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { runListTemplates } from "../src/tools/list-templates.ts";
import type { ToolContext } from "../src/types.ts";

const ctx = {
  project: {
    registry: {
      templates: {
        "cinematic-editorial-base": { id: "cinematic-editorial-base", medium: "photographic" },
        noir: { id: "noir", $extends: "cinematic-editorial-base", lighting: { mood: "moody" } },
      },
    },
    manifests: {},
    strategies: {},
  },
  validator: {} as never,
  baseStrategies: {},
} as unknown as ToolContext;

describe("list_templates", () => {
  it("lists template names with their $extends parent", () => {
    expect(runListTemplates(ctx, {})).toEqual([
      { name: "cinematic-editorial-base" },
      { name: "noir", extends: "cinematic-editorial-base" },
    ]);
  });

  it("includes inline-override templates", () => {
    const out = runListTemplates(ctx, { registry: { templates: { extra: { id: "extra" } } } });
    expect(out.map((t) => t.name).sort()).toEqual(["cinematic-editorial-base", "extra", "noir"]);
  });
});
