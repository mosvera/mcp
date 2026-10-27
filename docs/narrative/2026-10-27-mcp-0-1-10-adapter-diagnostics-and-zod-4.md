# MCP 0.1.10: making a silent failure loud, then crossing zod 4

The 0.1.10 release of `@mosvera/mcp` existed for one reason: the production
server had been running without its HeyGen provider adapter, and nothing had
said so. The adapter was absent because the deployment's installed
dependencies were stale, not because the package was wrong, and a clean
install restored it in minutes. A failure that repairs itself silently on
the next install is still a failure worth engineering against, so 0.1.10
shipped a startup diagnostic that names every adapter that loaded. The
release then grew a second half a week later, when the repository's new
update automation proposed zod 4 and the server crossed it the same day.
The family-level story (repos, registries, publishing) is recorded in the
combined repo's narrative,
`docs/narrative/2026-10-27-public-face-and-the-0-1-3-release-train.md` in
`niclydon/mosvera`; this doc is the server's own record.

## The adapter diagnostic

The server loads its optional provider adapters dynamically: each adapter
package that is installed and importable registers itself, and one that is
missing is simply not there. That design is right for an MCP server that
should run with whatever providers a given install has configured, but it
had no observability. `server_status` reported registry counts, not adapter
coverage, so an install could lose a provider and keep answering every
health check.

PR #1 (commit `07d7718`, October 20, 2026) added a single startup line on
**stderr**:

```
[mosvera-mcp] provider adapters loaded: openai-gpt-image-1, bfl-flux-2-pro,
sdxl-replicate, heygen-avatar-video, google-gemini-image, google-veo-video,
runway-gen4-image, runway-gen45-video, elevenlabs-tts, adobe-firefly-image,
meshy-text-to-3d
```

Stderr is a deliberate choice: stdout carries the MCP JSON-RPC transport,
and anything written there corrupts the protocol stream. The diagnostic
rides the channel operators already read (the service journal) without
touching the wire. Eleven adapters is the full set at this version; a
shorter list in the log is now, by itself, a bug report.

The same PR refreshed the pinned dependencies (MCP SDK 1.32.1,
provider-base 0.1.3, TypeScript 5.9.3, vitest 4.1.12, zod 3.25.76) and
bumped the version in the four places this package carries it:
`package.json`, the `SERVER_VERSION` constant in `src/context.ts`, the MCPB
manifest (`mcpb/manifest.json`), and the bundle file name the pack script
produces. Version drift between those four has bitten this package before;
they move together or not at all.

Verification for the release: the full suite green (55 tests at the time),
the MCPB bundle packed and inspected, and after deployment a live
`server_status` call reporting the registry loaded (15 aesthetics, 14
templates, 6 palettes at that moment) with all eleven adapters in the
startup line.

## The zod 4 crossing

On October 27 the repository gained a Dependabot configuration as part of a
family-wide hygiene pass, and it immediately proposed the majors that had
been accumulating: TypeScript 7, vitest 5, @types/node 26, MCP SDK 1.32.2,
and zod 4.6.7. Taken one at a time, the lockfile-touching PRs conflict with
each other, so they were combined into a single PR (#11, commit `445133b`)
and verified as the combination that would actually ship.

Zod 4 was the only one that touched source. In zod 4, `z.record` requires
an explicit key schema; the single-argument form used across `src/server.ts`
for open-ended maps (aesthetic documents, merge strategies, criticality
maps, provider options) no longer typechecks. Seven call sites were
converted to the two-argument form:

```ts
// before
const docArg = z.union([z.string(), z.record(z.any())]);
const criticalityArg = z.record(z.enum(["required", "optional"]));

// after
const docArg = z.union([z.string(), z.record(z.string(), z.any())]);
const criticalityArg = z.record(z.string(), z.enum(["required", "optional"]));
```

No compatibility shim was needed: the MCP SDK's tool types at 1.32 accept
zod 4 schemas natively, so the server imports plain `zod` throughout. (This
is the same adaptation, and the same absence of a shim, that the combined
repo needed when it crossed zod 4 on October 19.)

Verification for the combined PR, before and after merge:

- `npm run ci` (build, typecheck, tests) green locally: 15 test files,
  56 tests. The count had grown from 55 with an unrelated token-compiling
  fix that landed October 22 (PR #2, commit `e22b222`, honoring
  `aesthetic_id` in `compile_design_tokens`).
- A stdio smoke of the built server: an `initialize` handshake followed by
  a `server_status` tool call, answered with the registry loaded. Note for
  future smokers: the stdio entry point is `dist/server.js`; `dist/index.js`
  is the library surface and exits silently when run, which looks exactly
  like a broken server until you check the `bin` field.
- GitHub CI and CodeQL green on the PR, then green again on `main`.

## Publishing, and the lock refresh

Publishing followed the pattern the npm registry now effectively requires
of this account: automation staged and verified everything, and the final
publish ran from a maintainer's interactive shell because npm is
deprecating token-based publishing. The 0.1.10 tarball was packed from a
clean `main` tree, its contents inspected (51 files under `dist/`), and
published from that artifact. The registry's HTTP API confirmed
`@mosvera/mcp` latest at 0.1.10 on October 27; the npm CLI's cached view
lagged behind it and is not a reliable read-back for the first few minutes
after a publish.

Two follow-ups landed the same day:

- GitHub release `v0.1.10`, titled `@mosvera/mcp 0.1.10`, with
  `mosvera-mcp-0.1.10.mcpb` attached. The bundle is built by the repo's
  `mcpb:pack` script and checked with `mcpb:inspect` (3,955 entries,
  unsigned, as before). mosvera.io links this asset for one-click install,
  so the release is part of the public surface, not bookkeeping.
- PR #12 (commit `3fe4b7c`) refreshed the lockfile to `@mosvera/runtime`
  0.1.3, published the same day. The dependency range (`^0.1.2`) already
  admitted it, so the change is lock-only, and it brings the OB-59048
  registry-loader fix into the server's installed tree.

The production deployment was then updated to the final `main`
(`3fe4b7c`): clean install, build, restart, and a live `server_status`
check. The deployment directory keeps two untracked overlay files
(`bridge.mjs`, `nexus-sync.mjs`) that are part of the deployment rather
than the package; they survive updates by design and are the only
untracked files there.

## What this release deliberately did not do

- No tool-surface changes. The server still exposes the same 17 tools; the
  only behavior change a client can observe is the stderr line at startup.
- No switch to npm trusted publishing. It remains the cleaner long-term
  answer for workflow publishes, but it needs per-package configuration on
  the registry side, and the staged-tarball pattern works today. Recorded
  here so the next release does not have to rediscover the tradeoff.

See `CHANGES.md` for the chronological diff summary.

> Executed by Nova (model: Muse Wonder), October 27, 2026.
