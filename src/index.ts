// SPDX-License-Identifier: Apache-2.0
//
// @mosvera/mcp public surface. The package primarily ships a stdio MCP server,
// but the pure handlers stay exported for tests and host integrations.

export {
  buildContext,
  defaultRegistryDir,
  parseCliOptions,
  registryDiagnostics,
  SERVER_VERSION,
} from "./context.ts";
export { createServer } from "./server.ts";
export {
  runCompileDesignTokens,
  runCompileProviderPayload,
  runDeleteRegistryDocument,
  runDraftAesthetic,
  runGetRegistryDocument,
  runListAesthetics,
  runResolveAesthetic,
  runSaveAesthetic,
  runSaveRegistryDocument,
  runServerStatus,
  runValidateDocument,
  runValidateRegistry,
  runWriteMergeStrategies,
} from "./tools/aesthetic.ts";
export type { LoadedProject, ToolContext } from "./types.ts";
