// SPDX-License-Identifier: Apache-2.0
//
// Wire contract for the MCP SDK v2 migration. Pinned on SDK v1
// first; every later stage must keep these assertions green, and any change
// to the pinned receipts is listed in CHANGES.md and the migration narrative.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  NET_GUARD,
  REPO_ROOT,
  makeSandbox,
  outboundAttempts,
  sortTools,
  startLoopback,
  startStdio,
  stopStdio,
  stripGeneratorMarkers,
  type Sandbox,
  type StdioHandle,
} from "./harness.ts";

const FIXTURES = join(REPO_ROOT, "test", "fixtures", "wire");
const WRITE = process.env.WRITE_WIRE_FIXTURES === "1";

const ALL_ADAPTERS = [
  "openai-gpt-image-1",
  "bfl-flux-2-pro",
  "sdxl-replicate",
  "heygen-avatar-video",
  "google-gemini-image",
  "google-veo-video",
  "runway-gen4-image",
  "runway-gen45-video",
  "elevenlabs-tts",
  "adobe-firefly-image",
  "meshy-text-to-3d",
];

function fixture(name: string, actual: unknown): unknown {
  const path = join(FIXTURES, name);
  if (WRITE) writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
  return JSON.parse(readFileSync(path, "utf8"));
}

