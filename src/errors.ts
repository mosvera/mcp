// SPDX-License-Identifier: Apache-2.0
//
// Closed MCP error taxonomy and runtime-error mapping (design spec D2/§7).
// Tool handlers return these as data; nothing is thrown across the MCP
// boundary.

import { ResolutionError } from "@mosvera/runtime";
import type { JsonObject, ValidationIssue } from "@mosvera/runtime";
import type { ToolError, ToolErrorCode } from "./types.ts";

export function toolError(error: ToolErrorCode, detail?: JsonObject | string): ToolError {
  return detail === undefined ? { error } : { error, detail };
}

export function invalidDocument(errors: ValidationIssue[]): ToolError {
  return { error: "invalid_document", detail: { errors } as unknown as JsonObject };
}

/** Map a runtime ResolutionError.kind straight onto the taxonomy. */
export function mapResolutionError(e: ResolutionError): ToolError {
  return { error: e.kind };
}

export function isResolutionError(e: unknown): e is ResolutionError {
  return e instanceof ResolutionError;
}
