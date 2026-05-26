// SPDX-License-Identifier: Apache-2.0
//
// compile_generation tool handler. Resolves a composition, then runs the
// MEP-0003 compilation contract (compile) against a provider capability
// manifest sourced inline, from the loaded registry, or from an injected Phase
// 4 adapter. When emit=true and an adapter is available, returns the
// deterministic provider payload emission. No provider HTTP call is made.

import {
  compile,
  parse,
  resolveComposition,
  type CapabilityManifest,
  type Criticality,
  type JsonObject,
  type MergeStrategies,
  type Registry,
} from "@mosvera/runtime";
import { EmissionError } from "@mosvera/provider-base";
import { invalidDocument, isResolutionError, mapResolutionError, toolError } from "../errors.ts";
import { collectMissingReferences } from "../registry/preflight.ts";
import { composeStrategies, mergeRegistry } from "../registry/strategies.ts";
import type { CompileResultMcp, ToolContext } from "../types.ts";

type ProviderEmitOptions = {
  criticality?: Record<string, Criticality>;
  providerOptions?: Record<string, unknown>;
};

export interface CompileArgs {
  composition: object | string;
  provider: string;
  registry?: Registry;
  manifest?: CapabilityManifest;
  criticality?: Record<string, Criticality>;
  merge_strategies?: MergeStrategies;
  provider_options?: Record<string, unknown>;
  emit?: boolean;
}

export function runCompileGeneration(ctx: ToolContext, args: CompileArgs): CompileResultMcp {
  let composition: JsonObject;
  try {
    composition = parse(args.composition);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return invalidDocument([{ path: "", message: `parse error: ${message}` }]);
  }

  const cv = ctx.validator.validate(composition, "composition");
  if (!cv.valid) return invalidDocument(cv.errors);

  const registry = mergeRegistry(ctx.project.registry, args.registry);
  const missing = collectMissingReferences(composition, registry);
  if (missing.length > 0) {
    return toolError("unknown_reference", { missing } as unknown as JsonObject);
  }

  const adapter = ctx.adapters?.[args.provider];
  const manifest = args.manifest ?? ctx.project.manifests[args.provider] ?? adapter?.manifest();
  if (manifest === undefined) {
    return toolError("unknown_provider", { provider: args.provider } as unknown as JsonObject);
  }
  const mv = ctx.validator.validate(manifest, "capability-manifest");
  if (!mv.valid) return invalidDocument(mv.errors);

  const strategies = composeStrategies(ctx.baseStrategies, args.merge_strategies);
  let canonical: JsonObject;
  try {
    canonical = resolveComposition(composition, registry, strategies);
  } catch (e) {
    if (isResolutionError(e)) return mapResolutionError(e);
    throw e;
  }

  const result = compile(canonical, manifest, args.criticality ?? {});
  if (result.status === "error") {
    return { status: "error", error: result.error, construct: result.construct, canonical };
  }

  if (args.emit === true) {
    if (adapter === undefined) {
      return toolError("unknown_provider", { provider: args.provider, adapter: "missing" } as unknown as JsonObject);
    }
    try {
      const emitOptions: ProviderEmitOptions = { criticality: args.criticality ?? {} };
      if (args.provider_options !== undefined) emitOptions.providerOptions = args.provider_options;
      return {
        status: "compiled",
        canonical,
        emission: adapter.emit(canonical, emitOptions as Parameters<typeof adapter.emit>[1]),
      };
    } catch (e) {
      if (e instanceof EmissionError) {
        return { status: "error", error: e.error, construct: e.construct, canonical };
      }
      throw e;
    }
  }

  return { status: "compiled", warnings: result.warnings, canonical };
}
