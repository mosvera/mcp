// SPDX-License-Identifier: Apache-2.0
//
// Reference pre-flight (design spec D2). Verifies a composition's base and
// modifier references exist in the effective registry BEFORE the runtime is
// called, so the MCP layer can emit a clear `unknown_reference` instead of the
// runtime's `reference_cycle` (which it raises for missing refs). This keeps
// the runtime's normative error set untouched.

import type { JsonObject, Registry } from "@mosvera/runtime";

/** Returns the list of references in `composition` absent from `registry`. */
export function collectMissingReferences(composition: JsonObject, registry: Registry): string[] {
  const templates = registry.templates ?? {};
  const modifiers = registry.modifiers ?? {};
  const missing: string[] = [];

  const base = composition["base"];
  if (typeof base !== "string") {
    missing.push("<missing base>");
  } else if (!(base in templates)) {
    missing.push(base);
  }

  const mods = composition["modifiers"];
  if (Array.isArray(mods)) {
    for (const ref of mods) {
      if (typeof ref === "string" && !(ref in modifiers)) missing.push(ref);
    }
  }
  return missing;
}
