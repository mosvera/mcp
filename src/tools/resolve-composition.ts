// SPDX-License-Identifier: Apache-2.0
//
// resolve_composition tool handler. Validates the composition, builds effective
// merge strategies (schema+project base, then inline override), pre-flights
// references (emitting unknown_reference before the runtime), then resolves to
// the canonical model. Runtime ResolutionErrors map to the taxonomy.

import {
  parse,
  resolveComposition,
  type JsonObject,
  type MergeStrategies,
  type Registry,
} from "@mosvera/runtime";
import { invalidDocument, isResolutionError, mapResolutionError, toolError } from "../errors.ts";
import { collectMissingReferences } from "../registry/preflight.ts";
import { composeStrategies, mergeRegistry } from "../registry/strategies.ts";
import type { ResolveResult, ToolContext } from "../types.ts";

export interface ResolveArgs {
  composition: object | string;
  registry?: Registry;
  merge_strategies?: MergeStrategies;
}

export function runResolveComposition(ctx: ToolContext, args: ResolveArgs): ResolveResult {
  let composition: JsonObject;
  try {
    composition = parse(args.composition);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return invalidDocument([{ path: "", message: `parse error: ${message}` }]);
  }

  const v = ctx.validator.validate(composition, "composition");
  if (!v.valid) return invalidDocument(v.errors);

  const registry = mergeRegistry(ctx.project.registry, args.registry);
  const missing = collectMissingReferences(composition, registry);
  if (missing.length > 0) {
    return toolError("unknown_reference", { missing } as unknown as JsonObject);
  }

  const strategies = composeStrategies(ctx.baseStrategies, args.merge_strategies);
  try {
    const canonical = resolveComposition(composition, registry, strategies);
    return { canonical };
  } catch (e) {
    if (isResolutionError(e)) return mapResolutionError(e);
    throw e;
  }
}
