#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Mosvera MCP stdio bootstrap. The server exposes a small, user-facing
// aesthetic tool surface over the TypeScript runtime and a local project
// registry.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { buildContext, parseCliOptions, SERVER_VERSION } from "./context.ts";
import {
  documentKinds,
  runCompileDesignTokens,
  runCompileProviderPayload,
  runDeleteRegistryDocument,
  runDraftAesthetic,
  runExportAestheticPack,
  runGetRegistryDocument,
  runImportAestheticPack,
  runListAesthetics,
  runPreviewAestheticImport,
  runResolveAesthetic,
  runSaveAesthetic,
  runSaveRegistryDocument,
  runServerStatus,
  runValidateAestheticPack,
  runValidateDocument,
  runValidateRegistry,
  runWriteMergeStrategies,
} from "./tools/aesthetic.ts";
import type { ToolContext } from "./types.ts";

const docArg = z.union([z.string(), z.record(z.any())]);
const packSourceArg = {
  pack: docArg.optional(),
  path: z.string().optional(),
};
const strategiesArg = z.record(z.object({
  strategy: z.enum(["replace", "append", "merge_by"]),
  key: z.string().optional(),
}));
const criticalityArg = z.record(z.enum(["required", "optional"]));
const documentKindArg = z.enum(documentKinds);
const registryDocumentKindArg = z.enum(documentKinds);
const packConflictArg = z.enum(["auto_rename", "fail", "replace"]);
const packStrategyConflictArg = z.enum(["fail", "replace"]);
const outputSchema = z.object({ ok: z.boolean(), message: z.string() }).passthrough();

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const destructiveAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export { buildContext };

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({
    name: "mosvera-mcp",
    title: "Mosvera MCP",
    version: SERVER_VERSION,
  });

  server.registerTool(
    "server_status",
    {
      title: "Server Status",
      description: "Show the active Mosvera registry path, write mode, versions, document counts, and diagnostics.",
      inputSchema: {},
      outputSchema,
      annotations: readAnnotations,
    },
    async () => runServerStatus(ctx),
  );

  server.registerTool(
    "list_aesthetics",
    {
      title: "List Aesthetics",
      description: "List named aesthetics available in the active local Mosvera registry.",
      inputSchema: {},
      outputSchema,
      annotations: readAnnotations,
    },
    async () => runListAesthetics(ctx),
  );

  server.registerTool(
    "get_registry_document",
    {
      title: "Get Registry Document",
      description: "Fetch a template, modifier, palette, composition, or capability manifest from the active registry.",
      inputSchema: { kind: registryDocumentKindArg, id: z.string() },
      outputSchema,
      annotations: readAnnotations,
    },
    async (args) => runGetRegistryDocument(ctx, args),
  );

  server.registerTool(
    "validate_document",
    {
      title: "Validate Document",
      description: "Validate one Mosvera document against a schema kind. Invalid documents return valid=false, not a thrown protocol error.",
      inputSchema: { document: docArg, kind: documentKindArg },
      outputSchema,
      annotations: readAnnotations,
    },
    async (args) => runValidateDocument(ctx, args),
  );

  server.registerTool(
    "validate_registry",
    {
      title: "Validate Registry",
      description: "Validate the active local registry and return Mosvera diagnostics.",
      inputSchema: {},
      outputSchema,
      annotations: readAnnotations,
    },
    async () => runValidateRegistry(ctx),
  );

  server.registerTool(
    "validate_aesthetic_pack",
    {
      title: "Validate Aesthetic Pack",
      description: "Validate an inline or local .mosvera.json aesthetic pack.",
      inputSchema: packSourceArg,
      outputSchema,
      annotations: readAnnotations,
    },
    async (args) => runValidateAestheticPack(ctx, args as Parameters<typeof runValidateAestheticPack>[1]),
  );

  server.registerTool(
    "preview_aesthetic_import",
    {
      title: "Preview Aesthetic Import",
      description: "Preview importing an aesthetic pack into the active local registry without writing files.",
      inputSchema: {
        ...packSourceArg,
        conflict_strategy: packConflictArg.optional(),
        strategy_conflict: packStrategyConflictArg.optional(),
      },
      outputSchema,
      annotations: readAnnotations,
    },
    async (args) => runPreviewAestheticImport(ctx, args as Parameters<typeof runPreviewAestheticImport>[1]),
  );

  server.registerTool(
    "export_aesthetic_pack",
    {
      title: "Export Aesthetic Pack",
      description: "Export a named aesthetic and its registry dependencies as a portable .mosvera.json pack.",
      inputSchema: {
        aesthetic: z.string(),
        id: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
      },
      outputSchema,
      annotations: readAnnotations,
    },
    async (args) => runExportAestheticPack(ctx, args as Parameters<typeof runExportAestheticPack>[1]),
  );

  server.registerTool(
    "resolve_aesthetic",
    {
      title: "Resolve Aesthetic",
      description: "Resolve a named or inline aesthetic composition into the canonical Mosvera model.",
      inputSchema: { aesthetic: z.union([z.string(), z.record(z.any())]), merge_strategies: strategiesArg.optional() },
      outputSchema,
      annotations: readAnnotations,
    },
    async (args) => runResolveAesthetic(ctx, args as Parameters<typeof runResolveAesthetic>[1]),
  );

  server.registerTool(
    "compile_design_tokens",
    {
      title: "Compile Design Tokens",
      description: "Compile a named/inline aesthetic or canonical model into portable design tokens and CSS variables.",
      inputSchema: {
        aesthetic: z.union([z.string(), z.record(z.any())]).optional(),
        canonical: docArg.optional(),
        merge_strategies: strategiesArg.optional(),
        css_prefix: z.string().optional(),
        preserve_unknown: z.boolean().optional(),
      },
      outputSchema,
      annotations: readAnnotations,
    },
    async (args) => runCompileDesignTokens(ctx, args as Parameters<typeof runCompileDesignTokens>[1]),
  );

  server.registerTool(
    "compile_provider_payload",
    {
      title: "Compile Provider Payload",
      description: "Advanced: deterministically compile a named/inline aesthetic into a provider payload. No provider HTTP call is made.",
      inputSchema: {
        aesthetic: z.union([z.string(), z.record(z.any())]),
        provider: z.string(),
        criticality: criticalityArg.optional(),
        merge_strategies: strategiesArg.optional(),
      },
      outputSchema,
      annotations: readAnnotations,
    },
    async (args) => runCompileProviderPayload(ctx, args as Parameters<typeof runCompileProviderPayload>[1]),
  );

  server.registerTool(
    "draft_aesthetic",
    {
      title: "Draft Aesthetic",
      description: "Draft a valid composition document without saving it to disk.",
      inputSchema: {
        id: z.string(),
        base: z.string(),
        modifiers: z.array(z.string()).optional(),
        overrides: docArg.optional(),
      },
      outputSchema,
      annotations: readAnnotations,
    },
    async (args) => runDraftAesthetic(ctx, args as Parameters<typeof runDraftAesthetic>[1]),
  );

  if (ctx.registryWritable && !ctx.readOnlyMode) {
    server.registerTool(
      "save_aesthetic",
      {
        title: "Save Aesthetic",
        description: "Create or update a named aesthetic composition in the active local registry.",
        inputSchema: {
          id: z.string(),
          base: z.string(),
          modifiers: z.array(z.string()).optional(),
          overrides: docArg.optional(),
        },
        outputSchema,
        annotations: writeAnnotations,
      },
      async (args) => runSaveAesthetic(ctx, args as Parameters<typeof runSaveAesthetic>[1]),
    );

    server.registerTool(
      "save_registry_document",
      {
        title: "Save Registry Document",
        description: "Advanced: create or update a template, modifier, palette, composition, or capability manifest in the active local registry.",
        inputSchema: { kind: registryDocumentKindArg, document: docArg },
        outputSchema,
        annotations: writeAnnotations,
      },
      async (args) => runSaveRegistryDocument(ctx, args),
    );

    server.registerTool(
      "delete_registry_document",
      {
        title: "Delete Registry Document",
        description: "Delete a registry document from the active local registry.",
        inputSchema: { kind: registryDocumentKindArg, id: z.string() },
        outputSchema,
        annotations: destructiveAnnotations,
      },
      async (args) => runDeleteRegistryDocument(ctx, args),
    );

    server.registerTool(
      "write_merge_strategies",
      {
        title: "Write Merge Strategies",
        description: "Advanced: replace the active registry's merge-strategies.json with deterministic JSON.",
        inputSchema: { merge_strategies: strategiesArg },
        outputSchema,
        annotations: writeAnnotations,
      },
      async (args) => runWriteMergeStrategies(ctx, args as Parameters<typeof runWriteMergeStrategies>[1]),
    );

    server.registerTool(
      "import_aesthetic_pack",
      {
        title: "Import Aesthetic Pack",
        description: "Import an inline or local .mosvera.json aesthetic pack into the active local registry.",
        inputSchema: {
          ...packSourceArg,
          conflict_strategy: packConflictArg.optional(),
          strategy_conflict: packStrategyConflictArg.optional(),
        },
        outputSchema,
        annotations: writeAnnotations,
      },
      async (args) => runImportAestheticPack(ctx, args as Parameters<typeof runImportAestheticPack>[1]),
    );
  }

  return server;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const ctx = buildContext(options);
  const server = createServer(ctx);
  await server.connect(new StdioServerTransport());
}

function isDirectRun(): boolean {
  if (!process.argv[1]) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(process.argv[1]) === realpathSync(modulePath);
  } catch {
    return process.argv[1] === modulePath;
  }
}

if (isDirectRun()) {
  main().catch((e) => {
    process.stderr.write(`mosvera-mcp failed to start: ${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(1);
  });
}
