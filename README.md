<!--
SPDX-License-Identifier: CC-BY-4.0
-->

# `@mosvera/mcp`

Mosvera for agents and desktop assistants. This package runs a local Model
Context Protocol server that lets Claude Desktop, editors, and automation
tools inspect, resolve, compile, draft, save, and delete Mosvera aesthetics in
a local registry.

The server runs locally. It never executes provider APIs, never sends provider
HTTP requests, and does not store API keys or secrets. It turns documents in
your local registry into canonical Mosvera models, portable design tokens,
CSS variables, deterministic provider payloads, and portable aesthetic packs.

## 10-Minute Quickstart

New users should start with the
[`10-minute quickstart`](https://github.com/mosvera/spec/blob/main/docs/guides/10-minute-quickstart.md).
It begins with Claude Desktop, then shows the npm/MCP path and runtime paths.

## Install In Claude Desktop

The easiest path for non-command-line users is the Mosvera MCP Bundle:

1. Download `mosvera-mcp-0.1.7.mcpb` from the latest
   [GitHub release](https://github.com/mosvera/mcp/releases/latest).
2. Double-click the file, drag it into Claude Desktop, or install it from
   Claude Desktop Settings → Extensions → Advanced settings → Install
   Extension.
3. Leave the registry directory blank to use the platform default, or choose a
   folder where your aesthetic registry should live.

Default registry locations:

| Platform | Default registry |
|----------|------------------|
| macOS | `~/Library/Application Support/Mosvera/registry` |
| Windows | `%APPDATA%/Mosvera/registry` |
| Linux/dev | `~/.config/mosvera/registry` |

On first run, Mosvera seeds four public demo aesthetics into the registry:
`quiet-editorial`, `technical-manual`, `cinematic-lab`, and
`claymation-playful-builder`.

## Language

Mosvera uses a small term stack on purpose:

- A **named aesthetic** is the user-facing intent, like
  `executive-editorial`.
- A **composition document** is the technical Mosvera document that resolves
  that intent.
- An **aesthetic pack** is a portable `.mosvera.json` file for sharing a named
  aesthetic and its registry dependencies.
- A **local registry** is the folder where your templates, palettes,
  modifiers, composition documents, manifests, and merge strategies live.
- **Tokens** and provider **payloads** are compiled outputs for other tools to
  consume.

## Install With npm

Use npm when you are wiring Mosvera into another MCP host or a developer
workflow:

```bash
npm install -g @mosvera/mcp
mosvera-mcp
```

Run with a custom registry:

```bash
mosvera-mcp --registry ./my-aesthetic-registry
```

Run read-only:

```bash
mosvera-mcp --read-only
```

Environment overrides:

```bash
MOSVERA_REGISTRY_DIR=./my-aesthetic-registry mosvera-mcp
MOSVERA_MCP_READ_ONLY=1 mosvera-mcp
```

## What To Ask Claude

Try these after installing the bundle:

```text
List my Mosvera aesthetics.
```

```text
Resolve the claymation-playful-builder aesthetic and show me the canonical model.
```

```text
Compile quiet-editorial into CSS variables.
```

```text
Export quiet-editorial as an aesthetic pack.
```

```text
Preview importing this aesthetic pack into my registry.
```

```text
Import the claymation-playful-builder sample pack into my registry.
```

```text
Save a new aesthetic called executive-editorial based on quiet-editorial-base with a more compact, board-ready voice.
```

The saved documents are deterministic JSON in your local registry directory.

Canonical sample pack:
<https://raw.githubusercontent.com/mosvera/spec/main/examples/packs/claymation-playful-builder.mosvera.json>

## Tools

Every tool returns `structuredContent` plus a short text summary. Tools are
annotated with MCP read/write/destructive hints so clients can present normal
approval flows. Read tools do not mutate the registry. Write tools are only
registered when the active local registry is writable and the server is not in
read-only mode.

| Tool | Mode | Purpose |
|------|------|---------|
| `server_status` | Read | Registry path, write mode, versions, counts, diagnostics. |
| `list_aesthetics` | Read | List named composition aesthetics in the active registry. |
| `get_registry_document` | Read | Fetch a template, modifier, palette, composition, or capability manifest. |
| `validate_document` | Read | Validate one document against a Mosvera schema kind. |
| `validate_registry` | Read | Validate the active registry and return diagnostics. |
| `validate_aesthetic_pack` | Read | Validate an inline or local `.mosvera.json` aesthetic pack. |
| `preview_aesthetic_import` | Read | Preview importing an aesthetic pack without writing files. |
| `export_aesthetic_pack` | Read | Export a named aesthetic as a portable `.mosvera.json` pack. |
| `resolve_aesthetic` | Read | Resolve a named or inline aesthetic into canonical Mosvera JSON. |
| `compile_design_tokens` | Read | Compile canonical output into portable design tokens and CSS variables. |
| `compile_provider_payload` | Read | Advanced deterministic provider payload compilation; no provider HTTP call. Supports provider-specific `provider_options` such as HeyGen `avatar_id`/`script`, ElevenLabs `voice_id`, and short-video `duration` settings. |
| `draft_aesthetic` | Read | Draft a composition document without saving it. |
| `save_aesthetic` | Write | Create or update a named composition aesthetic. |
| `save_registry_document` | Write | Advanced create/update for registry documents and manifests. |
| `delete_registry_document` | Destructive write | Delete a registry document. |
| `write_merge_strategies` | Write | Replace `merge-strategies.json` with deterministic JSON. |
| `import_aesthetic_pack` | Write | Import an aesthetic pack into the active local registry. |

When the server starts with `--read-only`, write tools are not registered.

## Registry Files

Mosvera reads JSON and YAML, but writes deterministic JSON only:

```text
template.<id>.json
modifier.<id>.json
palette.<id>.json
composition.<id>.json
manifests/<provider>.manifest.json
merge-strategies.json
```

Aesthetic packs are exchanged as separate `.mosvera.json` files. They can carry
templates, palettes, modifiers, composition documents, and merge strategies.
They do not carry assets, provider manifests, credentials, remote URLs, or zip
bundles in v1.

To test import/export without authoring a pack from scratch, use the canonical
sample pack in
[`mosvera/spec/examples/packs`](https://github.com/mosvera/spec/tree/main/examples/packs).

IDs must be safe Mosvera references: lowercase letters, numbers, `_`, and `-`,
starting with a letter. Absolute paths, dotfiles, path traversal, unknown
kinds, and unsafe filenames are rejected.

## Developer Verification

```bash
npm install
npm run ci
npm audit --audit-level=moderate
npm pack --dry-run
npm run mcpb:pack
npm run mcpb:inspect
```

The MCPB pack step creates:

```text
build/mosvera/mosvera-mcp-0.1.7.mcpb
```

## Package Boundaries

Use `@mosvera/runtime` when your application wants to call the TypeScript
runtime directly.

Use the Python package `mosvera` when you want the peer Python runtime.

Use `@mosvera/provider-*` packages when you want direct provider payload
compilation without MCP. The MCP package loads optional provider adapters when
they are installed and always keeps provider calls out of MCP. The current
compile-only provider ids are:

```text
openai-gpt-image-1
bfl-flux-2-pro
sdxl-replicate
heygen-avatar-video
google-gemini-image
google-veo-video
runway-gen4-image
runway-gen45-video
elevenlabs-tts
adobe-firefly-image
meshy-text-to-3d
```

Use `@mosvera/mcp` when an agent, editor, or automation system should call
Mosvera through MCP tools.

## License

Code is Apache-2.0. Documentation is CC-BY-4.0.
