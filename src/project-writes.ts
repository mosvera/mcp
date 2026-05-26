// SPDX-License-Identifier: Apache-2.0
//
// MCP-only persistence helpers for capability manifests. Registry document
// persistence is delegated to @mosvera/runtime/node; manifests are the one
// project artifact that the runtime intentionally does not author yet.

import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { CapabilityManifest, Json, JsonObject } from "@mosvera/runtime";

const SAFE_ID = /^[a-z][a-z0-9_-]*$/;

export class ProjectWriteError extends Error {
  readonly code: "unsafe_filename" | "invalid_document";
  readonly detail?: unknown;

  constructor(code: "unsafe_filename" | "invalid_document", message: string, detail?: unknown) {
    super(message);
    this.name = "ProjectWriteError";
    this.code = code;
    this.detail = detail;
  }
}

function ensureSafeId(id: string): void {
  if (!SAFE_ID.test(id) || id.startsWith(".") || id.includes("/") || id.includes("\\") || isAbsolute(id)) {
    throw new ProjectWriteError("unsafe_filename", `unsafe provider id "${id}"`, { id });
  }
}

function assertWithin(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new ProjectWriteError("unsafe_filename", `path escapes registry root: ${target}`, { path: target });
  }
}

function stable(value: Json): Json {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    const out: JsonObject = {};
    for (const [key, child] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
      out[key] = stable(child);
    }
    return out;
  }
  return value;
}

function atomicWrite(path: string, body: string): void {
  const temp = join(dirname(path), `${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(temp, body, "utf8");
  renameSync(temp, path);
}

export function saveCapabilityManifest(directory: string, manifest: CapabilityManifest): string {
  const provider = manifest.provider;
  if (typeof provider !== "string") {
    throw new ProjectWriteError("invalid_document", "capability manifest is missing provider", { manifest });
  }
  ensureSafeId(provider);
  const root = resolve(directory);
  const manifestsDir = join(root, "manifests");
  const path = join(manifestsDir, `${provider}.manifest.json`);
  assertWithin(root, path);
  mkdirSync(manifestsDir, { recursive: true });
  atomicWrite(path, `${JSON.stringify(stable(manifest as unknown as Json), null, 2)}\n`);
  return path;
}

export function deleteCapabilityManifest(directory: string, provider: string): boolean {
  ensureSafeId(provider);
  const root = resolve(directory);
  const path = join(root, "manifests", `${provider}.manifest.json`);
  assertWithin(root, path);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}
