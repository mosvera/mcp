// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { createValidator, type CapabilityManifest } from "@mosvera/runtime";
import type { EmissionResult, ProviderAdapter, ProviderPayload } from "@mosvera/provider-base";
import { runCompileGeneration } from "../src/tools/compile-generation.ts";
import type { ToolContext } from "../src/types.ts";

const manifest: CapabilityManifest = {
  provider: "demo",
  adapter_version: "0.0.0",
  constructs: {
    medium: { lowering_action: "native" },
    color_temperature: { lowering_action: "approximate", note: "mapped to a warmth prompt phrase" },
  },
};

const adapter: ProviderAdapter = {
  id: "demo",
  version: "0.0.0",
  manifest: () => manifest,
  emit(canonical): EmissionResult {
    return {
      payload: { prompt: String(canonical.medium), provider: "demo" },
      prompt: String(canonical.medium),
      warnings: [],
      provenance: {
        prompt: { canonical_construct: "medium", lowering_action: "native", source_value: canonical.medium },
      },
    };
  },
  async execute(payload: ProviderPayload) {
    return { id: "manual", images: [], metadata: { payload } };
  },
};

function ctx(): ToolContext {
  return {
    registryDir: "/tmp/mosvera-test",
    registryWritable: false,
    readOnlyMode: true,
    fallbackRegistry: false,
    loadDiagnostics: [],
    project: {
      registry: {
        templates: { base_t: { id: "base_t", medium: "photographic" } },
        modifiers: { warm: { id: "warm", color_temperature: "warm" } },
        palettes: {},
      },
      manifests: { demo: manifest },
      strategies: {},
    },
    validator: createValidator(),
    baseStrategies: {},
    adapters: { demo: adapter },
  };
}

describe("compile_generation", () => {
  it("resolves then compiles against a registry manifest, returning warnings + canonical", () => {
    const res = runCompileGeneration(ctx(), { composition: { base: "base_t", modifiers: ["warm"] }, provider: "demo" });
    expect(res).toEqual({
      status: "compiled",
      warnings: [{ construct: "color_temperature", action: "approximate" }],
      canonical: { medium: "photographic", color_temperature: "warm" },
    });
  });

  it("returns unknown_provider when no manifest matches", () => {
    const res = runCompileGeneration(ctx(), { composition: { base: "base_t" }, provider: "nope" });
    expect(res).toEqual({ error: "unknown_provider", detail: { provider: "nope" } });
  });

  it("returns unknown_reference for a missing modifier (pre-flight)", () => {
    const res = runCompileGeneration(ctx(), { composition: { base: "base_t", modifiers: ["ghost"] }, provider: "demo" });
    expect(res).toEqual({ error: "unknown_reference", detail: { missing: ["ghost"] } });
  });

  it("passes through a required_unsupported hard error with the canonical model", () => {
    const res = runCompileGeneration(ctx(), {
      composition: { base: "base_t", modifiers: ["warm"] },
      provider: "demo",
      criticality: { color_temperature: "required" },
      manifest: { provider: "demo", adapter_version: "0.0.0", constructs: { medium: { lowering_action: "native" } } },
    });
    expect(res).toEqual({
      status: "error",
      error: "required_unsupported",
      construct: "color_temperature",
      canonical: { medium: "photographic", color_temperature: "warm" },
    });
  });

  it("emits a provider payload when emit=true and an adapter is registered", () => {
    const res = runCompileGeneration(ctx(), { composition: { base: "base_t" }, provider: "demo", emit: true });
    expect(res).toEqual({
      status: "compiled",
      canonical: { medium: "photographic" },
      emission: {
        payload: { prompt: "photographic", provider: "demo" },
        prompt: "photographic",
        warnings: [],
        provenance: {
          prompt: { canonical_construct: "medium", lowering_action: "native", source_value: "photographic" },
        },
      },
    });
  });

  it("requires an adapter when emit=true", () => {
    const noAdapters = ctx();
    delete noAdapters.adapters;
    const res = runCompileGeneration(noAdapters, { composition: { base: "base_t" }, provider: "demo", emit: true });
    expect(res).toEqual({ error: "unknown_provider", detail: { provider: "demo", adapter: "missing" } });
  });
});
