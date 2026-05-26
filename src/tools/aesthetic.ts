// SPDX-License-Identifier: Apache-2.0
//
// User-facing Mosvera MCP tools. These handlers keep the MCP layer thin:
// parse/validate inputs, call @mosvera/runtime, persist through the Node
// boundary where needed, and return MCP-native structured results.

import {
  compile,
  compileDesignTokens,
  composeStrategies,
  createComposition,
  getRegistryDocument,
  listRegistryEntries,
  parse,
  resolveAesthetic,
  toCssVariables,
  type CapabilityManifest,
  type Criticality,
  type DocumentKind,
  type JsonObject,
  type MergeStrategies,
  type RegistryDocument,
  type RegistryKind,
} from "@mosvera/runtime";
import { deleteProjectDocument, RegistryProjectError, saveProjectDocument, writeMergeStrategies } from "@mosvera/runtime/node";
import { EmissionError } from "@mosvera/provider-base";
import { registryDiagnostics, reloadContext, SERVER_VERSION } from "../context.ts";
import { fail, ok, type ToolFailure } from "../mcp-result.ts";
import { deleteCapabilityManifest, ProjectWriteError, saveCapabilityManifest } from "../project-writes.ts";
import { isResolutionError, mapResolutionError } from "../errors.ts";
import type { ToolContext, ToolErrorCode } from "../types.ts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const registryKinds = ["template", "modifier", "palette", "composition"] as const;
export const documentKinds = ["template", "modifier", "palette", "composition", "capability-manifest"] as const;

