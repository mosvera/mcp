// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tsx = resolve(root, "node_modules", ".bin", "tsx");
const server = resolve(root, "src", "server.ts");

async function withClient<T>(args: string[], fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "mosvera-mcp-test", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: tsx,
    args: [server, ...args],
    cwd: root,
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

describe("MCP stdio surface", () => {
  it("lists annotated tools with output schemas and calls the main read path", async () => {
    const registry = mkdtempSync(join(tmpdir(), "mosvera-mcp-stdio-"));
    await withClient(["--registry", registry], async (client) => {
      const tools = await client.listTools();
      const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));

      for (const name of [
        "server_status",
        "list_aesthetics",
        "validate_aesthetic_pack",
        "preview_aesthetic_import",
        "export_aesthetic_pack",
        "resolve_aesthetic",
        "compile_design_tokens",
        "save_aesthetic",
        "import_aesthetic_pack",
      ]) {
        expect(byName.get(name)?.inputSchema).toBeTruthy();
        expect(byName.get(name)?.outputSchema).toBeTruthy();
        expect(byName.get(name)?.annotations).toBeTruthy();
      }

      expect(byName.get("server_status")?.annotations?.readOnlyHint).toBe(true);
      expect(byName.get("save_aesthetic")?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      });
      expect(byName.get("delete_registry_document")?.annotations?.destructiveHint).toBe(true);

      const status = await client.callTool({ name: "server_status", arguments: {} });
      expect(status.structuredContent).toMatchObject({ ok: true, registry_writable: true });
      expect((status.content as Array<Record<string, unknown>>)[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("Write tools enabled: yes"),
      });

      const list = await client.callTool({ name: "list_aesthetics", arguments: {} });
      expect((list.structuredContent as Record<string, unknown>).aesthetics).toHaveLength(4);

      const resolved = await client.callTool({ name: "resolve_aesthetic", arguments: { aesthetic: "quiet-editorial" } });
      expect((resolved.structuredContent as Record<string, unknown>).canonical).toMatchObject({ layout: { radius: "6px" } });

      const tokens = await client.callTool({ name: "compile_design_tokens", arguments: { aesthetic: "quiet-editorial" } });
      expect((tokens.structuredContent as Record<string, unknown>).css_variables).toMatchObject({ "--mosvera-palette-accent": "#bd5838" });
      expect((tokens.content as Array<Record<string, unknown>>)[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("--mosvera-palette-accent: #bd5838;"),
      });

      const pack = await client.callTool({ name: "export_aesthetic_pack", arguments: { aesthetic: "quiet-editorial" } });
      const packDocument = (pack.structuredContent as Record<string, unknown>).pack;
      const validated = await client.callTool({ name: "validate_aesthetic_pack", arguments: { pack: packDocument } });
      expect(validated.structuredContent).toMatchObject({ ok: true, valid: true });
    });
  });

  it("does not register persistence tools in read-only mode", async () => {
    await withClient(["--read-only"], async (client) => {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain("draft_aesthetic");
      expect(names).toContain("export_aesthetic_pack");
      expect(names).toContain("preview_aesthetic_import");
      expect(names).not.toContain("save_aesthetic");
      expect(names).not.toContain("save_registry_document");
      expect(names).not.toContain("delete_registry_document");
      expect(names).not.toContain("write_merge_strategies");
      expect(names).not.toContain("import_aesthetic_pack");
    });
  });

  it("treats unresolved MCPB user_config placeholders as unset defaults", async () => {
    await withClient([
      "--registry=${user_config.registry_directory}",
      "--read-only=${user_config.read_only_mode}",
    ], async (client) => {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain("save_aesthetic");

      const status = await client.callTool({ name: "server_status", arguments: {} });
      expect(status.structuredContent).toMatchObject({
        registry_writable: true,
        read_only_mode: false,
        write_tools_enabled: true,
      });
    });
  });
});
