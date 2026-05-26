<!--
SPDX-License-Identifier: CC-BY-4.0
-->

# MCP Tool Example Transcripts

One sample JSON-RPC `tools/call` request and its expected response for each
of the five Mosvera MCP tools, run against the default
[`cinematic-editorial`](./cinematic-editorial/) registry.

All responses are the direct JSON output of the tool handler; the MCP SDK
wraps them in `{ "content": [{ "type": "text", "text": "<json>" }] }` over
the wire.

---

## `list_templates`

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "list_templates",
    "arguments": {}
  }
}
```

**Response**

```json
[
  { "name": "cinematic-editorial-base" },
  { "name": "noir", "extends": "cinematic-editorial-base" }
]
```

`cinematic-editorial-base` has no parent. `noir` extends it via
`$extends: "cinematic-editorial-base"`.

---

## `get_palette`

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_palette",
    "arguments": {
      "name": "editorial-warm"
    }
  }
}
```

**Response**

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

`editorial-warm` declares no `$extends`, so `inheritance_unresolved` is
absent.

---

## `validate_schema`

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "validate_schema",
    "arguments": {
      "document": {
        "$schema": "https://mosvera.io/schema/0.1/template",
        "id": "t",
        "medium": "photographic"
      },
      "kind": "template"
    }
  }
}
```

**Response**

```json
{ "valid": true, "errors": [] }
```

A validation failure returns `{ "valid": false, "errors": [...] }` — still a
successful call result, not an error.

---

## `resolve_composition`

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "resolve_composition",
    "arguments": {
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
      }
    }
  }
}
```

**Response**

```json
{
  "canonical": {
    "subject": "a lighthouse on a basalt cliff at dusk",
    "medium": "cinematic",
    "lighting": {
      "scheme": "three_point",
      "mood": "warm"
    },
    "lights": [
      { "name": "key", "power": 6 },
      { "name": "fill", "power": 5 },
      { "name": "rim", "power": 2 }
    ],
    "color_grade": {
      "contrast": "very_high",
      "saturation": "desaturated"
    },
    "color_temperature": "warm",
    "palette": { "accent": "#c8943f" },
    "aspect_ratio": "3:2",
    "quality": "high",
    "safety": "standard"
  }
}
```

Precedence chain (lowest to highest):

1. `cinematic-editorial-base` (resolved via `noir`'s `$extends` lineage)
2. `noir`
3. `golden-hour` modifier
4. `high-contrast` modifier
5. `overrides` block — adds the image-generation subject/provider-fit fields
   and replaces the template's `"photographic"` medium with `"cinematic"` at
   the highest precedence tier.

`lights` is merged by the `name` key (declared in
[`merge-strategies.json`](./cinematic-editorial/merge-strategies.json)),
so the `rim` light added by `golden-hour` is appended rather than replacing
the whole list.

---

## `compile_generation`

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "compile_generation",
    "arguments": {
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
      "provider": "illustrative-image"
    }
  }
}
```

**Response**

```json
{
  "status": "compiled",
  "warnings": [
    { "construct": "color_grade",     "action": "approximate" },
    { "construct": "color_temperature", "action": "unsupported" },
    { "construct": "lighting",        "action": "approximate" },
    { "construct": "lights",          "action": "emulate" },
    { "construct": "palette",         "action": "approximate" },
    { "construct": "safety",          "action": "unsupported" }
  ],
  "canonical": {
    "subject": "a lighthouse on a basalt cliff at dusk",
    "medium": "cinematic",
    "lighting": {
      "scheme": "three_point",
      "mood": "warm"
    },
    "lights": [
      { "name": "key", "power": 6 },
      { "name": "fill", "power": 5 },
      { "name": "rim", "power": 2 }
    ],
    "color_grade": {
      "contrast": "very_high",
      "saturation": "desaturated"
    },
    "color_temperature": "warm",
    "palette": { "accent": "#c8943f" },
    "aspect_ratio": "3:2",
    "quality": "high",
    "safety": "standard"
  }
}
```

`canonical` is identical to the `resolve_composition` output above; this is
by design — `compile_generation` resolves first, then applies the compilation
contract.

**Why `color_temperature` warns `unsupported`:** the
`illustrative-image.manifest.json` does not declare a `color_temperature`
construct; the canonical model contains the field but the provider cannot
fulfill it. Because `color_temperature` was not passed as `required` in
`criticality`, the call compiles with a warning rather than returning
`status: "error"`.

No provider HTTP call was made. The `status: "compiled"` result contains the
MEP-0003 contract decision (lowering actions, warnings) and the canonical
model. With a registered provider adapter, callers may pass `emit: true` to
receive the deterministic provider payload.

The `illustrative-image` provider is an **illustrative** capability manifest
included solely to exercise the compilation contract end-to-end. It is not a
real provider adapter. Real adapters live under
[`mosvera/providers`](https://github.com/mosvera/providers).
