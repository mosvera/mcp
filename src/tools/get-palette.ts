// SPDX-License-Identifier: Apache-2.0
//
// get_palette tool handler. Returns the named palette as stored (schema-
// validated). Palette $extends resolution is deferred at v0.1 (design spec
// D4): if the palette declares $extends, the response carries
// inheritance_unresolved:true so a consumer is never silently misled.

import type { JsonObject, Registry } from "@mosvera/runtime";
import { invalidDocument, toolError } from "../errors.ts";
import { mergeRegistry } from "../registry/strategies.ts";
import type { ToolContext, ToolError } from "../types.ts";

export interface GetPaletteArgs {
  name: string;
  registry?: Registry;
}

export type GetPaletteResult =
  | { palette: JsonObject; inheritance_unresolved?: true }
  | ToolError;

export function runGetPalette(ctx: ToolContext, args: GetPaletteArgs): GetPaletteResult {
  const reg: Registry = mergeRegistry(ctx.project.registry, args.registry);
  const palettes = reg.palettes ?? {};
  if (!(args.name in palettes)) {
    return toolError("unknown_reference", { name: args.name } as unknown as JsonObject);
  }
  const palette = palettes[args.name] as JsonObject;

  const res = ctx.validator.validate(palette, "palette");
  if (!res.valid) return invalidDocument(res.errors);

  if (typeof palette["$extends"] === "string") {
    return { palette, inheritance_unresolved: true };
  }
  return { palette };
}
