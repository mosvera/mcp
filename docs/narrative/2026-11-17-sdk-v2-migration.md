# The MCP server moves to the TypeScript MCP SDK v2

`@mosvera/mcp` was the eighth of fifteen MCP servers in a planned move from
the monolithic `@modelcontextprotocol/sdk` (v1) to the split v2 packages
(`@modelcontextprotocol/server`, `/client`, `/core`), ahead of the v1
support horizon in early 2027. The server is a public npm package
and a one-click MCPB bundle, and it is in daily use, so the migration was
held to one rule: a caller must not be able to tell, except where this
document says so.

Two things mattered more here than in most of the family. The first is the
provider passthrough. `compile_provider_payload` takes an open
`provider_options` object and hands it, unchanged, to whichever of eleven
provider adapters is named, and the adapter's payload comes back inside a
`structuredContent` that is validated against a deliberately open
(`passthrough`) output schema. Any SDK change that started stripping unknown
keys on either side would quietly break every provider. The second is
package provenance: the published server and the MCPB bundle both ship a
`node_modules` tree, and the bundle inspector named the v1 package as a
required entry.

## Pinning the contract first

Before any dependency moved, a wire suite was written against the v1 code
(`test/wire/`). It speaks raw newline-delimited JSON-RPC, so the receipts do
not depend on which SDK client happens to be installed, and it drives the
server two ways: the real `src/server.ts` entrypoint as a child process, and
`createServer(ctx)` connected in-process over a pair of streams. The child
process gets a throwaway HOME and config directory and an explicit temporary
registry, and preloads `test/fixtures/net-guard.cjs`, which refuses any
non-loopback socket before DNS and logs the attempt. The suite asserts the
log stays empty: every tool here is compile-only, and the guard proves it.

The v1 receipts were committed as fixtures: the full `tools/list` for a
writable registry and for `--read-only`, and the compiled payload from every
one of the eleven adapters, called with the same `provider_options` (an
unknown option included). Every later stage is compared against them.

The repository was already on Zod 4 (since 0.1.10), so the Zod step of the
plan became proof rather than change. The suite pins union arguments (a
named aesthetic and an inline document both accepted, a number refused
before the handler), string-keyed records with validated nested values,
unknown keys stripped rather than refused at the top level and inside a
record value, enum and type failures naming the offending path, and the
passthrough output schema leaving every extra `structuredContent` key in
place. The source has no `.describe()`, `preprocess` or `pipe` schemas, so
there was nothing of that kind to carry; the committed `tools/list` fixture
would catch one appearing.

## SDK v2

The pinned `@modelcontextprotocol/codemod@2.4.0 v1-to-v2` ran cleanly. It
swapped the imports, wrapped each raw `inputSchema` shape in `z.object(...)`
and moved the dependency. Its output then needed four corrections by hand:

- It flagged every `outputSchema` as unverifiable. All of them are the one
  `z.object({ ok, message }).passthrough()` constant, already a schema, so
  the markers were removed.
- It could not see through `inputSchema: packSourceArg` (a raw shape held in
  a constant), so that one became `z.object(packSourceArg)`.
- It put `@modelcontextprotocol/client` in `dependencies`. The client is
  only used by tests, so it moved to `devDependencies`; the published
  package ships `server` and `core` only.
- It re-indented the bodies it wrapped; the original indentation was
  restored so the diff shows only the lines that change.

One type change surfaced at compile time. SDK v2 types
`CallToolResult.structuredContent` as an opaque value, and the package
exports its `run*` handlers, whose results callers read fields from. Rather
than widen that public type, `src/mcp-result.ts` now exports a
`CallToolResult` that keeps `structuredContent` as
`Record<string, unknown>`, as v1 typed it. No handler, context, header or
cancellation site needed changing: the handlers take only their arguments.

`scripts/inspect-mcpb.mjs` now requires the v2 `server` and `core` packages
in the bundle, and `test/wire/sdk-boundary.test.ts` fails if v1 returns to
source, tests, scripts, `package.json` or the lockfile, if the client leaks
into runtime dependencies, or if any MCP package in the lockfile resolves
anywhere but the public npm registry or lacks an integrity hash. Both v2
packages are published with npm provenance attestations.

## What a caller can see

The receipts were captured again on v2. Tool names, titles, descriptions,
annotations, input schemas and output schemas are identical apart from two
generator markers, and the provider payloads are byte-identical for all
eleven adapters:

- `$schema` in every input and output schema is now
  `https://json-schema.org/draft/2020-12/schema` instead of the draft-07
  URI. The schema bodies did not change.
- `execution: { "taskSupport": "forbidden" }` is no longer emitted on each
  tool. An absent value means forbidden, so nothing about task support
  changed.

Two behaviours differ, and the suite pins both:

- Calling a tool that is not registered (an unknown name, or a write tool
  under `--read-only`) is now a JSON-RPC error, code `-32602`, message
  `Tool <name> not found`. On v1 it was an `isError` tool result whose text
  carried the same code. Nothing executes either way.
- Input validation failures are still `isError` tool results that name the
  offending path, but the text is formatted differently
  (`Input validation error: Invalid arguments for tool get_registry_document: kind: Invalid option: ...`).

The initialize result (server name, title, version, capabilities) is
unchanged, a cancelled in-flight call leaves the server serving, and the
stdio process still exits 0 when the client closes its input.

## Not done here

No release and no deployment. The running server stays on the 0.1.10
install until its operator orders the ship; rolling back is the source and
lockfile at `0705702`.
