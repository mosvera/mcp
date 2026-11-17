# Changes

Chronological per-phase log for `@mosvera/mcp`. Newest entries on top. The
rich "why/how" lives in `docs/narrative/`; entries here are the scannable
index.

---

## 2026-11-17 — MCP SDK v2 (split packages), wire contract pinned

- Source moved from `@modelcontextprotocol/sdk` 1.32.2 to
  `@modelcontextprotocol/server` 2.4.0 (runtime) and
  `@modelcontextprotocol/client` 2.4.0 (tests only) via the pinned
  `@modelcontextprotocol/codemod@2.4.0`, with four hand corrections.
- New `test/wire/` suite pins the v1 receipts first: raw JSON-RPC over the
  real stdio entrypoint and an in-process loopback, net guard preloaded, full
  `tools/list` (writable and read-only) and the compiled payload from all
  eleven provider adapters. Zod 4 behaviour (unions, records, stripping,
  passthrough output) is proven, not changed.
- Caller-visible changes: schema `$schema` is the 2020-12 URI instead of
  draft-07; `execution.taskSupport: "forbidden"` is no longer emitted (absent
  means forbidden); calling an unregistered tool is a JSON-RPC `-32602` error
  instead of an `isError` result; validation-failure text is reformatted
  (still `isError`, still names the path). Schemas, annotations and provider
  payloads are otherwise identical.
- `CallToolResult` exported from `src/mcp-result.ts` keeps
  `structuredContent: Record<string, unknown>` for the exported handlers.
- Provenance: the MCPB inspector requires the v2 `server`/`core` packages; a
  boundary test keeps v1 out of source, `package.json` and the lockfile and
  pins every MCP package to the npm registry with an integrity hash.
- Not released or deployed; rollback is source + lockfile at `0705702`.

Full record: `docs/narrative/2026-11-17-sdk-v2-migration.md`.

---

## 2026-10-27 — 0.1.10 published; zod 4 crossed; lock at runtime 0.1.3

- `@mosvera/mcp` 0.1.10 published to npm from a staged, content-verified
  tarball (npm is deprecating token-based publishing, so the workflow
  stages and verifies and the final publish runs from a maintainer shell).
  Verified live on the registry API.
- GitHub release `v0.1.10` cut with `mosvera-mcp-0.1.10.mcpb` attached, the
  bundle mosvera.io links for one-click install.
- Combined Dependabot majors landed as PR #11 (commit `445133b`): zod
  4.6.7, TypeScript 7.0.2, vitest 5.0.5, @types/node 26.6.5, MCP SDK
  1.32.2, GitHub Actions 7. Zod 4 required converting seven
  single-argument `z.record(...)` schemas in `src/server.ts` to the
  two-argument form; no compatibility shim was needed. 56 tests green plus
  a stdio smoke of the built server.
- Lockfile refreshed to `@mosvera/runtime` 0.1.3 (PR #12, commit
  `3fe4b7c`), bringing the OB-59048 registry-loader fix into the installed
  tree. Production deployment updated to this `main` and verified healthy.
- Dependabot config (PR #3) and CodeQL workflow (PR #10) added as part of
  the family-wide tidy pass.

Full record:
`docs/narrative/2026-10-27-mcp-0-1-10-adapter-diagnostics-and-zod-4.md`.
Family-level record: `docs/narrative/2026-10-27-public-face-and-the-0-1-3-release-train.md`
in `niclydon/mosvera`.

---

## 2026-10-20 — 0.1.10: adapter startup diagnostic, dependency refresh

**Decision:** a provider adapter that fails to load must say so. The
production server had been running without its HeyGen adapter because the
deployment's installed dependencies were stale, and no surface reported the
absence. PR #1 (commit `07d7718`) adds a startup line on stderr listing the
optional provider adapters that loaded (stderr because stdout carries the
MCP transport), refreshes dependencies (MCP SDK 1.32.1, provider-base
0.1.3, TypeScript 5.9.3, vitest 4.1.12, zod 3.25.76), and bumps the version
to 0.1.10 in `package.json`, `SERVER_VERSION`, the MCPB manifest, and the
bundle file name.

---
