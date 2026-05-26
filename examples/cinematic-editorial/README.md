<!--
SPDX-License-Identifier: CC-BY-4.0
-->

# Example: Cinematic Editorial

A worked Mosvera aesthetic system expressed entirely in schema-valid documents.
It demonstrates single inheritance (`noir` extends `cinematic-editorial-base`),
modifier composition (`golden-hour`, `high-contrast`), an inline override, and a
project-level `merge-strategies.json` declaring that the open aesthetic field
`lights` merges by the `name` key (MEP-0001 `merge_by`). The composition also
includes the Phase 4 image-generation fields (`subject`, `aspect_ratio`,
`quality`, `safety`, and `palette.accent`) used by the provider adapters.

`manifests/illustrative-image.manifest.json` is an **illustrative** capability
manifest used only to exercise the MEP-0003 compilation contract end-to-end. It
is NOT a real provider adapter. The real reference adapters live in
[`mosvera/providers`](https://github.com/mosvera/providers).

This directory is retained as a compact provider-compilation fixture. The
default first-run registry seed for the public MCP server is
[`../demo-aesthetics/`](../demo-aesthetics/).
