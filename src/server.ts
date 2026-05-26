#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Reference MCP server bootstrap (stdio). Thin wiring only: load the project,
// build the tool context, register each tool with a strict input schema, and
// connect over stdio. All work is delegated to the pure handlers.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createValidator, deriveStrategies } from "@mosvera/runtime";
import { fluxAdapter } from "@mosvera/provider-flux";
import { openaiAdapter } from "@mosvera/provider-openai";
import { sdxlAdapter } from "@mosvera/provider-sdxl";
import { loadRegistry } from "./registry/loader.ts";
import { composeStrategies } from "./registry/strategies.ts";
import { runListTemplates } from "./tools/list-templates.ts";
import { runResolveComposition } from "./tools/resolve-composition.ts";
import { runGetPalette } from "./tools/get-palette.ts";
import { runValidateSchema } from "./tools/validate-schema.ts";
import { runCompileGeneration } from "./tools/compile-generation.ts";
import type { ToolContext } from "./types.ts";

/** Load a project directory into a fully-formed tool context. */
export function buildContext(registryDir: string): ToolContext {
  const validator = createValidator();
  const project = loadRegistry(registryDir, validator);
  const baseStrategies = composeStrategies(deriveStrategies(), project.strategies);
  return {
    project,
    validator,
    baseStrategies,
    adapters: {
      [openaiAdapter.id]: openaiAdapter,
      [fluxAdapter.id]: fluxAdapter,
      [sdxlAdapter.id]: sdxlAdapter,
    },
  };
}

function parseRegistryFlag(argv: string[]): string {
  const i = argv.indexOf("--registry");
  if (i !== -1 && argv[i + 1] !== undefined) return argv[i + 1]!;
  const packaged = fileURLToPath(new URL("./examples/cinematic-editorial", import.meta.url));
  if (existsSync(packaged)) return packaged;
  return fileURLToPath(new URL("../examples/cinematic-editorial", import.meta.url));
}

const docArg = z.union([z.string(), z.record(z.any())]);
const registryArg = z.record(z.any()).optional();
const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "mosvera-mcp", version: "0.1.0" });

  server.registerTool(
    "list_templates",
    { description: "Enumerate templates in the loaded aesthetic-system registry.", inputSchema: { registry: registryArg } },
    async (args) => ok(runListTemplates(ctx, args as never)),
  );

  server.registerTool(
    "resolve_composition",
    {
      description: "Resolve a composition (base + ordered modifiers + overrides) to its canonical aesthetic model.",
      inputSchema: { composition: docArg, registry: registryArg, merge_strategies: z.record(z.any()).optional() },
    },
    async (args) => ok(runResolveComposition(ctx, args as never)),
  );

  server.registerTool(
    "get_palette",
    { description: "Return a named palette's roles. Palette inheritance is unresolved at v0.1 (flagged in the response).", inputSchema: { name: z.string(), registry: registryArg } },
    async (args) => ok(runGetPalette(ctx, args as never)),
  );

  server.registerTool(
    "validate_schema",
    {
      description: "Validate a document against a Mosvera schema kind.",
      inputSchema: { document: docArg, kind: z.enum(["composition", "template", "modifier", "palette", "capability-manifest"]) },
    },
    async (args) => ok(runValidateSchema(ctx.validator, args as never)),
  );

  server.registerTool(
    "compile_generation",
    {
      description: "Resolve a composition then apply the MEP-0003 compilation contract against a provider capability manifest. With emit=true, returns the deterministic provider payload; no provider HTTP call is made.",
      inputSchema: {
        composition: docArg,
        provider: z.string(),
        registry: registryArg,
        manifest: z.record(z.any()).optional(),
        criticality: z.record(z.enum(["required", "optional"])).optional(),
        merge_strategies: z.record(z.any()).optional(),
        emit: z.boolean().optional(),
      },
    },
    async (args) => ok(runCompileGeneration(ctx, args as never)),
  );

  return server;
}

async function main(): Promise<void> {
  const ctx = buildContext(parseRegistryFlag(process.argv.slice(2)));
  const server = createServer(ctx);
  await server.connect(new StdioServerTransport());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    process.stderr.write(`mosvera-mcp failed to start: ${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(1);
  });
}
