// SPDX-License-Identifier: Apache-2.0
//
// list_templates tool handler. Enumerates templates in the effective registry
// (loaded project merged with an optional inline override), reporting each
// template's id and its $extends parent if present.

import type { JsonObject, Registry } from "@mosvera/runtime";
import { mergeRegistry } from "../registry/strategies.ts";
import type { TemplateSummary, ToolContext } from "../types.ts";

export interface ListTemplatesArgs {
  registry?: Registry;
}

export function runListTemplates(ctx: ToolContext, args: ListTemplatesArgs): TemplateSummary[] {
  const reg = mergeRegistry(ctx.project.registry, args.registry);
  const templates = reg.templates ?? {};
  return Object.keys(templates).map((name) => {
    const doc = templates[name] as JsonObject;
    const parent = doc["$extends"];
    return typeof parent === "string" ? { name, extends: parent } : { name };
  });
}
