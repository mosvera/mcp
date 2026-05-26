// SPDX-License-Identifier: Apache-2.0

import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");

const source = resolve(packageRoot, "examples", "cinematic-editorial");
const target = resolve(packageRoot, "dist", "examples", "cinematic-editorial");

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