function parseDocument(source: object | string): JsonObject | ToolFailure {
  try {
    return parse(source);
  } catch (e) {
    return {
      error: "invalid_document",
      message: `Could not parse Mosvera document: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function runtimeError(e: unknown): ToolFailure {
  if (isResolutionError(e)) {
    const mapped = mapResolutionError(e);
    return { error: mapped.error, message: `Could not resolve aesthetic: ${mapped.error}`, detail: mapped.detail };
  }
  if (e instanceof ProjectWriteError) {
    return { error: e.code, message: e.message, detail: e.detail };
  }
  if (e instanceof RegistryProjectError) {
    const first = e.diagnostics[0];
    return {
      error: (first?.code as ToolErrorCode | undefined) ?? "invalid_document",
      message: first?.message ?? e.message,
      detail: { diagnostics: e.diagnostics },
    };
  }
  if (e instanceof EmissionError) {
    return { error: "invalid_document", message: e.message, detail: { construct: e.construct } };
  }
  if (e instanceof Error && e.message.includes("invalid Mosvera reference id")) {
    return { error: "unsafe_filename", message: e.message };
  }
  return {
    error: "invalid_document",
    message: e instanceof Error ? e.message : String(e),
  };
}

function maybeFail<T>(value: T | ToolFailure): value is ToolFailure {
  return typeof value === "object" && value !== null && "error" in value && "message" in value;
}

function strategies(ctx: ToolContext, inline?: MergeStrategies): MergeStrategies {
  return composeStrategies(ctx.baseStrategies, inline);
}

function resolveInput(
  ctx: ToolContext,
  args: { aesthetic?: string | object; canonical?: object | string; merge_strategies?: MergeStrategies },
): { canonical: JsonObject; source: "canonical" | "aesthetic" } | ToolFailure {
  if (args.canonical !== undefined) {
    const canonical = parseDocument(args.canonical);
    if (maybeFail(canonical)) return canonical;
    return { canonical, source: "canonical" };
  }

  const aesthetic = args.aesthetic ?? "quiet-editorial";
  const docOrId = typeof aesthetic === "string" ? aesthetic : parseDocument(aesthetic);
  if (maybeFail(docOrId)) return docOrId;

  try {
    return {
      canonical: resolveAesthetic(docOrId, ctx.project.registry, strategies(ctx, args.merge_strategies)),
      source: "aesthetic",
    };
  } catch (e) {
    return runtimeError(e);
  }
}

function validateForSave(ctx: ToolContext, document: JsonObject, kind: DocumentKind): ToolFailure | undefined {
  const result = ctx.validator.validate(document, kind);
  if (result.valid) return undefined;
  return {
    error: "schema_failure",
    message: `${kind} document failed schema validation`,
    detail: { errors: result.errors },
  };
}

function writeDisabled(ctx: ToolContext): ToolFailure | undefined {
  if (ctx.readOnlyMode) return { error: "write_disabled", message: "This Mosvera MCP server is running in read-only mode." };
  if (!ctx.registryWritable) return { error: "registry_unwritable", message: "The active Mosvera registry is not writable." };
  return undefined;
}

function toolFail(failure: ToolFailure): CallToolResult {
  return fail(failure.error, failure.message, failure.detail);
}

export function runServerStatus(ctx: ToolContext): CallToolResult {
  const diagnostics = [...ctx.loadDiagnostics, ...registryDiagnostics(ctx.project, ctx.validator)];
  const registry = ctx.project.registry;
  const counts = {
    templates: Object.keys(registry.templates ?? {}).length,
    modifiers: Object.keys(registry.modifiers ?? {}).length,
    palettes: Object.keys(registry.palettes ?? {}).length,
    compositions: Object.keys(registry.compositions ?? {}).length,
    manifests: Object.keys(ctx.project.manifests).length,
  };
  return ok("Mosvera MCP server is ready.", {
    registry_path: ctx.registryDir,
    registry_writable: ctx.registryWritable,
    read_only_mode: ctx.readOnlyMode,
    write_tools_enabled: ctx.registryWritable && !ctx.readOnlyMode,
    fallback_registry: ctx.fallbackRegistry,
    fallback_reason: ctx.fallbackReason,
    versions: {
      mcp: SERVER_VERSION,
      runtime: "0.1.1",
    },
    counts,
    diagnostics,
  });
}

export function runListAesthetics(ctx: ToolContext): CallToolResult {
  const aesthetics = listRegistryEntries(ctx.project.registry, "composition");
  return ok(`Found ${aesthetics.length} aesthetic${aesthetics.length === 1 ? "" : "s"}.`, { aesthetics });
}

export function runGetRegistryDocument(
  ctx: ToolContext,
  args: { kind: RegistryKind | "capability-manifest"; id: string },
): CallToolResult {
  if (args.kind === "capability-manifest") {
    const document = ctx.project.manifests[args.id];
    if (document === undefined) {
      return fail("unknown_reference", `No capability manifest named "${args.id}" was found.`, { kind: args.kind, id: args.id });
    }
    return ok(`Loaded capability manifest "${args.id}".`, { kind: args.kind, id: args.id, document });
  }

  const document = getRegistryDocument(ctx.project.registry, args.kind, args.id);
  if (document === undefined) {
    return fail("unknown_reference", `No ${args.kind} named "${args.id}" was found.`, { kind: args.kind, id: args.id });
  }
  return ok(`Loaded ${args.kind} "${args.id}".`, { kind: args.kind, id: args.id, document });
}

export function runValidateDocument(
  ctx: ToolContext,
  args: { document: object | string; kind: DocumentKind },
): CallToolResult {
  const document = parseDocument(args.document);
  if (maybeFail(document)) return toolFail(document);
  const result = ctx.validator.validate(document, args.kind);
  return ok(result.valid ? "Document is valid." : "Document is invalid.", { valid: result.valid, errors: result.errors });
}

export function runValidateRegistry(ctx: ToolContext): CallToolResult {
  const diagnostics = [...ctx.loadDiagnostics, ...registryDiagnostics(ctx.project, ctx.validator)];
  return ok(diagnostics.length === 0 ? "Registry is valid." : `Registry has ${diagnostics.length} diagnostic(s).`, {
    valid: diagnostics.length === 0,
    diagnostics,
  });
}

export function runResolveAesthetic(
  ctx: ToolContext,
  args: { aesthetic: string | object; merge_strategies?: MergeStrategies },
): CallToolResult {
  const input: { aesthetic: string | object; merge_strategies?: MergeStrategies } = { aesthetic: args.aesthetic };
  if (args.merge_strategies !== undefined) input.merge_strategies = args.merge_strategies;
  const resolved = resolveInput(ctx, input);
  if (maybeFail(resolved)) return toolFail(resolved);
  const id = typeof args.aesthetic === "string" ? args.aesthetic : "inline";
  return ok(`Resolved aesthetic "${id}".`, { canonical: resolved.canonical });
}

export function runCompileDesignTokens(
  ctx: ToolContext,
  args: {
    aesthetic?: string | object;
    canonical?: object | string;
    merge_strategies?: MergeStrategies;
    css_prefix?: string;
    preserve_unknown?: boolean;
  },
): CallToolResult {
  const resolved = resolveInput(ctx, args);
  if (maybeFail(resolved)) return toolFail(resolved);
  const tokenOptions: { preserveUnknown?: boolean } = {};
  if (args.preserve_unknown !== undefined) tokenOptions.preserveUnknown = args.preserve_unknown;
  const cssOptions: { prefix?: string } = {};
  if (args.css_prefix !== undefined) cssOptions.prefix = args.css_prefix;
  const tokens = compileDesignTokens(resolved.canonical, tokenOptions);
  const css_variables = toCssVariables(tokens, cssOptions);
  return ok("Compiled portable design tokens.", { source: resolved.source, canonical: resolved.canonical, tokens, css_variables });
}

export function runCompileProviderPayload(
  ctx: ToolContext,
  args: {
    aesthetic: string | object;
    provider: string;
    criticality?: Record<string, Criticality>;
    merge_strategies?: MergeStrategies;
  },
): CallToolResult {
  const input: { aesthetic: string | object; merge_strategies?: MergeStrategies } = { aesthetic: args.aesthetic };
  if (args.merge_strategies !== undefined) input.merge_strategies = args.merge_strategies;
  const resolved = resolveInput(ctx, input);
  if (maybeFail(resolved)) return toolFail(resolved);

  const adapter = ctx.adapters?.[args.provider];
  const manifest = ctx.project.manifests[args.provider] ?? adapter?.manifest();
  if (manifest === undefined) return fail("unknown_provider", `No provider manifest or adapter named "${args.provider}" was found.`, { provider: args.provider });

  const manifestValidation = ctx.validator.validate(manifest, "capability-manifest");
  if (!manifestValidation.valid) {
    return fail("schema_failure", `Provider manifest "${args.provider}" failed schema validation.`, { errors: manifestValidation.errors });
  }

  const compiled = compile(resolved.canonical, manifest as CapabilityManifest, args.criticality ?? {});
  if (compiled.status === "error") {
    return ok(`Provider "${args.provider}" cannot satisfy required construct "${compiled.construct}".`, {
      status: "error",
      error: compiled.error,
      construct: compiled.construct,
      canonical: resolved.canonical,
    });
  }

  if (adapter === undefined) {
    return ok(`Compiled provider contract for "${args.provider}".`, {
      status: "compiled",
      provider: args.provider,
      warnings: compiled.warnings,
      canonical: resolved.canonical,
    });
  }

  try {
    const emission = adapter.emit(resolved.canonical, { criticality: args.criticality ?? {} });
    return ok(`Compiled deterministic provider payload for "${args.provider}".`, {
      status: "compiled",
      provider: args.provider,
      warnings: emission.warnings,
      canonical: resolved.canonical,
      emission,
    });
  } catch (e) {
    const failure = runtimeError(e);
    return toolFail(failure);
  }
}

export function runDraftAesthetic(
  _ctx: ToolContext,
  args: { id: string; base: string; modifiers?: string[]; overrides?: object | string },
): CallToolResult {
  const overrides = args.overrides === undefined ? undefined : parseDocument(args.overrides);
  if (overrides !== undefined && maybeFail(overrides)) return toolFail(overrides);
  try {
    const options: { modifiers?: string[]; overrides?: JsonObject } = {};
    if (args.modifiers !== undefined) options.modifiers = args.modifiers;
    if (overrides !== undefined) options.overrides = overrides;
    const document = createComposition(args.id, args.base, options);
    return ok(`Drafted aesthetic "${args.id}".`, { kind: "composition", id: args.id, document });
  } catch (e) {
    const failure = runtimeError(e);
    return toolFail(failure);
  }
}

export function runSaveAesthetic(
  ctx: ToolContext,
  args: { id: string; base: string; modifiers?: string[]; overrides?: object | string },
): CallToolResult {
  const disabled = writeDisabled(ctx);
  if (disabled !== undefined) return toolFail(disabled);
  const draft = runDraftAesthetic(ctx, args);
  if (draft.isError === true) return draft;
  const document = draft.structuredContent?.document as RegistryDocument | undefined;
  if (document === undefined) return fail("invalid_document", "Drafted aesthetic did not produce a document.");

  const validation = validateForSave(ctx, document, "composition");
  if (validation !== undefined) return toolFail(validation);
  try {
    saveProjectDocument(ctx.registryDir, "composition", document);
    reloadContext(ctx);
    return ok(`Saved aesthetic "${args.id}".`, { kind: "composition", id: args.id, document });
  } catch (e) {
    return toolFail(runtimeError(e));
  }
}

export function runSaveRegistryDocument(
  ctx: ToolContext,
  args: { kind: RegistryKind | "capability-manifest"; document: object | string },
): CallToolResult {
  const disabled = writeDisabled(ctx);
  if (disabled !== undefined) return toolFail(disabled);
  const document = parseDocument(args.document);
  if (maybeFail(document)) return toolFail(document);

  const validation = validateForSave(ctx, document, args.kind);
  if (validation !== undefined) return toolFail(validation);

  try {
    if (args.kind === "capability-manifest") {
      const manifest = document as unknown as CapabilityManifest;
      saveCapabilityManifest(ctx.registryDir, manifest);
      reloadContext(ctx);
      return ok(`Saved capability manifest "${manifest.provider}".`, { kind: args.kind, id: manifest.provider, document });
    }

    saveProjectDocument(ctx.registryDir, args.kind, document);
    reloadContext(ctx);
    return ok(`Saved ${args.kind} "${String(document.id)}".`, { kind: args.kind, id: document.id, document });
  } catch (e) {
    return toolFail(runtimeError(e));
  }
}

export function runDeleteRegistryDocument(
  ctx: ToolContext,
  args: { kind: RegistryKind | "capability-manifest"; id: string },
): CallToolResult {
  const disabled = writeDisabled(ctx);
  if (disabled !== undefined) return toolFail(disabled);
  try {
    if (args.kind === "capability-manifest") {
      const deleted = deleteCapabilityManifest(ctx.registryDir, args.id);
      reloadContext(ctx);
      return ok(deleted ? `Deleted capability manifest "${args.id}".` : `Capability manifest "${args.id}" did not exist.`, {
        kind: args.kind,
        id: args.id,
        deleted,
      });
    }

    deleteProjectDocument(ctx.registryDir, args.kind, args.id);
    reloadContext(ctx);
    return ok(`Deleted ${args.kind} "${args.id}" if it existed.`, { kind: args.kind, id: args.id, deleted: true });
  } catch (e) {
    return toolFail(runtimeError(e));
  }
}

export function runWriteMergeStrategies(
  ctx: ToolContext,
  args: { merge_strategies: MergeStrategies },
): CallToolResult {
  const disabled = writeDisabled(ctx);
  if (disabled !== undefined) return toolFail(disabled);
  try {
    writeMergeStrategies(ctx.registryDir, args.merge_strategies);
    reloadContext(ctx);
    return ok("Saved merge strategies.", { merge_strategies: args.merge_strategies });
  } catch (e) {
    return toolFail(runtimeError(e));
  }
}

export function errorCodeFromResult(result: CallToolResult): ToolErrorCode | undefined {
  const code = result.structuredContent?.error;
  return typeof code === "string" ? code as ToolErrorCode : undefined;
}
