// SPDX-License-Identifier: Apache-2.0
//
// Project registry loader (boundary module). Reads a directory of Mosvera
// documents into an in-memory Registry plus capability manifests and the
// project's merge-strategies. Classifies each document by its $schema id
// (filename fallback), validates it on load, and indexes by id/provider.
// A malformed or unclassifiable document fails startup loudly.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createValidator,
  parse,
  type CapabilityManifest,
  type DocumentKind,
  type JsonObject,
  type MergeStrategies,
  type Registry,
  type Validator,
} from "@mosvera/runtime";
import type { LoadedProject } from "../types.ts";

const ID_TO_KIND: Record<string, DocumentKind> = {
  "https://mosvera.io/schema/0.1/template": "template",
  "https://mosvera.io/schema/0.1/modifier": "modifier",
  "https://mosvera.io/schema/0.1/palette": "palette",
  "https://mosvera.io/schema/0.1/composition": "composition",
  "https://mosvera.io/schema/0.1/capability-manifest": "capability-manifest",
};

const DOC_EXT = /\.(json|ya?ml)$/i;

function classify(doc: JsonObject, file: string): DocumentKind {
  const schemaId = doc["$schema"];
  if (typeof schemaId === "string" && schemaId in ID_TO_KIND) return ID_TO_KIND[schemaId]!;
  if (/(^|\/)template\./.test(file)) return "template";
  if (/(^|\/)modifier\./.test(file)) return "modifier";
  if (/(^|\/)palette\./.test(file)) return "palette";
  if (/\.manifest\.(json|ya?ml)$/i.test(file)) return "capability-manifest";
  if (/(^|\/)composition\b/.test(file)) return "composition";
  throw new Error(`cannot classify document "${file}" (no recognized $schema or filename convention)`);
}

function readDoc(path: string): JsonObject {
  return parse(readFileSync(path, "utf8"));
}

function validateOrThrow(v: Validator, doc: JsonObject, kind: DocumentKind, file: string): void {
  const res = v.validate(doc, kind);
  if (!res.valid) {
    const detail = res.errors.map((e) => e.message).join("; ");
    throw new Error(`invalid ${kind} document "${file}": ${detail}`);
  }
}

function requireId(doc: JsonObject, file: string): string {
  const id = doc["id"];
  if (typeof id !== "string") throw new Error(`document "${file}" is missing a string id`);
  return id;
}

/** Load an aesthetic-system project directory. */
export function loadRegistry(dir: string, validator: Validator = createValidator()): LoadedProject {
  const registry: Registry = { templates: {}, modifiers: {}, palettes: {} };
  const manifests: Record<string, CapabilityManifest> = {};
  let strategies: MergeStrategies = {};

  const stratPath = join(dir, "merge-strategies.json");
  if (existsSync(stratPath)) {
    strategies = readDoc(stratPath) as unknown as MergeStrategies;
  }

  const topLevel = readdirSync(dir).filter((f) => DOC_EXT.test(f) && f !== "merge-strategies.json");
  for (const f of topLevel) {
    const doc = readDoc(join(dir, f));
    const kind = classify(doc, f);
    validateOrThrow(validator, doc, kind, f);
    if (kind === "template") registry.templates![requireId(doc, f)] = doc;
    else if (kind === "modifier") registry.modifiers![requireId(doc, f)] = doc;
    else if (kind === "palette") registry.palettes![requireId(doc, f)] = doc;
    else if (kind === "capability-manifest") {
      manifests[String(doc["provider"])] = doc as unknown as CapabilityManifest;
    }
    // composition documents are runtime inputs, not registry entries: validated, not stored.
  }

  const manDir = join(dir, "manifests");
  if (existsSync(manDir)) {
    for (const f of readdirSync(manDir).filter((f) => DOC_EXT.test(f))) {
      const doc = readDoc(join(manDir, f));
      validateOrThrow(validator, doc, "capability-manifest", `manifests/${f}`);
      manifests[String(doc["provider"])] = doc as unknown as CapabilityManifest;
    }
  }

  return { registry, manifests, strategies };
}
