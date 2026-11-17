// SPDX-License-Identifier: Apache-2.0
//
// Small helpers for MCP-native results: a structured payload for clients, plus
// a short text summary for hosts that still render tool output as text.

import type { CallToolResult as SdkCallToolResult } from "@modelcontextprotocol/server";
import type { ToolErrorCode } from "./types.ts";

// SDK v2 types `structuredContent` as an opaque value. Mosvera always returns
// a JSON object there, and the exported run* handlers promised that shape on
// SDK v1, so keep it as the public result type.
export type CallToolResult = SdkCallToolResult & { structuredContent?: Record<string, unknown> };

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
