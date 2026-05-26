// SPDX-License-Identifier: Apache-2.0
//
// @mosvera/mcp public surface: the pure tool handlers and the project loader.
// server.ts wires these onto the MCP SDK over stdio.

export { loadRegistry } from "./registry/loader.ts";
export { composeStrategies, mergeRegistry } from "./registry/strategies.ts";
export { collectMissingReferences } from "./registry/preflight.ts";
export { runListTemplates } from "./tools/list-templates.ts";
export { runResolveComposition } from "./tools/resolve-composition.ts";
export { runGetPalette } from "./tools/get-palette.ts";
export { runValidateSchema } from "./tools/validate-schema.ts";
export { runCompileGeneration } from "./tools/compile-generation.ts";
export { buildContext, createServer } from "./server.ts";
export type { LoadedProject, ToolContext } from "./types.ts";
