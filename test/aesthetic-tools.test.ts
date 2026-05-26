// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContext } from "../src/context.ts";
import {
  runCompileDesignTokens,
  runDeleteRegistryDocument,
  runExportAestheticPack,
  runImportAestheticPack,
  runListAesthetics,
  runPreviewAestheticImport,
  runSaveAesthetic,
  runServerStatus,
  runValidateAestheticPack,
  runValidateRegistry,
} from "../src/tools/aesthetic.ts";

function tempRegistry(): string {
  return mkdtempSync(join(tmpdir(), "mosvera-mcp-registry-"));
}

describe("aesthetic MCP tool handlers", () => {
  it("seeds the four public demo aesthetics into a writable user registry", () => {
    const ctx = buildContext({ registryDir: tempRegistry() });
    const status = runServerStatus(ctx);
    expect(status.structuredContent).toMatchObject({
      registry_writable: true,
      read_only_mode: false,
      counts: { compositions: 4, templates: 4 },
    });

    const list = runListAesthetics(ctx);
    expect(list.content?.[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("quiet-editorial"),
    });
    expect(list.structuredContent?.aesthetics).toEqual([
      { kind: "composition", id: "cinematic-lab", base: "cinematic-lab-base" },
      { kind: "composition", id: "claymation-playful-builder", base: "claymation-playful-builder-base" },
      { kind: "composition", id: "quiet-editorial", base: "quiet-editorial-base" },
      { kind: "composition", id: "technical-manual", base: "technical-manual-base" },
    ]);
  });

  it("resolves a demo aesthetic into design tokens and CSS variables", () => {
    const ctx = buildContext({ registryDir: tempRegistry() });
    const result = runCompileDesignTokens(ctx, { aesthetic: "claymation-playful-builder" });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.css_variables).toMatchObject({
      "--mosvera-palette-accent": "#d45f3f",
      "--mosvera-layout-radius": "8px",
      "--mosvera-voice-headline": "Same architecture, built out of warm clay and shop light.",
    });
  });

  it("saves deterministic JSON and refreshes the loaded registry", () => {
    const dir = tempRegistry();
    const ctx = buildContext({ registryDir: dir });
    const result = runSaveAesthetic(ctx, {
      id: "executive-editorial",
      base: "quiet-editorial-base",
      modifiers: [],
      overrides: { voice: { headline: "Executive editorial" } },
    });

    expect(result.isError).not.toBe(true);
    expect(runValidateRegistry(ctx).structuredContent).toMatchObject({ valid: true });
    expect(runListAesthetics(ctx).structuredContent?.aesthetics).toContainEqual({
      kind: "composition",
      id: "executive-editorial",
      base: "quiet-editorial-base",
    });
    expect(readFileSync(join(dir, "composition.executive-editorial.json"), "utf8")).toBe(
      `{
  "$schema": "https://mosvera.io/schema/0.1/composition",
  "base": "quiet-editorial-base",
  "id": "executive-editorial",
  "modifiers": [],
  "overrides": {
    "voice": {
      "headline": "Executive editorial"
    }
  }
}
`,
    );

    const deleted = runDeleteRegistryDocument(ctx, { kind: "composition", id: "executive-editorial" });
    expect(deleted.structuredContent).toMatchObject({ deleted: true });
  });

  it("validates, previews, exports, and imports aesthetic packs", () => {
    const dir = tempRegistry();
    const ctx = buildContext({ registryDir: dir });
    const exported = runExportAestheticPack(ctx, { aesthetic: "quiet-editorial" });
    expect(exported.isError).not.toBe(true);
    const pack = exported.structuredContent?.pack as object;

    expect(runValidateAestheticPack(ctx, { pack }).structuredContent).toMatchObject({ valid: true });
    const preview = runPreviewAestheticImport(ctx, { pack });
    expect(preview.structuredContent?.plan).toMatchObject({
      valid: true,
      installed_entrypoint: { kind: "composition", id: "quiet-editorial-imported" },
    });

    const importPath = join(dir, "quiet-editorial.mosvera.json");
    writeFileSync(importPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
    const imported = runImportAestheticPack(ctx, { path: importPath });
    expect(imported.isError).not.toBe(true);
    expect(runListAesthetics(ctx).structuredContent?.aesthetics).toContainEqual({
      kind: "composition",
      id: "quiet-editorial-imported",
      base: "quiet-editorial-base-imported",
    });
    expect(readFileSync(join(dir, "composition.quiet-editorial-imported.json"), "utf8")).toContain(
      '"base": "quiet-editorial-base-imported"',
    );
  });

  it("returns structured MCP errors for unsafe ids", () => {
    const ctx = buildContext({ registryDir: tempRegistry() });
    const result = runSaveAesthetic(ctx, { id: "../bad", base: "quiet-editorial-base" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: "unsafe_filename",
    });
  });

  it("suppresses write mode when requested", () => {
    const ctx = buildContext({ readOnlyMode: true });
    const status = runServerStatus(ctx);
    expect(status.structuredContent).toMatchObject({
      registry_writable: false,
      read_only_mode: true,
      write_tools_enabled: false,
    });
    expect(runListAesthetics(ctx).structuredContent?.aesthetics).toHaveLength(4);
  });
});
