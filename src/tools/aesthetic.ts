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
  exportAestheticPack,
  getRegistryDocument,
  importAestheticPack,
  listRegistryEntries,
  parse,
  previewAestheticPackImport,
  resolveAesthetic,
  toCssVariables,
  validateAestheticPack,
  type AestheticPack,
  type AestheticPackConflictStrategy,
  type AestheticPackImportPlan,
  type AestheticPackStrategyConflict,
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
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { registryDiagnostics, reloadContext, SERVER_VERSION } from "../context.ts";
import { fail, ok, type ToolFailure } from "../mcp-result.ts";
import { deleteCapabilityManifest, ProjectWriteError, saveCapabilityManifest } from "../project-writes.ts";
import { isResolutionError, mapResolutionError } from "../errors.ts";
import type { ToolContext, ToolErrorCode } from "../types.ts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type ProviderEmitOptions = {
  criticality?: Record<string, Criticality>;
  providerOptions?: Record<string, unknown>;
};

export const registryKinds = ["template", "modifier", "palette", "composition"] as const;
export const documentKinds = ["template", "modifier", "palette", "composition", "capability-manifest"] as const;
const PACK_EXT = /\.mosvera\.json$/i;

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

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
      out[key] = stable(child);
    }
    return out;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stable(value));
}

function stablePretty(value: unknown): string {
  return JSON.stringify(stable(value), null, 2);
}

