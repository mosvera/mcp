# Agent Guidance

This repo is the local stdio MCP bridge for Mosvera. It exposes registry,
resolution, token, pack, and provider-payload tools to desktop assistants and
coding agents.

## Safety Rules

- Do not commit secrets, `.env*`, local config, vault references, generated
  media, caches, private notes, or local machine paths.
- Preserve unrelated user changes and keep edits narrow.
- Use DCO-signed commits when committing.
- Do not publish packages, rotate credentials, change repo visibility, create
  releases, or run live provider APIs unless explicitly asked.

## Repo Boundaries

- MCP may read and write local registry files when the active registry is
  writable.
- MCP must not execute provider APIs; `compile_provider_payload` is compile-only.
- Keep read, write, and destructive tool annotations honest.
- Keep the Claude Desktop bundle path simple for non-command-line users.

## Verification

- Run `npm run ci`.
- Run MCPB stage, pack, and inspect commands when bundle files change.
- Run `git diff --check` before committing.
