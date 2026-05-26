// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildContext } from "../src/server.ts";
import { runCompileGeneration } from "../src/tools/compile-generation.ts";
import { runListTemplates } from "../src/tools/list-templates.ts";

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, "..", "examples", "cinematic-editorial");

describe("buildContext", () => {
  it("loads the example project and composes base strategies (schema + project)", () => {
    const ctx = buildContext(example);
    expect(ctx.baseStrategies).toEqual({
      modifiers: { strategy: "replace" },
      lights: { strategy: "merge_by", key: "name" },
    });
    const names = runListTemplates(ctx, {}).map((t) => t.name).sort();
    expect(names).toEqual(["cinematic-editorial-base", "noir"]);
  });

  it("registers reference adapters for normal compile_generation emit use", () => {
    const ctx = buildContext(example);
    expect(Object.keys(ctx.adapters ?? {}).sort()).toEqual(["bfl-flux-2-pro", "openai-gpt-image-1", "sdxl-replicate"]);

    const res = runCompileGeneration(ctx, {
      composition: { base: "noir", modifiers: ["golden-hour", "high-contrast"], overrides: { medium: "cinematic" } },
      provider: "openai-gpt-image-1",
      emit: true,
    });

    expect(res).toMatchObject({
      status: "compiled",
      emission: {
        payload: {
          model: "gpt-image-1",
          output_format: "png",
        },
      },
    });
  });
});