function jsonPreview(label: string, value: unknown, limit = 3000): string {
  const pretty = stablePretty(value);
  const suffix = pretty.length > limit ? `\n...truncated ${pretty.length - limit} character${pretty.length - limit === 1 ? "" : "s"}` : "";
  return `${label}:\n\`\`\`json\n${pretty.slice(0, limit)}${suffix}\n\`\`\``;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function canonicalHighlights(canonical: JsonObject): string[] {
  const lines: string[] = [];
  const sections = Object.keys(canonical).sort();
  lines.push(`Sections: ${sections.length > 0 ? sections.join(", ") : "none"}.`);

  const voice = objectValue(canonical.voice);
  const headline = stringValue(voice?.headline);
  const body = stringValue(voice?.body);
  if (headline !== undefined) lines.push(`Voice headline: ${headline}`);
  if (body !== undefined) lines.push(`Voice body: ${body}`);

  const palette = objectValue(canonical.palette);
  if (palette !== undefined) {
    const keys = ["accent", "accent_2", "background", "surface", "ink", "muted"];
    const values = keys
      .map((key) => [key, stringValue(palette[key])] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
      .map(([key, value]) => `${key} ${value}`);
    if (values.length > 0) lines.push(`Palette: ${values.join(", ")}.`);
  }

  const typography = objectValue(canonical.typography);
  if (typography !== undefined) {
    const values = ["display", "body", "mono", "scale"]
      .map((key) => [key, stringValue(typography[key])] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
      .map(([key, value]) => `${key} ${value}`);
    if (values.length > 0) lines.push(`Typography: ${values.join(", ")}.`);
  }

  const layout = objectValue(canonical.layout);
  if (layout !== undefined) {
    const values = ["density", "radius", "max_width", "shadow"]
      .map((key) => [key, stringValue(layout[key])] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
      .map(([key, value]) => `${key} ${value}`);
    if (values.length > 0) lines.push(`Layout: ${values.join(", ")}.`);
  }

  const imagery = objectValue(canonical.imagery);
  if (imagery !== undefined) {
    const treatment = stringValue(imagery.treatment);
    const src = stringValue(imagery.src);
    const alt = stringValue(imagery.alt);
    const values = [
      treatment !== undefined ? `treatment ${treatment}` : undefined,
      src !== undefined ? `src ${src}` : undefined,
      alt !== undefined ? `alt ${alt}` : undefined,
    ].filter((value): value is string => value !== undefined);
    if (values.length > 0) lines.push(`Imagery: ${values.join(", ")}.`);
  }

  const motion = objectValue(canonical.motion);
  if (motion !== undefined) {
    const values = ["pace", "duration"]
      .map((key) => [key, stringValue(motion[key])] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
      .map(([key, value]) => `${key} ${value}`);
    if (values.length > 0) lines.push(`Motion: ${values.join(", ")}.`);
  }

  return lines;
}

function packCounts(pack: AestheticPack): Record<string, number> {
  return {
    templates: Object.keys(pack.documents.templates ?? {}).length,
    palettes: Object.keys(pack.documents.palettes ?? {}).length,
    modifiers: Object.keys(pack.documents.modifiers ?? {}).length,
    compositions: Object.keys(pack.documents.compositions ?? {}).length,
  };
}

function packSummary(pack: AestheticPack): string[] {
  const counts = packCounts(pack);
  return [
    `Pack id: ${pack.id}`,
    `Entrypoint: ${pack.entrypoint.kind}:${pack.entrypoint.id}`,
    `Documents: ${counts.templates} templates, ${counts.palettes} palettes, ${counts.modifiers} modifiers, ${counts.compositions} compositions.`,
  ];
}

function importPlanSummary(plan: AestheticPackImportPlan): string[] {
  const actionCounts = plan.operations.reduce<Record<string, number>>((acc, op) => {
    acc[op.action] = (acc[op.action] ?? 0) + 1;
    return acc;
  }, {});
  const actions = Object.entries(actionCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([action, count]) => `${count} ${action}`)
    .join(", ");
  const renamed = plan.operations
    .filter((op) => op.action === "rename")
    .map((op) => `${op.kind}:${op.original_id} -> ${op.id}`);
  return [
    `Pack id: ${plan.pack_id}`,
    `Entrypoint: ${plan.entrypoint.kind}:${plan.entrypoint.id}`,
    `Installed entrypoint: ${plan.installed_entrypoint.kind}:${plan.installed_entrypoint.id}`,
    `Operations: ${plan.operations.length}${actions.length > 0 ? ` (${actions})` : ""}.`,
    renamed.length > 0 ? `Renames:\n${renamed.map((line) => `- ${line}`).join("\n")}` : "Renames: none.",
    `Diagnostics: ${plan.diagnostics.length}.`,
  ];
}

function warningSummary(warnings: Array<{ construct?: unknown; action?: unknown }> | undefined): string {
  if (warnings === undefined || warnings.length === 0) return "Warnings: none.";
  const visible = warnings.slice(0, 12).map((warning) => {
    const construct = typeof warning.construct === "string" ? warning.construct : "unknown";
    const action = typeof warning.action === "string" ? warning.action : "warning";
    return `- ${construct}: ${action}`;
  });
  const remaining = warnings.length - visible.length;
  return `Warnings (${warnings.length}):\n${visible.join("\n")}${remaining > 0 ? `\n...and ${remaining} more warning${remaining === 1 ? "" : "s"}.` : ""}`;
}

function validatePackPath(path: string): ToolFailure | undefined {
  if (/^https?:\/\//i.test(path)) {
    return { error: "unsafe_filename", message: "Aesthetic pack imports only accept local .mosvera.json files, not URLs." };
  }
  const file = basename(path);
  if (file.startsWith(".") || !PACK_EXT.test(file)) {
    return { error: "unsafe_filename", message: "Aesthetic pack paths must end with .mosvera.json and must not be dotfiles." };
  }
  return undefined;
}

function readPackSource(args: { pack?: object | string; path?: string }): { pack: JsonObject; source: "inline" | "path"; path?: string } | ToolFailure {
  if ((args.pack === undefined && args.path === undefined) || (args.pack !== undefined && args.path !== undefined)) {
    return { error: "invalid_document", message: "Provide exactly one aesthetic pack source: inline pack JSON or a local .mosvera.json path." };
  }
  if (args.path !== undefined) {
    const pathFailure = validatePackPath(args.path);
    if (pathFailure !== undefined) return pathFailure;
    const parsed = parseDocument(readFileSync(args.path, "utf8"));
    if (maybeFail(parsed)) return parsed;
    return { pack: parsed, source: "path", path: args.path };
  }
  const parsed = parseDocument(args.pack!);
  if (maybeFail(parsed)) return parsed;
  return { pack: parsed, source: "inline" };
}

function readValidPackSource(args: { pack?: object | string; path?: string }, ctx: ToolContext): { pack: AestheticPack; source: "inline" | "path"; path?: string } | ToolFailure {
  const source = readPackSource(args);
  if (maybeFail(source)) return source;
  const diagnostics = validateAestheticPack(source.pack, { validator: ctx.validator });
  if (diagnostics.length > 0) {
    return {
      error: "schema_failure",
      message: "Aesthetic pack failed validation.",
      detail: { valid: false, diagnostics },
    };
  }
  return source as unknown as { pack: AestheticPack; source: "inline" | "path"; path?: string };
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

function topCssVariables(cssVariables: Record<string, string>, limit = 40): string {
  const entries = Object.entries(cssVariables).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "No CSS variables were produced.";
  const visible = entries.slice(0, limit).map(([key, value]) => `${key}: ${value};`);
  const remaining = entries.length - visible.length;
  return `${visible.join("\n")}${remaining > 0 ? `\n...and ${remaining} more CSS variable${remaining === 1 ? "" : "s"}.` : ""}`;
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
  const message = [
    "Mosvera MCP server is ready.",
    `Registry: ${ctx.registryDir}`,
    `Writable: ${ctx.registryWritable ? "yes" : "no"}`,
    `Read-only mode: ${ctx.readOnlyMode ? "yes" : "no"}`,
    `Write tools enabled: ${ctx.registryWritable && !ctx.readOnlyMode ? "yes" : "no"}`,
    `Loaded: ${counts.compositions} aesthetics, ${counts.templates} templates, ${counts.modifiers} modifiers, ${counts.palettes} palettes, ${counts.manifests} manifests.`,
  ].join("\n");
  return ok(message, {
    registry_path: ctx.registryDir,
    registry_writable: ctx.registryWritable,
    read_only_mode: ctx.readOnlyMode,
    write_tools_enabled: ctx.registryWritable && !ctx.readOnlyMode,
    fallback_registry: ctx.fallbackRegistry,
    fallback_reason: ctx.fallbackReason,
    versions: {
      mcp: SERVER_VERSION,
      runtime: "0.1.2",
    },
    counts,
    diagnostics,
  });
}

export function runListAesthetics(ctx: ToolContext): CallToolResult {
  const aesthetics = listRegistryEntries(ctx.project.registry, "composition");
  const label = aesthetics.length === 1 ? "aesthetic" : "aesthetics";
  const summary =
    aesthetics.length === 0 ? "Found 0 aesthetics." :
    `Found ${aesthetics.length} ${label}:\n${aesthetics.map((entry) => `- ${entry.id}${entry.base !== undefined ? ` (base: ${entry.base})` : ""}`).join("\n")}`;
  return ok(summary, { aesthetics });
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

export function runValidateAestheticPack(
  ctx: ToolContext,
  args: { pack?: object | string; path?: string },
): CallToolResult {
  const source = readPackSource(args);
  if (maybeFail(source)) return toolFail(source);
  const diagnostics = validateAestheticPack(source.pack, { validator: ctx.validator });
  return ok(diagnostics.length === 0 ? "Aesthetic pack is valid." : "Aesthetic pack is invalid.", {
    valid: diagnostics.length === 0,
    source: source.source,
    path: source.path,
    diagnostics,
  });
}

export function runPreviewAestheticImport(
  ctx: ToolContext,
  args: {
    pack?: object | string;
    path?: string;
    conflict_strategy?: AestheticPackConflictStrategy;
    strategy_conflict?: AestheticPackStrategyConflict;
  },
): CallToolResult {
  const source = readValidPackSource(args, ctx);
  if (maybeFail(source)) return toolFail(source);
  const options: Parameters<typeof previewAestheticPackImport>[2] = {
    validator: ctx.validator,
    strategies: ctx.project.strategies,
  };
  if (args.conflict_strategy !== undefined) options.conflictStrategy = args.conflict_strategy;
  if (args.strategy_conflict !== undefined) options.strategyConflict = args.strategy_conflict;
  const plan = previewAestheticPackImport(source.pack, ctx.project.registry, options);
  if (!plan.valid) return fail("invalid_document", "Aesthetic pack import preview found blocking diagnostics.", { plan });
  const message = [
    "Previewed aesthetic pack import.",
    ...importPlanSummary(plan),
    "No files were written.",
  ].join("\n");
  return ok(message, { source: source.source, path: source.path, plan });
}

export function runExportAestheticPack(
  ctx: ToolContext,
  args: { aesthetic: string; id?: string; name?: string; description?: string },
): CallToolResult {
  try {
    const options: { id?: string; name?: string; description?: string; strategies?: MergeStrategies } = {
      strategies: ctx.project.strategies,
    };
    if (args.id !== undefined) options.id = args.id;
    if (args.name !== undefined) options.name = args.name;
    if (args.description !== undefined) options.description = args.description;
    const pack = exportAestheticPack(args.aesthetic, ctx.project.registry, options);
    const suggested_filename = `${pack.id}.mosvera.json`;
    const message = [
      `Exported aesthetic pack "${pack.id}".`,
      `Suggested filename: ${suggested_filename}`,
      ...packSummary(pack),
      jsonPreview("Pack JSON", pack, 8000),
    ].join("\n");
    return ok(message, { pack, suggested_filename });
  } catch (e) {
    return toolFail(runtimeError(e));
  }
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
  const message = [
    `Resolved aesthetic "${id}".`,
    ...canonicalHighlights(resolved.canonical),
    jsonPreview("Canonical model", resolved.canonical, 5000),
  ].join("\n");
  return ok(message, { canonical: resolved.canonical });
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
  const sections = Object.keys(tokens).sort();
  const message = [
    "Compiled portable design tokens.",
    `Token sections: ${sections.length > 0 ? sections.join(", ") : "none"}.`,
    "CSS variables:",
    topCssVariables(css_variables),
  ].join("\n");
  return ok(message, { source: resolved.source, canonical: resolved.canonical, tokens, css_variables });
}

export function runCompileProviderPayload(
  ctx: ToolContext,
  args: {
    aesthetic: string | object;
    provider: string;
    provider_options?: Record<string, unknown>;
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
    const message = [
      `Provider "${args.provider}" cannot satisfy required construct "${compiled.construct}".`,
      `Error: ${compiled.error}`,
      jsonPreview("Canonical model", resolved.canonical, 2500),
    ].join("\n");
    return ok(message, {
      status: "error",
      error: compiled.error,
      construct: compiled.construct,
      canonical: resolved.canonical,
    });
  }

  if (adapter === undefined) {
    const message = [
      `Compiled provider contract for "${args.provider}".`,
      "No provider adapter is installed, so no payload was emitted.",
      warningSummary(compiled.warnings),
    ].join("\n");
    return ok(message, {
      status: "compiled",
      provider: args.provider,
      warnings: compiled.warnings,
      canonical: resolved.canonical,
    });
  }

  try {
    const emitOptions: ProviderEmitOptions = { criticality: args.criticality ?? {} };
    if (args.provider_options !== undefined) emitOptions.providerOptions = args.provider_options;
    const emission = adapter.emit(resolved.canonical, emitOptions as Parameters<typeof adapter.emit>[1]);
    const message = [
      `Compiled deterministic provider payload for "${args.provider}".`,
      emission.prompt.length > 0 ? `Prompt: ${emission.prompt}` : "Prompt: none.",
      warningSummary(emission.warnings),
      jsonPreview("Payload JSON", emission.payload, 5000),
    ].join("\n");
    return ok(message, {
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
    const message = [
      `Drafted aesthetic "${args.id}".`,
      "This draft was not saved to the local registry. Use save_aesthetic to persist it.",
      jsonPreview("Composition document", document, 4000),
    ].join("\n");
    return ok(message, { kind: "composition", id: args.id, document });
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
    const message = [
      `Saved aesthetic "${args.id}" to the local registry.`,
      `Registry: ${ctx.registryDir}`,
      jsonPreview("Composition document", document, 4000),
    ].join("\n");
    return ok(message, { kind: "composition", id: args.id, document });
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
      const message = [
        `Saved capability manifest "${manifest.provider}".`,
        `Registry: ${ctx.registryDir}`,
        jsonPreview("Capability manifest", document, 4000),
      ].join("\n");
      return ok(message, { kind: args.kind, id: manifest.provider, document });
    }

    saveProjectDocument(ctx.registryDir, args.kind, document);
    reloadContext(ctx);
    const message = [
      `Saved ${args.kind} "${String(document.id)}".`,
      `Registry: ${ctx.registryDir}`,
      jsonPreview("Registry document", document, 4000),
    ].join("\n");
    return ok(message, { kind: args.kind, id: document.id, document });
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

export function runImportAestheticPack(
  ctx: ToolContext,
  args: {
    pack?: object | string;
    path?: string;
    conflict_strategy?: AestheticPackConflictStrategy;
    strategy_conflict?: AestheticPackStrategyConflict;
  },
): CallToolResult {
  const disabled = writeDisabled(ctx);
  if (disabled !== undefined) return toolFail(disabled);
  const source = readValidPackSource(args, ctx);
  if (maybeFail(source)) return toolFail(source);

  try {
    const options: Parameters<typeof importAestheticPack>[2] = {
      validator: ctx.validator,
      strategies: ctx.project.strategies,
    };
    if (args.conflict_strategy !== undefined) options.conflictStrategy = args.conflict_strategy;
    if (args.strategy_conflict !== undefined) options.strategyConflict = args.strategy_conflict;
    const result = importAestheticPack(ctx.project.registry, source.pack, options);
    if (!result.plan.valid) return fail("invalid_document", "Aesthetic pack import found blocking diagnostics.", { plan: result.plan });

    for (const kind of registryKinds) {
      const collection =
        kind === "template" ? result.pack.documents.templates :
        kind === "modifier" ? result.pack.documents.modifiers :
        kind === "palette" ? result.pack.documents.palettes :
        result.pack.documents.compositions;
      for (const document of Object.values(collection ?? {})) {
        saveProjectDocument(ctx.registryDir, kind, document);
      }
    }
    if (stableStringify(result.strategies) !== stableStringify(ctx.project.strategies)) {
      writeMergeStrategies(ctx.registryDir, result.strategies);
    }
    reloadContext(ctx);
    const message = [
      `Imported aesthetic pack "${result.pack.id}".`,
      `Registry: ${ctx.registryDir}`,
      ...importPlanSummary(result.plan),
    ].join("\n");
    return ok(message, {
      source: source.source,
      path: source.path,
      plan: result.plan,
      entrypoint: result.plan.installed_entrypoint,
    });
  } catch (e) {
    return toolFail(runtimeError(e));
  }
}

export function errorCodeFromResult(result: CallToolResult): ToolErrorCode | undefined {
  const code = result.structuredContent?.error;
  return typeof code === "string" ? code as ToolErrorCode : undefined;
}
