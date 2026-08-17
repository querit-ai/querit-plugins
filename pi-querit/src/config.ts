import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";

export const QUERIT_CONFIG_FILE = "querit-search.json";

export type SearchWorkflow = "raw" | "summary";

export const THINKING_LEVEL_VALUES = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type QueritThinkingLevel = (typeof THINKING_LEVEL_VALUES)[number];

export const COUNTRY_VALUES = [
  "argentina",
  "australia",
  "brazil",
  "canada",
  "colombia",
  "france",
  "germany",
  "india",
  "indonesia",
  "japan",
  "mexico",
  "nigeria",
  "philippines",
  "south korea",
  "spain",
  "united kingdom",
  "united states",
] as const;

export const LANGUAGE_VALUES = [
  "english",
  "japanese",
  "korean",
  "german",
  "french",
  "spanish",
  "portuguese",
] as const;

export type QueritCountry = (typeof COUNTRY_VALUES)[number];
export type QueritLanguage = (typeof LANGUAGE_VALUES)[number];

export interface QueritSearchDefaults {
  count?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  timeRange?: string;
  countries?: QueritCountry[];
  languages?: QueritLanguage[];
  includeContent?: boolean;
  chunksPerDoc?: number;
}

export interface QueritConfig {
  apiKey: string;
  defaultWorkflow?: SearchWorkflow;
  summaryModel?: string;
  summaryThinkingLevel?: QueritThinkingLevel;
  search?: QueritSearchDefaults;
}

export interface QueritConfigSettings {
  defaultWorkflow?: SearchWorkflow;
  summaryModel?: string;
  summaryThinkingLevel?: QueritThinkingLevel;
  search?: QueritSearchDefaults;
}

export interface ApiKeyResolutionOptions {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}

export function getQueritConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, QUERIT_CONFIG_FILE);
}

export async function loadQueritConfig(configPath = getQueritConfigPath()): Promise<QueritConfig | undefined> {
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw new Error(`Could not read Querit configuration at ${configPath}: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Querit configuration at ${configPath} is not valid JSON.`, { cause: error });
  }

  if (!isRecord(parsed) || typeof parsed.apiKey !== "string" || !parsed.apiKey.trim()) {
    throw new Error(`Querit configuration at ${configPath} must contain a non-empty "apiKey" string.`);
  }

  const defaultWorkflow = parsed.defaultWorkflow === "raw" || parsed.defaultWorkflow === "summary"
    ? parsed.defaultWorkflow
    : undefined;
  const summaryModel = typeof parsed.summaryModel === "string" && isModelReference(parsed.summaryModel)
    ? parsed.summaryModel.trim()
    : undefined;
  const summaryThinkingLevel = isThinkingLevel(parsed.summaryThinkingLevel) ? parsed.summaryThinkingLevel : undefined;
  const search = parseSearchDefaults(parsed.search);

  return {
    apiKey: parsed.apiKey.trim(),
    ...(defaultWorkflow === undefined ? {} : { defaultWorkflow }),
    ...(summaryModel === undefined ? {} : { summaryModel }),
    ...(summaryThinkingLevel === undefined ? {} : { summaryThinkingLevel }),
    ...(search === undefined ? {} : { search }),
  };
}

export async function resolveQueritApiKey(options: ApiKeyResolutionOptions = {}): Promise<string | undefined> {
  const environmentKey = (options.env ?? process.env).QUERIT_API_KEY?.trim();
  if (environmentKey) return environmentKey;

  const config = await loadQueritConfig(options.configPath ?? getQueritConfigPath());
  return config?.apiKey || undefined;
}

export async function saveQueritConfig(
  apiKey: string,
  configPath = getQueritConfigPath(),
  settings: QueritConfigSettings = {},
): Promise<void> {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) throw new Error("Cannot save an empty Querit API key.");
  if (settings.defaultWorkflow !== undefined && settings.defaultWorkflow !== "raw" && settings.defaultWorkflow !== "summary") {
    throw new Error("Cannot save an invalid Querit default workflow.");
  }
  const summaryModel = settings.summaryModel?.trim();
  if (summaryModel !== undefined && !isModelReference(summaryModel)) {
    throw new Error("Cannot save an invalid Querit summary model reference.");
  }
  const summaryThinkingLevel = settings.summaryThinkingLevel;
  if (summaryThinkingLevel !== undefined && !isThinkingLevel(summaryThinkingLevel)) {
    throw new Error("Cannot save an invalid Querit summary thinking level.");
  }
  const search = settings.search === undefined ? undefined : parseSearchDefaults(settings.search);
  const serializedConfig: QueritConfig = {
    apiKey: normalizedKey,
    ...(settings.defaultWorkflow === undefined ? {} : { defaultWorkflow: settings.defaultWorkflow }),
    ...(summaryModel === undefined ? {} : { summaryModel }),
    ...(summaryThinkingLevel === undefined ? {} : { summaryThinkingLevel }),
    ...(search === undefined ? {} : { search }),
  };

  await mkdir(dirname(configPath), { recursive: true });
  await withFileMutationQueue(configPath, async () => {
    const temporaryPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(serializedConfig, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, configPath);
      if (process.platform !== "win32") {
        await chmod(configPath, 0o600);
      }
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  });
}

function isModelReference(value: string): boolean {
  const normalized = value.trim();
  const slash = normalized.indexOf("/");
  return slash > 0 && slash < normalized.length - 1 && !/\s/u.test(normalized);
}

function isThinkingLevel(value: unknown): value is QueritThinkingLevel {
  return typeof value === "string" && (THINKING_LEVEL_VALUES as readonly string[]).includes(value);
}

export function parseSearchDefaults(value: unknown): QueritSearchDefaults | undefined {
  if (!isRecord(value)) return undefined;
  const defaults: QueritSearchDefaults = {};

  if (isIntegerInRange(value.count, 1, 20)) defaults.count = value.count;
  if (isIntegerInRange(value.chunksPerDoc, 1, 3)) defaults.chunksPerDoc = value.chunksPerDoc;
  if (typeof value.includeContent === "boolean") defaults.includeContent = value.includeContent;
  if (typeof value.timeRange === "string" && value.timeRange.trim()) {
    defaults.timeRange = value.timeRange.trim().slice(0, 64);
  }

  const includeDomains = parseDomainList(value.includeDomains);
  if (includeDomains !== undefined) defaults.includeDomains = includeDomains;
  const excludeDomains = parseDomainList(value.excludeDomains);
  if (excludeDomains !== undefined) defaults.excludeDomains = excludeDomains;
  const countries = parseEnumList(value.countries, COUNTRY_VALUES);
  if (countries !== undefined) defaults.countries = countries;
  const languages = parseEnumList(value.languages, LANGUAGE_VALUES);
  if (languages !== undefined) defaults.languages = languages;

  return Object.keys(defaults).length > 0 ? defaults : undefined;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function parseDomainList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const domains = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const domain = entry.trim().toLowerCase();
    if (!domain || domain.length > 253 || /\s/u.test(domain) || !domain.includes(".")) continue;
    domains.add(domain);
    if (domains.size >= 20) break;
  }
  return domains.size > 0 ? [...domains] : undefined;
}

function parseEnumList<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowedSet = new Set<string>(allowed);
  const matched = new Set<T>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim().toLowerCase();
    if (allowedSet.has(normalized)) matched.add(normalized as T);
  }
  return matched.size > 0 ? [...matched] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
