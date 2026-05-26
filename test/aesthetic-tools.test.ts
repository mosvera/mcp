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
  runCompileProviderPayload,
  runSaveAesthetic,
  runServerStatus,
  runValidateAestheticPack,
  runValidateRegistry,
} from "../src/tools/aesthetic.ts";
import type { EmissionResult, ProviderAdapter, ProviderPayload } from "@mosvera/provider-base";

function tempRegistry(): string {
  return mkdtempSync(join(tmpdir(), "mosvera-mcp-registry-"));
}

function text(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.find((item) => item.type === "text")?.text ?? "";
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

  it("passes provider_options into compile_provider_payload without executing providers", () => {
    const ctx = buildContext({ registryDir: tempRegistry() });
    const adapter: ProviderAdapter = {
      id: "heygen-avatar-video",
      version: "0.1.1",
      manifest: () => ({
        provider: "heygen-avatar-video",
        adapter_version: "0.1.1",
        constructs: {
          palette: { lowering_action: "approximate", note: "folded into avatar-video direction" },
          voice: { lowering_action: "approximate", note: "folded into avatar-video direction" },
        },
      }),
      emit(canonical, options): EmissionResult {
        const providerOptions = options as { providerOptions?: Record<string, unknown> } | undefined;
        return {
          payload: {
            avatar_id: providerOptions?.providerOptions?.avatar_id,
            script: providerOptions?.providerOptions?.script,
            headline: ((canonical.voice as Record<string, unknown> | undefined)?.headline ?? ""),
          },
          prompt: "heygen demo",
          warnings: [],
          provenance: {},
        };
      },
      async execute(payload: ProviderPayload) {
        throw new Error(`MCP must not execute provider payloads: ${JSON.stringify(payload)}`);
      },
    };
    ctx.adapters = { ...(ctx.adapters ?? {}), [adapter.id]: adapter };

    const result = runCompileProviderPayload(ctx, {
      aesthetic: "claymation-playful-builder",
      provider: "heygen-avatar-video",
      provider_options: {
        avatar_id: "avatar-demo",
        script: "Welcome to Mosvera.",
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.emission).toMatchObject({
      payload: {
        avatar_id: "avatar-demo",
        script: "Welcome to Mosvera.",
        headline: "Same architecture, built out of warm clay and shop light.",
      },
    });
    expect(text(result)).toContain("Payload JSON");
    expect(text(result)).toContain('"avatar_id": "avatar-demo"');
  });

  it("compiles the Phase 6L provider ids through injected adapters without executing providers", () => {
    const ctx = buildContext({ registryDir: tempRegistry() });
    const providerIds = [
      "google-gemini-image",
      "google-veo-video",
      "runway-gen4-image",
      "runway-gen45-video",
      "elevenlabs-tts",
      "adobe-firefly-image",
      "meshy-text-to-3d",
    ];
    ctx.adapters = {
      ...(ctx.adapters ?? {}),
      ...Object.fromEntries(
        providerIds.map((id) => [
          id,
          {
            id,
            version: "0.1.2",
            manifest: () => ({
              provider: id,
              adapter_version: "0.1.2",
              constructs: {
                palette: { lowering_action: "approximate", note: "folded into provider prompt" },
                voice: { lowering_action: "approximate", note: "folded into provider prompt" },
              },
            }),
            emit(canonical, options): EmissionResult {
              const providerOptions = options as { providerOptions?: Record<string, unknown> } | undefined;
              return {
                payload: {
                  provider: id,
                  option_keys: Object.keys(providerOptions?.providerOptions ?? {}).sort(),
                  headline: ((canonical.voice as Record<string, unknown> | undefined)?.headline ?? ""),
                },
                prompt: `${id} demo`,
                warnings: [],
                provenance: {},
              };
            },
            async execute(payload: ProviderPayload) {
              throw new Error(`MCP must not execute provider payloads: ${JSON.stringify(payload)}`);
            },
          } satisfies ProviderAdapter,
        ]),
      ),
    };

    for (const provider of providerIds) {
      const result = runCompileProviderPayload(ctx, {
        aesthetic: "claymation-playful-builder",
        provider,
        provider_options: { duration: 5, voice_id: "voice-demo" },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent?.emission).toMatchObject({
        payload: {
          provider,
          option_keys: ["duration", "voice_id"],
          headline: "Same architecture, built out of warm clay and shop light.",
        },
      });
    }
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
    expect(text(result)).toContain("Composition document");
    expect(text(result)).toContain("Saved aesthetic \"executive-editorial\" to the local registry.");
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
    expect(text(exported)).toContain("Pack JSON");
    expect(text(exported)).toContain("quiet-editorial.mosvera.json");
    const pack = exported.structuredContent?.pack as object;

    expect(runValidateAestheticPack(ctx, { pack }).structuredContent).toMatchObject({ valid: true });
    const preview = runPreviewAestheticImport(ctx, { pack });
    expect(text(preview)).toContain("Installed entrypoint: composition:quiet-editorial-imported");
    expect(text(preview)).toContain("No files were written.");
    expect(preview.structuredContent?.plan).toMatchObject({
      valid: true,
      installed_entrypoint: { kind: "composition", id: "quiet-editorial-imported" },
    });

    const importPath = join(dir, "quiet-editorial.mosvera.json");
    writeFileSync(importPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
    const imported = runImportAestheticPack(ctx, { path: importPath });
    expect(imported.isError).not.toBe(true);
    expect(text(imported)).toContain("Imported aesthetic pack \"quiet-editorial\"");
    expect(text(imported)).toContain("Installed entrypoint: composition:quiet-editorial-imported");
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
