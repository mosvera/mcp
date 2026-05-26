<!--
SPDX-License-Identifier: CC-BY-4.0
-->

# `@mosvera/mcp`

The Mosvera Model Context Protocol (MCP) server. Exposes the
[`@mosvera/runtime`](https://github.com/mosvera/runtime)'s resolve, validate, and compile capabilities as five
strict MCP tools over stdio, so AI-native systems — agents, copilots, editors,
automated content pipelines — can orchestrate aesthetic compositions without
re-implementing the runtime.

**Version:** 0.1.0 · **Transport:** stdio · **Protocol:** MCP
([spec.modelcontextprotocol.io](https://spec.modelcontextprotocol.io))

---

## Which Package Do I Need?

Use `@mosvera/mcp` when another tool should call Mosvera through MCP tools over
stdio.

Use `@mosvera/runtime` instead when you are writing a JavaScript or TypeScript
app and want to call the runtime directly.

Use `@mosvera/provider-*` packages when you want direct provider payload
compilation without running an MCP server.

---

## Running the server

```bash
# Default registry: examples/cinematic-editorial/
npx mosvera-mcp

# Custom registry directory
npx mosvera-mcp --registry path/to/my-aesthetic-system/
```

The server loads an aesthetic-system **project directory** (the registry) at
startup. Every tool also accepts an inline `registry` argument that is merged
on top of the loaded project per-collection, keyed by document `id`; inline
entries take precedence over the loaded file.

---

## Tools

| Tool | Input (required) | Input (optional) | Output |
|------|-----------------|-----------------|--------|
| `list_templates` | — | `registry` | `[{ name, extends? }]` |
| `resolve_composition` | `composition` | `registry`, `merge_strategies` | `{ canonical }` |
| `get_palette` | `name` | `registry` | `{ palette }` |
| `validate_schema` | `document`, `kind` | — | `{ valid, errors }` |
| `compile_generation` | `composition`, `provider` | `registry`, `manifest`, `criticality`, `merge_strategies`, `emit` | `{ status, warnings?, canonical }` or `{ status, canonical, emission }` when `emit: true` |

All inputs and outputs carry strict JSON schemas; the server rejects malformed
calls before any runtime work is done. Documents may be passed as parsed
objects or as YAML/JSON strings.

### `list_templates`

Enumerates every template in the effective registry.

**Input**

```json
{ "registry": { "templates": { … } } }
```

`registry` is optional. When supplied, its entries are merged on top of the
loaded project's template collection.

**Output**

```json
[
  { "name": "cinematic-editorial-base" },
  { "name": "noir", "extends": "cinematic-editorial-base" }
]
```

`extends` is present only when the template declares a `$extends` parent.

---

### `resolve_composition`

Resolves a composition — base template lineage, ordered modifiers, inline
overrides — into a single canonical aesthetic model, following the merge
algebra defined in [MEP-0001](https://github.com/mosvera/spec/blob/main/meps/0001-composition-semantics.md).

**Input**

```json
{
  "composition": {
    "base": "noir",
    "modifiers": ["golden-hour", "high-contrast"],
    "overrides": {
      "subject": "a lighthouse on a basalt cliff at dusk",
      "medium": "cinematic",
      "palette": { "accent": "#c8943f" },
      "aspect_ratio": "3:2",
      "quality": "high",
      "safety": "standard"
    }
  },
  "registry": { … },
  "merge_strategies": { "lights": { "strategy": "merge_by", "key": "name" } }
}
```

`composition` may be a parsed object or a YAML/JSON string.

**Output — success**

```json
{ "canonical": { … } }
```

**Output — error**

```json
{ "error": "unknown_reference", "detail": { "missing": ["golden-hour"] } }
```

---

### `get_palette`

Returns a named palette's semantic color roles.

**Input**

```json
{ "name": "editorial-warm", "registry": { … } }
```

**Output — success**

```json
{
  "palette": {
    "$schema": "https://mosvera.io/schema/0.1/palette",
    "id": "editorial-warm",
    "roles": {
      "background": "#1a1410",
      "foreground": "#f5e6d3",
      "accent": "#c8943f",
      "shadow": "#0a0805"
    }
  }
}
```

**Output — unresolved inheritance**

When the palette declares `$extends`, the stored value is returned along with a
flag because palette inheritance resolution is deferred to a later runtime
minor (design decision D4; see [ADR-0011](https://github.com/mosvera/spec/blob/main/docs/decisions/0011-mcp-surface-design.md)):

```json
{
  "palette": { … },
  "inheritance_unresolved": true
}
```

---

### `validate_schema`

Validates a Mosvera document against the published JSON schemas
(`https://mosvera.io/schema/0.1/…`). A validation failure is a **successful
call** with `valid: false`; it is not an error result.

**Input**

```json
{
  "document": { "$schema": "https://mosvera.io/schema/0.1/template", "id": "t", "medium": "photographic" },
  "kind": "template"
}
```

`kind` MUST be one of: `composition`, `template`, `modifier`, `palette`,
`capability-manifest`.

**Output — valid**

```json
{ "valid": true, "errors": [] }
```

**Output — invalid**

```json
{
  "valid": false,
  "errors": [
    { "path": "/id", "message": "must be string" }
  ]
}
```

---

### `compile_generation`

Resolves a composition, then applies the
[MEP-0003](https://github.com/mosvera/spec/blob/main/meps/0003-provider-compilation-contract.md) compilation
contract rule engine against the named provider's capability manifest. When
`emit: true`, the default server context registers the reference OpenAI, FLUX,
and SDXL adapters and returns deterministic provider payload emission.

No provider HTTP call is made. `compile_generation` stops at the deterministic
compile/emit boundary; adapter `execute()` is outside the MCP tool.

**Input**

```json
{
  "composition": {
    "base": "noir",
    "modifiers": ["golden-hour", "high-contrast"],
    "overrides": {
      "subject": "a lighthouse on a basalt cliff at dusk",
      "medium": "cinematic",
      "palette": { "accent": "#c8943f" },
      "aspect_ratio": "3:2",
      "quality": "high",
      "safety": "standard"
    }
  },
  "provider": "illustrative-image",
  "registry": { … },
  "manifest": { … },
  "criticality": { "color_temperature": "required" },
  "merge_strategies": { … },
  "emit": false
}
```

`manifest` overrides the manifest loaded from the registry for the named
provider. `criticality` maps construct names to `"required"` or `"optional"`;
unmarked constructs are treated as optional. `emit` defaults to `false`.

Built-in reference provider ids:

- `openai-gpt-image-1`
- `bfl-flux-2-pro`
- `sdxl-replicate`

**Output — compiled**

```json
{
  "status": "compiled",
  "warnings": [
    { "construct": "color_grade", "action": "approximate" },
    { "construct": "color_temperature", "action": "unsupported" },
    { "construct": "lighting", "action": "approximate" },
    { "construct": "lights", "action": "emulate" },
    { "construct": "palette", "action": "approximate" },
    { "construct": "safety", "action": "unsupported" }
  ],
  "canonical": { … }
}
```

**Output — emitted**

When `emit: true`, the compiled response carries the adapter emission:

```json
{
  "status": "compiled",
  "canonical": { … },
  "emission": {
    "payload": { "prompt": "…", "size": "1536x1024" },
    "prompt": "…",
    "warnings": [ … ],
    "provenance": { … }
  }
}
```

**Output — required construct unsupported**

When a construct marked `required` cannot be fulfilled by the provider:

```json
{
  "status": "error",
  "error": "required_unsupported",
  "construct": "color_temperature",
  "canonical": { … }
}
```

---

## Errors

Tool calls that cannot be satisfied return a structured error object rather
than throwing. The closed taxonomy is:

| Code | Meaning |
|------|---------|
| `invalid_document` | The supplied document failed schema validation. `detail.errors` carries the validation issues. |
| `unknown_reference` | One or more references (`base`, modifier entries) are not present in the effective registry. `detail.missing` lists them. |
| `unknown_provider` | The named provider has no manifest in the registry and none was supplied inline. |
| `inheritance_cycle` | Template `$extends` chain forms a cycle. |
| `reference_cycle` | Composition reference graph contains a cycle. |
| `multiple_inheritance_unsupported` | A template declares more than one `$extends` parent; multiple inheritance is not supported at v0.1. |

The `compile_generation` tool additionally returns `{ "status": "error", "error": "required_unsupported", … }` when a `required` construct cannot be fulfilled (this is a compilation outcome, not a call-level error).

---

## Registry directory layout

A project directory (the registry) MUST contain template files named
`template.<id>.json`, optionally modifier files `modifier.<id>.json`, palette
files `palette.<id>.json`, and provider capability manifests under
`manifests/<provider-id>.manifest.json`. It MAY contain a `merge-strategies.json`
at its root declaring project-level field merge strategies (shape and
precedence defined in [MEP-0004](https://github.com/mosvera/spec/blob/main/meps/0004-mcp-tool-contract.md)).

See [`examples/cinematic-editorial/`](./examples/cinematic-editorial/)
for the reference example.

---

## Example transcripts

[`examples/README.md`](./examples/README.md) contains one sample
JSON-RPC `tools/call` request and the expected response for each of the five
tools, verified against the default `cinematic-editorial` registry.

---

## Tests

```bash
npm install
npm run ci
```

---

## Layout

| Path | Purpose |
|------|---------|
| `src/server.ts` | Stdio bootstrap; thin wiring only. |
| `src/tools/` | Pure tool handlers (one module per tool). |
| `src/registry/` | Project loader, strategy composer, reference preflight. |
| `src/errors.ts` | Closed error taxonomy and runtime-error mapping. |
| `src/types.ts` | Shared types: `LoadedProject`, `ToolContext`, error codes. |
| `test/` | Vitest conformance and protocol tests. |
| `examples/` | Sample request/response transcripts. |

---

## Specification

Tool contracts are normatively defined in
[MEP-0004](https://github.com/mosvera/spec/blob/main/meps/0004-mcp-tool-contract.md). Design decisions are
recorded in [ADR-0011](https://github.com/mosvera/spec/blob/main/docs/decisions/0011-mcp-surface-design.md).

---

## License

Apache-2.0 per
[ADR-0001](https://github.com/mosvera/spec/blob/main/docs/decisions/0001-license-choice.md).
