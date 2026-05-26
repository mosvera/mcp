// SPDX-License-Identifier: Apache-2.0
//
// MCP-layer shared types. The MCP surface is a thin orchestration layer over
// @mosvera/runtime; these types describe the loaded project and the structured
// results/errors the pure tool handlers return (never thrown across the MCP
// boundary).

import type {
  CapabilityManifest,
  CompileWarning,
  JsonObject,
  MergeStrategies,
  RegistryDiagnostic,
  Registry,
  Validator,
} from "@mosvera/runtime";
import type { EmissionResult, ProviderAdapter } from "@mosvera/provider-base";

/** A loaded aesthetic-system "project" directory. */
export interface LoadedProject {
  registry: Registry;
  manifests: Record<string, CapabilityManifest>;
  /** Project-declared aesthetic-field strategies (merge-strategies.json). */
  strategies: MergeStrategies;
}

/** Per-server context passed to every pure tool handler. */
export interface ToolContext {
  /** Absolute registry directory currently loaded by the server. */
  registryDir: string;
  /** True when persistence tools may write into registryDir. */
  registryWritable: boolean;
  /** True when write tools are intentionally suppressed. */
  readOnlyMode: boolean;
  /** True when the packaged examples were used because the configured registry could not be loaded. */
  fallbackRegistry: boolean;
  fallbackReason?: string;
  loadDiagnostics: RegistryDiagnostic[];
  project: LoadedProject;
  validator: Validator;
  /** schema-derived defaults composed with the project's strategies. */
  baseStrategies: MergeStrategies;
  /** Optional provider adapters for deterministic payload emission. */
  adapters?: Record<string, ProviderAdapter>;
}

/** Closed MCP-layer error taxonomy (D2/D7 in the design spec). */
export type ToolErrorCode =
  | "invalid_document"
  | "unknown_reference"
  | "unknown_provider"
  | "unsafe_filename"
  | "schema_failure"
  | "strategy_conflict"
  | "write_disabled"
  | "registry_unwritable"
  | "inheritance_cycle"
  | "reference_cycle"
  | "multiple_inheritance_unsupported";

export interface ToolError {
  error: ToolErrorCode;
  detail?: JsonObject | string;
}

export type ResolveResult = { canonical: JsonObject } | ToolError;

export interface TemplateSummary {
  name: string;
  extends?: string;
}

export type CompileOk = {
  status: "compiled";
  warnings: CompileWarning[];
  canonical: JsonObject;
};
export type CompileEmitOk = {
  status: "compiled";
  canonical: JsonObject;
  emission: EmissionResult;
};
export type CompileHardError = {
  status: "error";
  error: "required_unsupported";
  construct: string;
  canonical: JsonObject;
};
export type CompileResultMcp = CompileOk | CompileEmitOk | CompileHardError | ToolError;
