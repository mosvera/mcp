// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

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

function text(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  return content?.find((item) => item.type === "text")?.text ?? "";
}

function fileNames(directory: string): string[] {
  return readdirSync(directory).sort();
}

function toolNames(tools: Tool[]): string[] {
  return tools.map((tool) => tool.name).sort();
}

describe("MCP stdio surface", () => {
  it("lists annotated tools with output schemas and calls the main read path", async () => {
    const registry = mkdtempSync(join(tmpdir(), "mosvera-mcp-stdio-"));
    await withClient(["--registry", registry], async (client) => {
      const tools = await client.listTools();
      const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
      const readTools = [
        "compile_design_tokens",
        "compile_provider_payload",
        "draft_aesthetic",
        "export_aesthetic_pack",
        "get_registry_document",
        "list_aesthetics",
        "preview_aesthetic_import",
        "resolve_aesthetic",
        "server_status",
        "validate_aesthetic_pack",
        "validate_document",
        "validate_registry",
      ];
      const writeTools = [
        "import_aesthetic_pack",
        "save_aesthetic",
        "save_registry_document",
        "write_merge_strategies",
      ];
      const destructiveTools = ["delete_registry_document"];

      expect(toolNames(tools.tools)).toEqual([...readTools, ...writeTools, ...destructiveTools].sort());

      for (const tool of tools.tools) {
        expect(tool.inputSchema).toBeTruthy();
        expect(tool.outputSchema).toBeTruthy();
        expect(tool.annotations).toBeTruthy();
        expect(tool.annotations?.openWorldHint).toBe(false);
      }

      for (const name of readTools) {
        expect(byName.get(name)?.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
        });
      }
      for (const name of writeTools) {
        expect(byName.get(name)?.annotations).toMatchObject({
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        });
      }
      for (const name of destructiveTools) {
        expect(byName.get(name)?.annotations).toMatchObject({
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        });
      }

      const status = await client.callTool({ name: "server_status", arguments: {} });
      expect(status.structuredContent).toMatchObject({ ok: true, registry_writable: true });
      expect(text(status)).toContain("Write tools enabled: yes");

      const list = await client.callTool({ name: "list_aesthetics", arguments: {} });
      expect((list.structuredContent as Record<string, unknown>).aesthetics).toHaveLength(4);

      const resolved = await client.callTool({ name: "resolve_aesthetic", arguments: { aesthetic: "quiet-editorial" } });
      expect((resolved.structuredContent as Record<string, unknown>).canonical).toMatchObject({ layout: { radius: "6px" } });
      expect(text(resolved)).toContain("Canonical model");
      expect(text(resolved)).toContain("Voice headline:");

      const tokens = await client.callTool({ name: "compile_design_tokens", arguments: { aesthetic: "quiet-editorial" } });
      expect((tokens.structuredContent as Record<string, unknown>).css_variables).toMatchObject({ "--mosvera-palette-accent": "#bd5838" });
      expect(text(tokens)).toContain("--mosvera-palette-accent: #bd5838;");

      const elevenLabs = await client.callTool({
        name: "compile_provider_payload",
        arguments: {
          aesthetic: "claymation-playful-builder",
          provider: "elevenlabs-tts",
          provider_options: {
            voice_id: "voice-demo",
            script: "Welcome to Mosvera. This is a compile-only smoke test.",
          },
        },
      });
      expect(elevenLabs.isError).not.toBe(true);
      expect(text(elevenLabs)).toContain("Payload JSON");
      expect(text(elevenLabs)).toContain('"text": "Welcome to Mosvera. This is a compile-only smoke test."');

      const pack = await client.callTool({ name: "export_aesthetic_pack", arguments: { aesthetic: "quiet-editorial" } });
      expect(text(pack)).toContain("Pack JSON");
      expect(text(pack)).toContain("Suggested filename: quiet-editorial.mosvera.json");
      const packDocument = (pack.structuredContent as Record<string, unknown>).pack;
      const validated = await client.callTool({ name: "validate_aesthetic_pack", arguments: { pack: packDocument } });
      expect(validated.structuredContent).toMatchObject({ ok: true, valid: true });
    });
  });

  it("saves deterministic JSON and reloads the registry over stdio", async () => {
    const registry = mkdtempSync(join(tmpdir(), "mosvera-mcp-stdio-save-"));
    await withClient(["--registry", registry], async (client) => {
      const before = fileNames(registry);
      const saved = await client.callTool({
        name: "save_aesthetic",
        arguments: {
          id: "smoke-test-editorial",
          base: "quiet-editorial-base",
          overrides: {
            palette: { accent: "#475569" },
            voice: { headline: "Executive smoke test." },
          },
        },
      });

      expect(saved.isError).not.toBe(true);
      expect(text(saved)).toContain("Composition document");
      expect(text(saved)).toContain("Saved aesthetic \"smoke-test-editorial\" to the local registry.");
      expect(saved.structuredContent).toMatchObject({
        ok: true,
        kind: "composition",
        id: "smoke-test-editorial",
      });

      const documentPath = join(registry, "composition.smoke-test-editorial.json");
      expect(readFileSync(documentPath, "utf8")).toBe(
        `{
  "$schema": "https://mosvera.io/schema/0.1/composition",
  "base": "quiet-editorial-base",
  "id": "smoke-test-editorial",
  "overrides": {
    "palette": {
      "accent": "#475569"
    },
    "voice": {
      "headline": "Executive smoke test."
    }
  }
}
`,
      );

      const list = await client.callTool({ name: "list_aesthetics", arguments: {} });
      expect((list.structuredContent as Record<string, unknown>).aesthetics).toContainEqual({
        kind: "composition",
        id: "smoke-test-editorial",
        base: "quiet-editorial-base",
      });

      const resolved = await client.callTool({
        name: "compile_design_tokens",
        arguments: { aesthetic: "smoke-test-editorial" },
      });
      expect((resolved.structuredContent as Record<string, unknown>).css_variables).toMatchObject({
        "--mosvera-palette-accent": "#475569",
        "--mosvera-voice-headline": "Executive smoke test.",
      });

      expect(fileNames(registry)).toEqual([...before, "composition.smoke-test-editorial.json"].sort());
    });
  });

  it("previews and imports aesthetic packs from inline JSON and local paths over stdio", async () => {
    const registry = mkdtempSync(join(tmpdir(), "mosvera-mcp-stdio-pack-"));
    await withClient(["--registry", registry], async (client) => {
      const exported = await client.callTool({
        name: "export_aesthetic_pack",
        arguments: { aesthetic: "quiet-editorial", name: "Quiet Editorial" },
      });
      expect(exported.isError).not.toBe(true);
      const pack = (exported.structuredContent as Record<string, unknown>).pack;

      const inlinePreview = await client.callTool({
        name: "preview_aesthetic_import",
        arguments: { pack },
      });
      expect(inlinePreview.structuredContent).toMatchObject({
        ok: true,
        plan: {
          valid: true,
          installed_entrypoint: { kind: "composition", id: "quiet-editorial-imported" },
        },
      });
      expect(text(inlinePreview)).toContain("Installed entrypoint: composition:quiet-editorial-imported");
      expect(text(inlinePreview)).toContain("No files were written.");

      const importPath = join(registry, "quiet-editorial.mosvera.json");
      writeFileSync(importPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
      const pathPreview = await client.callTool({
        name: "preview_aesthetic_import",
        arguments: { path: importPath },
      });
      expect(pathPreview.structuredContent).toMatchObject({ ok: true, source: "path", path: importPath });

      const imported = await client.callTool({
        name: "import_aesthetic_pack",
        arguments: { path: importPath },
      });
      expect(imported.isError).not.toBe(true);
      expect(text(imported)).toContain("Imported aesthetic pack \"quiet-editorial\"");
      expect(text(imported)).toContain("Installed entrypoint: composition:quiet-editorial-imported");
      expect(imported.structuredContent).toMatchObject({
        ok: true,
        entrypoint: { kind: "composition", id: "quiet-editorial-imported" },
      });

      const importedDocument = readFileSync(join(registry, "composition.quiet-editorial-imported.json"), "utf8");
      expect(importedDocument).toContain('"base": "quiet-editorial-base-imported"');

      const list = await client.callTool({ name: "list_aesthetics", arguments: {} });
      expect((list.structuredContent as Record<string, unknown>).aesthetics).toContainEqual({
        kind: "composition",
        id: "quiet-editorial-imported",
        base: "quiet-editorial-base-imported",
      });
    });
  });

  it("returns structured isError failures for operational errors over stdio", async () => {
    const registry = mkdtempSync(join(tmpdir(), "mosvera-mcp-stdio-errors-"));
    await withClient(["--registry", registry], async (client) => {
      const invalidSave = await client.callTool({
        name: "save_aesthetic",
        arguments: { id: "../bad", base: "quiet-editorial-base" },
      });
      expect(invalidSave.isError).toBe(true);
      expect(invalidSave.structuredContent).toMatchObject({
        ok: false,
        error: "unsafe_filename",
      });

      const missingReference = await client.callTool({
        name: "resolve_aesthetic",
        arguments: { aesthetic: "missing-aesthetic" },
      });
      expect(missingReference.isError).toBe(true);
      expect(missingReference.structuredContent).toMatchObject({
        ok: false,
        error: "unknown_reference",
      });

      const unsafePackPath = await client.callTool({
        name: "preview_aesthetic_import",
        arguments: { path: join(registry, ".hidden.mosvera.json") },
      });
      expect(unsafePackPath.isError).toBe(true);
      expect(unsafePackPath.structuredContent).toMatchObject({
        ok: false,
        error: "unsafe_filename",
      });
    });
  });

  it("keeps read tools non-mutating over stdio", async () => {
    const registry = mkdtempSync(join(tmpdir(), "mosvera-mcp-stdio-readonly-effects-"));
    await withClient(["--registry", registry], async (client) => {
      const before = fileNames(registry);

      await client.callTool({ name: "server_status", arguments: {} });
      await client.callTool({ name: "list_aesthetics", arguments: {} });
      await client.callTool({ name: "validate_registry", arguments: {} });
      await client.callTool({ name: "resolve_aesthetic", arguments: { aesthetic: "quiet-editorial" } });
      await client.callTool({ name: "compile_design_tokens", arguments: { aesthetic: "quiet-editorial" } });
      await client.callTool({ name: "export_aesthetic_pack", arguments: { aesthetic: "quiet-editorial" } });

      expect(fileNames(registry)).toEqual(before);
    });
  });

  it("does not register persistence tools in read-only mode", async () => {
    await withClient(["--read-only"], async (client) => {
      const tools = await client.listTools();
      const names = toolNames(tools.tools);
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
      const names = toolNames(tools.tools);
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
