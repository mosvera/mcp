// SPDX-License-Identifier: Apache-2.0
//
// Capture raw JSON-RPC receipts from the real stdio server for the SDK v2
// migration record. Usage:
//   node --import tsx test/wire/capture-receipt.ts <out-dir>
// Writes initialize.json, tools-list.json and tools-list.read-only.json.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeSandbox, startStdio, stopStdio } from "./harness.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: capture-receipt.ts <out-dir>");
mkdirSync(out, { recursive: true });

for (const [label, readOnly] of [["", false], [".read-only", true]] as const) {
  const sb = makeSandbox();
  const handle = startStdio(sb, readOnly ? ["--registry", sb.registry, "--read-only"] : ["--registry", sb.registry]);
  const init = await handle.peer.initialize();
  const list = await handle.peer.request("tools/list", {});
  const unknownTool = await handle.peer.callTool("no_such_tool", {});
  const badArgs = await handle.peer.callTool("get_registry_document", { kind: "nope", id: 1 });
  await stopStdio(handle);
  if (!readOnly) {
    writeFileSync(join(out, "initialize.json"), `${JSON.stringify(init, null, 2)}\n`);
    writeFileSync(join(out, "unknown-tool.json"), `${JSON.stringify(unknownTool, null, 2)}\n`);
    writeFileSync(join(out, "invalid-args.json"), `${JSON.stringify(badArgs, null, 2)}\n`);
  }
  writeFileSync(join(out, `tools-list${label}.json`), `${JSON.stringify(list, null, 2)}\n`);
}
console.log(`receipts written to ${out}`);
