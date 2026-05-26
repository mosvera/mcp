// SPDX-License-Identifier: Apache-2.0
//
// Pure helpers for composing merge strategies (three-layer model, MEP-0001 +
// design spec D3) and merging an inline registry override over the loaded one
// (per-collection, by id).

import type { MergeStrategies, Registry } from "@mosvera/runtime";

/** Compose strategy layers; later layers win per field name. Skips undefined. */
export function composeStrategies(...layers: Array<MergeStrategies | undefined>): MergeStrategies {
  const out: MergeStrategies = {};
  for (const layer of layers) {
    if (layer === undefined) continue;
    for (const [k, v] of Object.entries(layer)) out[k] = v;
  }
  return out;
}

/**
 * Merge an inline registry override over a base registry, per collection, by
 * id. Inline entries shadow same-id base entries; new ids are added; base ids
 * not mentioned remain. Not a wholesale replacement.
 */
export function mergeRegistry(base: Registry, inline: Registry | undefined): Registry {
  if (inline === undefined) return base;
  return {
    templates: { ...(base.templates ?? {}), ...(inline.templates ?? {}) },
    modifiers: { ...(base.modifiers ?? {}), ...(inline.modifiers ?? {}) },
    palettes: { ...(base.palettes ?? {}), ...(inline.palettes ?? {}) },
  };
}
