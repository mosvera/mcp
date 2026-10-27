# Changes

Chronological per-phase log for `@mosvera/mcp`. Newest entries on top. The
rich "why/how" lives in `docs/narrative/`; entries here are the scannable
index.

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
