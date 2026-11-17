// SPDX-License-Identifier: Apache-2.0
//
// Wire harness for the MCP SDK v2 migration.
//
// Drives the real mosvera-mcp server with raw newline-delimited JSON-RPC, so
// the receipts do not depend on which SDK client is installed:
//
// - stdio: the real `src/server.ts` entrypoint in a child process, with
//   test/fixtures/net-guard.cjs preloaded, a throwaway HOME/XDG config dir and
//   an explicit temporary registry. No user registry is read or written.
// - loopback: `createServer(ctx)` connected in-process to the SDK stdio server
//   transport over a pair of PassThrough streams.
//
// The SDK import lives in this one file so the v1 -> v2 package swap is a
// single-line change on the harness side.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { buildContext, createServer } from "../../src/server.ts";

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
export const NET_GUARD = join(REPO_ROOT, "test", "fixtures", "net-guard.cjs");
export const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
};

/** Line-framed JSON-RPC peer over any pair of byte streams. */
export class RawPeer {
  private nextId = 1;
  private buffer = "";
  private readonly waiting = new Map<number | string, (msg: JsonRpcMessage) => void>();
  readonly received: JsonRpcMessage[] = [];

  constructor(
    private readonly write: (line: string) => void,
    readable: NodeJS.ReadableStream,
  ) {
    readable.setEncoding?.("utf8");
    readable.on("data", (chunk: string | Buffer) => {
      this.buffer += chunk.toString();
      let nl = this.buffer.indexOf("\n");
      while (nl !== -1) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line.length > 0) this.dispatch(JSON.parse(line) as JsonRpcMessage);
        nl = this.buffer.indexOf("\n");
      }
    });
  }

  private dispatch(msg: JsonRpcMessage): void {
    this.received.push(msg);
    if (msg.id !== undefined && msg.method === undefined) {
      const done = this.waiting.get(msg.id);
      if (done) {
        this.waiting.delete(msg.id);
        done(msg);
      }
    }
  }

  send(msg: Omit<JsonRpcMessage, "jsonrpc">): void {
    this.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
  }

  request(method: string, params?: unknown, timeoutMs = 10_000): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    return this.requestWithId(id, method, params, timeoutMs);
  }

  requestWithId(id: number, method: string, params?: unknown, timeoutMs = 10_000): Promise<JsonRpcMessage> {
    return new Promise((resolveMsg, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`timeout waiting for ${method} #${id}`));
      }, timeoutMs);
      this.waiting.set(id, (msg) => {
        clearTimeout(timer);
        resolveMsg(msg);
      });
      this.send({ id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    this.send({ method, ...(params === undefined ? {} : { params }) });
  }

  async initialize(): Promise<JsonRpcMessage> {
    const init = await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "mosvera-mcp-wire", version: "0.0.0" },
    });
    this.notify("notifications/initialized");
    return init;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<JsonRpcMessage> {
    return this.request("tools/call", { name, arguments: args });
  }
}

export type Sandbox = { dir: string; registry: string; netLog: string };

export function makeSandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "mosvera-wire-"));
  return { dir, registry: join(dir, "registry"), netLog: join(dir, "netguard.log") };
}

export function outboundAttempts(sb: Sandbox): string[] {
  if (!existsSync(sb.netLog)) return [];
  return readFileSync(sb.netLog, "utf8").split("\n").filter(Boolean);
}

export type StdioHandle = { peer: RawPeer; proc: ChildProcess; stderr: () => string; exited: Promise<number | null> };

/** Spawn the real stdio entrypoint with the net guard preloaded. */
export function startStdio(sb: Sandbox, args: string[] = ["--registry", sb.registry]): StdioHandle {
  const env: Record<string, string> = {
    HOME: sb.dir,
    XDG_CONFIG_HOME: join(sb.dir, "config"),
    APPDATA: join(sb.dir, "appdata"),
    NETGUARD_LOG: sb.netLog,
  };
  if (process.env.PATH) env.PATH = process.env.PATH;
  const proc = spawn(process.execPath, ["--require", NET_GUARD, "--import", "tsx", "src/server.ts", ...args], {
    cwd: REPO_ROOT,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let err = "";
  proc.stderr!.on("data", (d) => {
    err += d.toString();
  });
  const exited = new Promise<number | null>((r) => proc.on("exit", (code) => r(code)));
  const peer = new RawPeer((line) => proc.stdin!.write(line), proc.stdout!);
  return { peer, proc, stderr: () => err, exited };
}

export async function stopStdio(handle: StdioHandle): Promise<void> {
  handle.proc.stdin!.end();
  const timer = setTimeout(() => handle.proc.kill("SIGKILL"), 5_000);
  await handle.exited;
  clearTimeout(timer);
}

export type LoopbackHandle = { peer: RawPeer; close: () => Promise<void> };

/** In-process server over a PassThrough pair; same JSON-RPC framing as stdio. */
export async function startLoopback(registry: string, readOnlyMode = false): Promise<LoopbackHandle> {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  const server = createServer(buildContext({ registryDir: registry, readOnlyMode }));
  await server.connect(new StdioServerTransport(toServer, fromServer));
  const peer = new RawPeer((line) => toServer.write(line), fromServer);
  return {
    peer,
    close: async () => {
      await server.close();
      toServer.end();
    },
  };
}

/**
 * Deterministic projection of a tools/list result. Tools are sorted by name;
 * nothing is dropped, so every later SDK stage is compared on the full shape.
 * Stage-specific generator markers are removed only by `stripGeneratorMarkers`,
 * which names each one explicitly.
 */
export function sortTools(result: Record<string, unknown>): Array<Record<string, unknown>> {
  const tools = (result.tools as Array<Record<string, unknown>>).slice();
  return tools.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * Generator markers that differ between SDK stages without changing what a
 * caller may send or receive. Each is named and documented in CHANGES.md:
 *
 * - `$schema` (any depth): SDK v1 emitted the draft-07 dialect URI, SDK v2
 *   emits the 2020-12 URI. The schema bodies are otherwise identical.
 * - tool-level `execution: { taskSupport: "forbidden" }`: SDK v1.32 emitted
 *   it on every tool; SDK v2 omits it. Absent means forbidden, so task
 *   support is unchanged.
 */
export function stripGeneratorMarkers<T>(value: T, depth = 0): T {
  if (Array.isArray(value)) return value.map((v) => stripGeneratorMarkers(v, depth)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "$schema") continue;
      if (depth === 0 && key === "execution" && JSON.stringify(child) === '{"taskSupport":"forbidden"}') continue;
      out[key] = stripGeneratorMarkers(child, depth + 1);
    }
    return out as T;
  }
  return value;
}
