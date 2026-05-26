// SPDX-License-Identifier: Apache-2.0
//
// Server context loading: choose a user-owned registry directory, seed public
// examples on first run, and fall back to packaged examples when local writes
// are unavailable.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  composeStrategies,
  createValidator,
  deriveStrategies,
  validateRegistry,
  type LoadedProject,
  type RegistryDiagnostic,
  type Validator,
} from "@mosvera/runtime";
import { loadProject, RegistryProjectError } from "@mosvera/runtime/node";
import { fluxAdapter } from "@mosvera/provider-flux";
import { openaiAdapter } from "@mosvera/provider-openai";
import { sdxlAdapter } from "@mosvera/provider-sdxl";
import type { ProviderAdapter } from "@mosvera/provider-base";
import type { ToolContext } from "./types.ts";

export const SERVER_VERSION = "0.1.6";

export interface CliOptions {
  registryDir?: string;
  readOnlyMode: boolean;
}

export interface BuildContextOptions {
  registryDir?: string;
  readOnlyMode?: boolean;
}

function flagValue(argv: string[], name: string): string | undefined {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct !== undefined) return direct.slice(name.length + 1);
  const i = argv.indexOf(name);
  if (i !== -1) return argv[i + 1];
  return undefined;
}

function booleanFlag(argv: string[], name: string): boolean {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct !== undefined) {
    const value = direct.slice(name.length + 1).toLowerCase();
    if (value.includes("${")) return false;
    return !["", "0", "false", "no"].includes(value);
  }
  return argv.includes(name);
}

function configValue(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0 || value.includes("${")) return undefined;
  return value;
}

export function parseCliOptions(argv: string[]): CliOptions {
  const registryArg = configValue(flagValue(argv, "--registry"));
  const envRegistry = configValue(process.env.MOSVERA_REGISTRY_DIR);
  const envReadOnly = configValue(process.env.MOSVERA_MCP_READ_ONLY ?? process.env.MOSVERA_READ_ONLY);
  const parsed: CliOptions = {
    readOnlyMode:
      booleanFlag(argv, "--read-only") ||
      booleanFlag(argv, "--readonly") ||
      (envReadOnly !== undefined && !["", "0", "false", "no"].includes(envReadOnly.toLowerCase())),
  };
  const registryDir = registryArg !== undefined && registryArg.length > 0 ? registryArg : envRegistry;
  if (registryDir !== undefined) parsed.registryDir = registryDir;
  return parsed;
}

export function defaultRegistryDir(platform = process.platform, env = process.env): string {
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "Mosvera", "registry");
  if (platform === "win32") return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Mosvera", "registry");
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "mosvera", "registry");
}

export function packagedRegistryDir(): string {
  const distPath = fileURLToPath(new URL("./examples/demo-aesthetics", import.meta.url));
  if (existsSync(distPath)) return distPath;
  return fileURLToPath(new URL("../examples/demo-aesthetics", import.meta.url));
}

function hasRegistryDocuments(directory: string): boolean {
  if (!existsSync(directory)) return false;
  return readdirSync(directory).some((name) => /^(template|modifier|palette|composition)\.[a-z0-9_-]+\.json$/i.test(name));
}

function seedRegistryIfEmpty(directory: string): void {
  if (hasRegistryDocuments(directory)) return;
  cpSync(packagedRegistryDir(), directory, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter(source) {
      return !source.endsWith("README.md");
    },
  });
}

function manifestDiagnostics(project: LoadedProject, validator: Validator): RegistryDiagnostic[] {
  const diagnostics: RegistryDiagnostic[] = [];
  for (const [provider, manifest] of Object.entries(project.manifests)) {
    const result = validator.validate(manifest, "capability-manifest");
    if (!result.valid) {
      diagnostics.push({
        code: "schema_failure",
        kind: "capability-manifest",
        id: provider,
        message: `capability manifest "${provider}" failed schema validation`,
        errors: result.errors.map((e) => ({ path: e.path, message: e.message })),
      });
    }
  }
  return diagnostics;
}

export function registryDiagnostics(project: LoadedProject, validator: Validator): RegistryDiagnostic[] {
  return [
    ...validateRegistry(project.registry, { validator }),
    ...manifestDiagnostics(project, validator),
  ];
}

function emptyProject(): LoadedProject {
  return {
    registry: { templates: {}, modifiers: {}, palettes: {}, compositions: {} },
    manifests: {},
    strategies: {},
  };
}

function isProviderAdapter(value: unknown): value is ProviderAdapter {
  if (typeof value !== "object" || value === null) return false;
  const adapter = value as Partial<ProviderAdapter>;
  return (
    typeof adapter.id === "string" &&
    typeof adapter.version === "string" &&
    typeof adapter.manifest === "function" &&
    typeof adapter.emit === "function" &&
    typeof adapter.execute === "function"
  );
}

function packageParts(packageName: string): string[] {
  return packageName.split("/");
}

