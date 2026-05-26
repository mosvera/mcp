// SPDX-License-Identifier: Apache-2.0
//
// Small helpers for MCP-native results: a structured payload for clients, plus
// a short text summary for hosts that still render tool output as text.

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolErrorCode } from "./types.ts";

export interface ToolFailure {
  error: ToolErrorCode;
  message: string;
  detail?: unknown;
}

export function ok(message: string, structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { ok: true, message, ...structuredContent },
  };
}

export function fail(error: ToolErrorCode, message: string, detail?: unknown): CallToolResult {
  const structuredContent: Record<string, unknown> = { ok: false, error, message };
  if (detail !== undefined) structuredContent.detail = detail;
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent,
  };
}

export function isFailure(value: unknown): value is ToolFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    "message" in value
  );
}
