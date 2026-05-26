<!--
SPDX-License-Identifier: CC-BY-4.0
-->

# `@mosvera/mcp`

Mosvera for agents and desktop assistants. This package runs a local Model
Context Protocol server that lets Claude Desktop, editors, and automation
tools inspect, resolve, compile, draft, save, and delete Mosvera aesthetics in
a local registry.

The server never calls image providers, never sends provider HTTP requests,
and does not store API keys or secrets. It turns aesthetic documents into
canonical Mosvera models, portable design tokens, CSS variables, and
deterministic provider payloads that other tools can consume.

## Install In Claude Desktop

The easiest path for non-command-line users is the Mosvera MCP Bundle:

1. Download `mosvera-mcp-0.1.2.mcpb` from the latest
   [GitHub release](https://github.com/mosvera/mcp/releases).
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
Save a new aesthetic called executive-editorial based on quiet-editorial-base with a more compact, board-ready voice.
```

The saved documents are deterministic JSON in your local registry directory.

## Tools

Every tool returns `structuredContent` plus a short text summary. Tools are
annotated with MCP read/write hints so clients can present normal approval
flows.

| Tool | Mode | Purpose |
|------|------|---------|
| `server_status` | Read | Registry path, write mode, versions, counts, diagnostics. |
| `list_aesthetics` | Read | List named composition aesthetics in the active registry. |
| `get_registry_document` | Read | Fetch a template, modifier, palette, composition, or capability manifest. |
| `validate_document` | Read | Validate one document against a Mosvera schema kind. |
| `validate_registry` | Read | Validate the active registry and return diagnostics. |
| `resolve_aesthetic` | Read | Resolve a named or inline aesthetic into canonical Mosvera JSON. |
| `compile_design_tokens` | Read | Compile canonical output into portable design tokens and CSS variables. |
| `compile_provider_payload` | Read | Advanced deterministic provider payload compilation; no provider HTTP call. |
| `draft_aesthetic` | Read | Draft a composition document without saving it. |
| `save_aesthetic` | Write | Create or update a named composition aesthetic. |
| `save_registry_document` | Write | Advanced create/update for registry documents and manifests. |
| `delete_registry_document` | Destructive write | Delete a registry document. |
| `write_merge_strategies` | Write | Replace `merge-strategies.json` with deterministic JSON. |

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
build/mosvera/mosvera-mcp-0.1.2.mcpb
```

## Package Boundaries

Use `@mosvera/runtime` when your application wants to call the TypeScript
runtime directly.

Use the Python package `mosvera` when you want the peer Python runtime.

Use `@mosvera/provider-*` packages when you want direct provider payload
compilation without MCP.

Use `@mosvera/mcp` when an agent, editor, or automation system should call
Mosvera through MCP tools.

## License

Code is Apache-2.0. Documentation is CC-BY-4.0.