function optionalPackageEntrypoint(packageName: string): string | undefined {
  let directory = dirname(fileURLToPath(import.meta.url));
  const parts = packageParts(packageName);
  while (true) {
    const candidate = join(directory, "node_modules", ...parts, "dist", "index.js");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

async function optionalAdapter(packageName: string, exportName: string): Promise<ProviderAdapter | undefined> {
  const entrypoint = optionalPackageEntrypoint(packageName);
  if (entrypoint === undefined) return undefined;
  try {
    const mod = await import(pathToFileURL(entrypoint).href) as Record<string, unknown>;
    const adapter = mod[exportName];
    return isProviderAdapter(adapter) ? adapter : undefined;
  } catch (e) {
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code?: unknown }).code : undefined;
    if (
      e instanceof Error &&
      (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND" || code === "ERR_PACKAGE_PATH_NOT_EXPORTED")
    ) {
      return undefined;
    }
    throw e;
  }
}

function providerAdapters(): Record<string, ProviderAdapter> {
  return {
    [openaiAdapter.id]: openaiAdapter,
    [fluxAdapter.id]: fluxAdapter,
    [sdxlAdapter.id]: sdxlAdapter,
  };
}

export async function loadOptionalProviderAdapters(ctx: ToolContext): Promise<void> {
  const optional = await Promise.all([
    optionalAdapter("@mosvera/provider-heygen", "heygenAdapter"),
    optionalAdapter("@mosvera/provider-google", "googleGeminiImageAdapter"),
    optionalAdapter("@mosvera/provider-google", "googleVeoVideoAdapter"),
    optionalAdapter("@mosvera/provider-runway", "runwayGen4ImageAdapter"),
    optionalAdapter("@mosvera/provider-runway", "runwayGen45VideoAdapter"),
    optionalAdapter("@mosvera/provider-elevenlabs", "elevenLabsTtsAdapter"),
    optionalAdapter("@mosvera/provider-firefly", "fireflyImageAdapter"),
    optionalAdapter("@mosvera/provider-meshy", "meshyTextTo3DAdapter"),
  ]);
  ctx.adapters = {
    ...(ctx.adapters ?? {}),
    ...Object.fromEntries(optional.filter((adapter): adapter is ProviderAdapter => adapter !== undefined).map((adapter) => [adapter.id, adapter])),
  };
}

function loadProjectOrEmpty(directory: string, validator: Validator): LoadedProject {
  if (!existsSync(directory)) return emptyProject();
  if (!statSync(directory).isDirectory()) {
    throw new Error(`registry path is not a directory: ${directory}`);
  }
  return loadProject(directory, { validator });
}

function makeContext(
  registryDir: string,
  project: LoadedProject,
  validator: Validator,
  options: {
    registryWritable: boolean;
    readOnlyMode: boolean;
    fallbackRegistry: boolean;
    fallbackReason?: string;
    loadDiagnostics?: RegistryDiagnostic[];
  },
): ToolContext {
  const ctx: ToolContext = {
    registryDir,
    registryWritable: options.registryWritable,
    readOnlyMode: options.readOnlyMode,
    fallbackRegistry: options.fallbackRegistry,
    loadDiagnostics: options.loadDiagnostics ?? [],
    project,
    validator,
    baseStrategies: composeStrategies(deriveStrategies(), project.strategies),
    adapters: providerAdapters(),
  };
  if (options.fallbackReason !== undefined) ctx.fallbackReason = options.fallbackReason;
  return ctx;
}

export function reloadContext(ctx: ToolContext): void {
  const project = loadProject(ctx.registryDir, { validator: ctx.validator });
  ctx.project = project;
  ctx.baseStrategies = composeStrategies(deriveStrategies(), project.strategies);
  ctx.loadDiagnostics = [];
}

export function buildContext(input: string | BuildContextOptions = {}): ToolContext {
  const options = typeof input === "string" ? { registryDir: input } : input;
  const validator = createValidator();
  const requestedRegistry = options.registryDir;
  const registryDir = resolve(requestedRegistry ?? defaultRegistryDir());
  const readOnlyMode = options.readOnlyMode ?? false;

  if (readOnlyMode) {
    const readOnlyDir = resolve(requestedRegistry ?? packagedRegistryDir());
    const project = loadProjectOrEmpty(readOnlyDir, validator);
    return makeContext(readOnlyDir, project, validator, {
      registryWritable: false,
      readOnlyMode: true,
      fallbackRegistry: false,
    });
  }

  try {
    mkdirSync(registryDir, { recursive: true });
    seedRegistryIfEmpty(registryDir);
    const project = loadProject(registryDir, { validator });
    return makeContext(registryDir, project, validator, {
      registryWritable: true,
      readOnlyMode: false,
      fallbackRegistry: false,
    });
  } catch (e) {
    const fallbackDir = packagedRegistryDir();
    const project = loadProject(fallbackDir, { validator });
    const diagnostics =
      e instanceof RegistryProjectError ? e.diagnostics :
      [{ code: "unsafe_filename", message: e instanceof Error ? e.message : String(e) } as RegistryDiagnostic];
    return makeContext(fallbackDir, project, validator, {
      registryWritable: false,
      readOnlyMode: true,
      fallbackRegistry: true,
      fallbackReason: e instanceof Error ? e.message : String(e),
      loadDiagnostics: diagnostics,
    });
  }
}

export function bundleRoot(): string {
  return dirname(dirname(packagedRegistryDir()));
}