type Result = {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function result(msg: { result?: Record<string, unknown> }): Result {
  expect(msg.result, JSON.stringify(msg)).toBeDefined();
  return msg.result as Result;
}

function text(r: Result): string {
  return r.content?.find((c) => c.type === "text")?.text ?? "";
}

/**
 * An input-validation failure is a tool result with isError=true and the
 * offending path in the text; it never executes the handler. Stage-agnostic.
 */
function expectValidationFailure(msg: { result?: Record<string, unknown> }, path: string): void {
  const r = result(msg);
  expect(r.isError).toBe(true);
  expect(r.structuredContent).toBeUndefined();
  expect(text(r)).toMatch(/Input validation error|Invalid arguments/);
  expect(text(r)).toContain(path);
}

/**
 * Calling a tool that is not registered (an unknown name, or a write tool in
 * read-only mode). SDK v1 answered with an isError tool result carrying
 * "MCP error -32602" in its text; SDK v2 answers with a JSON-RPC error,
 * code -32602. Nothing executes either way. Documented in CHANGES.md.
 */
function expectUnknownTool(msg: { result?: Record<string, unknown>; error?: { code: number; message: string } }, name: string): void {
  expect(msg.result).toBeUndefined();
  expect(msg.error).toEqual({ code: -32602, message: `Tool ${name} not found` });
}

describe("net guard", () => {
  it("refuses and logs a non-loopback connect from a guarded process", () => {
    const sb = makeSandbox();
    const probe = spawnSync(
      process.execPath,
      [
        "--require",
        NET_GUARD,
        "-e",
        "require('net').connect(443,'192.0.2.1').on('error',e=>{console.log(e.message);process.exit(0)})",
      ],
      { env: { NETGUARD_LOG: sb.netLog }, encoding: "utf8", timeout: 10_000 },
    );
    expect(probe.stdout).toContain("net-guard: blocked outbound connect to 192.0.2.1:443");
    expect(outboundAttempts(sb)).toEqual(["192.0.2.1:443"]);
  });
});

describe("stdio wire contract", () => {
  let sb: Sandbox;
  let h: StdioHandle;

  beforeAll(async () => {
    sb = makeSandbox();
    h = startStdio(sb);
    await h.peer.initialize();
  }, 30_000);

  afterAll(async () => {
    await stopStdio(h);
  });

  it("initialize advertises the same server identity and capabilities", async () => {
    const init = h.peer.received.find((m) => m.id === 1)!;
    expect(init.result).toMatchObject({
      serverInfo: { name: "mosvera-mcp", title: "Mosvera MCP", version: "0.1.10" },
      capabilities: { tools: { listChanged: true } },
    });
  });

  it("loads every provider adapter at startup and says so on stderr", () => {
    expect(h.stderr()).toContain(`provider adapters loaded: ${ALL_ADAPTERS.join(", ")}`);
    expect(h.stderr()).not.toContain("optional provider adapters not installed");
  });

  it("tools/list matches the pinned v1 receipt (writable registry)", async () => {
    const list = await h.peer.request("tools/list", {});
    const actual = sortTools(list.result!);
    const pinned = fixture("tools-list.json", actual);
    expect(stripGeneratorMarkers(actual)).toEqual(stripGeneratorMarkers(pinned));
  });

  it("differs from the v1 receipt only by the documented generator markers", async () => {
    const list = await h.peer.request("tools/list", {});
    const tools = sortTools(list.result!);
    for (const tool of tools) {
      expect(tool.execution).toBeUndefined();
      expect((tool.inputSchema as Record<string, unknown>).$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect((tool.outputSchema as Record<string, unknown>).$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect((tool.outputSchema as Record<string, unknown>).additionalProperties).toEqual({});
    }
  });

  it("union args accept both arms and reject anything else before the handler", async () => {
    const named = result(await h.peer.callTool("resolve_aesthetic", { aesthetic: "quiet-editorial" }));
    expect(named.isError).not.toBe(true);
    const inline = result(
      await h.peer.callTool("resolve_aesthetic", {
        aesthetic: { schema_version: "0.1", kind: "composition", id: "wire-inline", base: "quiet-editorial-base" },
      }),
    );
    expect(inline.isError).not.toBe(true);
    expect(inline.structuredContent?.canonical).toBeTruthy();
    expectValidationFailure(await h.peer.callTool("resolve_aesthetic", { aesthetic: 42 }), "aesthetic");
  });

  it("record args accept string-keyed maps and validate nested values", async () => {
    const good = result(
      await h.peer.callTool("compile_design_tokens", {
        aesthetic: "quiet-editorial",
        merge_strategies: { "voice.keywords": { strategy: "append" } },
      }),
    );
    expect(good.isError).not.toBe(true);
    expectValidationFailure(
      await h.peer.callTool("compile_design_tokens", {
        aesthetic: "quiet-editorial",
        merge_strategies: { "voice.keywords": { strategy: "shuffle" } },
      }),
      "strategy",
    );
    expectValidationFailure(
      await h.peer.callTool("compile_provider_payload", {
        aesthetic: "quiet-editorial",
        provider: "openai-gpt-image-1",
        criticality: { palette: "sometimes" },
      }),
      "criticality",
    );
  });

  it("unknown argument keys are stripped, not refused (top level and nested)", async () => {
    const top = result(
      await h.peer.callTool("get_registry_document", { kind: "composition", id: "quiet-editorial", unexpected: true }),
    );
    expect(top.isError).not.toBe(true);
    const nested = result(
      await h.peer.callTool("compile_design_tokens", {
        aesthetic: "quiet-editorial",
        merge_strategies: { "voice.keywords": { strategy: "append", unexpected: 1 } },
      }),
    );
    expect(nested.isError).not.toBe(true);
  });

  it("enum and type mismatches are validation failures with the path named", async () => {
    expectValidationFailure(await h.peer.callTool("get_registry_document", { kind: "nope", id: "x" }), "kind");
    expectValidationFailure(await h.peer.callTool("get_registry_document", { kind: "composition" }), "id");
  });

  it("structuredContent passes through the passthrough outputSchema untouched", async () => {
    const tokens = result(await h.peer.callTool("compile_design_tokens", { aesthetic: "quiet-editorial" }));
    expect(tokens.structuredContent).toMatchObject({
      ok: true,
      css_variables: { "--mosvera-palette-accent": "#bd5838" },
    });
    const failure = result(await h.peer.callTool("resolve_aesthetic", { aesthetic: "missing-aesthetic" }));
    expect(failure.isError).toBe(true);
    expect(failure.structuredContent).toMatchObject({ ok: false, error: "unknown_reference" });
  });

  it("provider_options pass through to every adapter, compile-only, byte-stable", async () => {
    const payloads: Record<string, unknown> = {};
    for (const provider of ALL_ADAPTERS) {
      const r = result(
        await h.peer.callTool("compile_provider_payload", {
          aesthetic: "claymation-playful-builder",
          provider,
          provider_options: {
            prompt: "Wire fixture prompt.",
            script: "Wire fixture script.",
            voice_id: "voice-fixture",
            avatar_id: "avatar-fixture",
            wire_unknown_option: "kept-or-ignored-by-adapter",
          },
        }),
      );
      payloads[provider] = { isError: r.isError === true, structuredContent: r.structuredContent };
    }
    expect(payloads).toEqual(fixture("provider-payloads.json", payloads));
    const tts = payloads["elevenlabs-tts"] as { structuredContent: Record<string, unknown> };
    expect(JSON.stringify(tts.structuredContent)).toContain("Wire fixture script.");
  });

  it("an unknown provider is a structured tool failure, not a protocol error", async () => {
    const r = result(
      await h.peer.callTool("compile_provider_payload", { aesthetic: "quiet-editorial", provider: "no-such-provider" }),
    );
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.ok).toBe(false);
  });

  it("calling an unregistered tool is refused without side effects", async () => {
    expectUnknownTool(await h.peer.callTool("no_such_tool", {}), "no_such_tool");
  });

  it("survives a cancelled in-flight request and keeps serving", async () => {
    const pending = h.peer.requestWithId(9001, "tools/call", {
      name: "export_aesthetic_pack",
      arguments: { aesthetic: "quiet-editorial" },
    }).catch(() => undefined);
    h.peer.notify("notifications/cancelled", { requestId: 9001, reason: "wire fixture cancel" });
    await Promise.race([pending, new Promise((r) => setTimeout(r, 1_000))]);
    const ping = await h.peer.request("ping", {});
    expect(ping.result).toEqual({});
    expect(h.proc.exitCode).toBeNull();
  });

  it("made no outbound network attempt for any call above", () => {
    expect(outboundAttempts(sb)).toEqual([]);
  });

  it("wrote only inside the throwaway registry", () => {
    expect(existsSync(join(sb.dir, "config"))).toBe(false);
    expect(readdirSync(sb.registry).length).toBeGreaterThan(0);
  });
});

describe("read-only mode", () => {
  it("tools/list matches the pinned read-only receipt and write tools are unregistered", async () => {
    const sb = makeSandbox();
    const h = startStdio(sb, ["--registry", sb.registry, "--read-only"]);
    try {
      await h.peer.initialize();
      const list = await h.peer.request("tools/list", {});
      const actual = sortTools(list.result!);
      const pinned = fixture("tools-list.read-only.json", actual);
      expect(stripGeneratorMarkers(actual)).toEqual(stripGeneratorMarkers(pinned));
      for (const name of ["save_aesthetic", "save_registry_document", "delete_registry_document", "write_merge_strategies", "import_aesthetic_pack"]) {
        expectUnknownTool(await h.peer.callTool(name, { id: "x", base: "y", kind: "palette", document: {}, merge_strategies: {} }), name);
      }
      expect(outboundAttempts(sb)).toEqual([]);
    } finally {
      await stopStdio(h);
    }
  }, 30_000);
});

describe("disposal", () => {
  it("the stdio process exits cleanly when the client closes stdin", async () => {
    const sb = makeSandbox();
    const h = startStdio(sb);
    await h.peer.initialize();
    h.proc.stdin!.end();
    const code = await Promise.race([h.exited, new Promise((r) => setTimeout(() => r("timeout"), 5_000))]);
    if (code === "timeout") h.proc.kill("SIGKILL");
    expect(code).toBe(0);
  }, 30_000);

  it("the in-process loopback server serves the same tools/list and closes", async () => {
    const sb = makeSandbox();
    const loop = await startLoopback(sb.registry);
    try {
      await loop.peer.initialize();
      const list = await loop.peer.request("tools/list", {});
      const pinned = JSON.parse(readFileSync(join(FIXTURES, "tools-list.json"), "utf8"));
      expect(stripGeneratorMarkers(sortTools(list.result!))).toEqual(stripGeneratorMarkers(pinned));
    } finally {
      await loop.close();
    }
  });
});
