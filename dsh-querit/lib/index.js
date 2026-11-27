import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { DEFAULT_FETCH_MAX_OUTPUT_CHARS, DEFAULT_WEB_TOOL_TIMEOUT_MS, applyWebFetchTool, } from "@deepseek-ai/dsh-tool-web";
import { DEFAULT_REQUEST_TIMEOUT_MS, QUERIT_API_BASE_URL, QUERIT_CONTENT_MAX_CHARS_LIMIT, QUERIT_COUNT_LIMIT, RANK_VALUES, RESOURCE_TAG_VALUES, VERTICAL_VALUES, } from "./client.js";
import { COUNTRY_VALUES, LANGUAGE_VALUES, QueritFetchProvider, QueritSearchProvider, isTimeRange, normalizeDomains, } from "./provider.js";
// The providers leave through the package entry for scripts that drive them directly.
export { QueritFetchProvider, QueritSearchProvider } from "./provider.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = "web-search-querit";
/** Only the web seam is required; the optional `web_fetch` tool injects its own registries. */
export const inject = ["web"];
export const DEFAULT_API_KEY_ENV = "QUERIT_API_KEY";
const BASE_URL_ENV = "QUERIT_BASE_URL";
export const Config = z.object({
    apiKey: z.string().role("secret").volatile(),
    apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV).volatile(),
    baseURL: z.string().volatile(),
    timeoutMs: z.number().step(1).min(1_000).default(DEFAULT_REQUEST_TIMEOUT_MS).volatile(),
    count: z.number().step(1).min(1).max(QUERIT_COUNT_LIMIT).volatile(),
    timeRange: z.string().volatile(),
    countries: z.array(z.string()).volatile(),
    languages: z.array(z.string()).volatile(),
    includeDomains: z.array(z.string()).volatile(),
    excludeDomains: z.array(z.string()).volatile(),
    includeContent: z.boolean().default(false).volatile(),
    contentMaxChars: z.number().step(1).min(1).max(QUERIT_CONTENT_MAX_CHARS_LIMIT).volatile(),
    highlights: z.boolean().default(false).volatile(),
    needMarkdown: z.boolean().default(false).volatile(),
    chunksPerDoc: z.number().step(1).min(1).max(3).volatile(),
    rank: z.string().volatile(),
    vertical: z.string().volatile(),
    resourceTags: z.array(z.string()).volatile(),
    fetchFormat: z.union([z.const("markdown"), z.const("text"), z.const("html")]).default("markdown").volatile(),
    fetchCrawlTimeout: z.number().step(1).min(1).max(60).default(10).volatile(),
    fetchMaxChars: z.number().step(1).min(256).default(8_000).volatile(),
    fetch: z.boolean().default(false).volatile(),
    fetchTimeoutMs: z.number().step(1).min(1_000).default(DEFAULT_WEB_TOOL_TIMEOUT_MS).volatile(),
    fetchMaxOutputChars: z.number().step(1).min(256).default(DEFAULT_FETCH_MAX_OUTPUT_CHARS).volatile(),
});
/**
 * Project one read of the config into the options both providers serve their
 * next operation with. Every value is fully defaulted, so the providers never
 * branch on absence.
 */
export function resolveOptions(ctx, config) {
    const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
    const literalApiKey = config.apiKey !== undefined && config.apiKey.trim().length > 0
        ? config.apiKey.trim()
        : undefined;
    const timeRange = normalizeTimeRange(config.timeRange);
    return {
        ...(literalApiKey === undefined ? {} : { apiKey: literalApiKey }),
        resolveApiKey: () => resolveQueritApiKey(ctx, apiKeyEnv),
        apiKeyConfigured: () => queritApiKeyConfigured(ctx, apiKeyEnv),
        apiKeyEnv,
        baseURL: (config.baseURL ?? launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value ?? QUERIT_API_BASE_URL).replace(/\/+$/, ""),
        timeoutMs: config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        ...(config.count === undefined ? {} : { count: config.count }),
        ...(timeRange === undefined ? {} : { timeRange }),
        countries: normalizeEnumList(config.countries, COUNTRY_VALUES),
        languages: normalizeEnumList(config.languages, LANGUAGE_VALUES),
        includeDomains: normalizeDomains(config.includeDomains),
        excludeDomains: normalizeDomains(config.excludeDomains),
        includeContent: config.includeContent ?? false,
        ...(config.contentMaxChars === undefined ? {} : { contentMaxChars: config.contentMaxChars }),
        highlights: config.highlights ?? false,
        needMarkdown: config.needMarkdown ?? false,
        ...(config.chunksPerDoc === undefined ? {} : { chunksPerDoc: config.chunksPerDoc }),
        rank: normalizeEnum(config.rank, RANK_VALUES),
        vertical: normalizeEnum(config.vertical, VERTICAL_VALUES),
        resourceTags: normalizeEnumList(config.resourceTags, RESOURCE_TAG_VALUES),
        fetchFormat: config.fetchFormat ?? "markdown",
        fetchCrawlTimeout: config.fetchCrawlTimeout ?? 10,
        fetchMaxChars: config.fetchMaxChars ?? 8_000,
        observe: (event) => {
            // Querit asks for search_id, took, and cost on every operation: support
            // traces a request by the id alone, and an absent cost is never "free".
            const fields = [
                event.searchId === undefined ? "" : `search_id=${event.searchId}`,
                event.took === undefined ? "" : `took=${event.took}`,
                event.cost === undefined ? "cost=n/a" : `cost=${event.cost}`,
            ].filter(Boolean);
            ctx.logger.info(`web-search-querit: ${event.operation} ${fields.join(" ")}`);
        },
    };
}
/** Register both Querit providers with `ctx.web`, the optional `web_fetch` tool, and the first-load key check. */
export function apply(ctx, config) {
    const current = () => ({
        apiKey: config.apiKey.get(),
        apiKeyEnv: config.apiKeyEnv.get(),
        baseURL: config.baseURL.get(),
        timeoutMs: config.timeoutMs.get(),
        count: config.count.get(),
        timeRange: config.timeRange.get(),
        countries: config.countries.get(),
        languages: config.languages.get(),
        includeDomains: config.includeDomains.get(),
        excludeDomains: config.excludeDomains.get(),
        includeContent: config.includeContent.get(),
        contentMaxChars: config.contentMaxChars.get(),
        highlights: config.highlights.get(),
        needMarkdown: config.needMarkdown.get(),
        chunksPerDoc: config.chunksPerDoc.get(),
        rank: config.rank.get(),
        vertical: config.vertical.get(),
        resourceTags: config.resourceTags.get(),
        fetchFormat: config.fetchFormat.get(),
        fetchCrawlTimeout: config.fetchCrawlTimeout.get(),
        fetchMaxChars: config.fetchMaxChars.get(),
        fetch: config.fetch.get(),
        fetchTimeoutMs: config.fetchTimeoutMs.get(),
        fetchMaxOutputChars: config.fetchMaxOutputChars.get(),
    });
    const options = () => resolveOptions(ctx, current());
    const search = new QueritSearchProvider(options);
    const fetch = new QueritFetchProvider(options);
    ctx.web.registerSearchProvider({
        id: search.id,
        title: search.title,
        description: search.description,
        available: () => search.available(),
        ready: () => search.ready(),
        search: (request, signal) => search.search(request, signal),
    });
    ctx.web.registerFetchProvider({
        id: fetch.id,
        title: fetch.title,
        description: fetch.description,
        available: () => fetch.available(),
        ready: () => fetch.ready(),
        fetch: (request, signal) => fetch.fetch(request, signal),
    });
    // This package ships its own page (`plugins.row.config`), so it opts out of
    // the host generating one from the schema.
    ctx.inject(["settings"], (child) => {
        child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
    });
    // The model-facing web_fetch tool. Since dsh 0.1.2 the base composition and
    // agent presets register `web_fetch` through their own `tool-web` rows (both
    // web tools route through `ctx.web`, hence Querit), so this opt-in covers
    // only compositions where no other row provides the tool.
    if (config.fetch.get() === true) {
        const { fetchTimeoutMs, fetchMaxOutputChars } = current();
        ctx.inject(["tools", "systemPrompt"], (child) => {
            applyWebFetchTool(child, fetchTimeoutMs ?? DEFAULT_WEB_TOOL_TIMEOUT_MS, fetchMaxOutputChars ?? DEFAULT_FETCH_MAX_OUTPUT_CHARS);
        });
    }
    // First-load configuration prompt: the loudest surface a starting host has
    // is its log. The probe never blocks loading and never throws; a search
    // without a key still fails per call with the actionable
    // WEB_PROVIDER_CREDENTIAL_MISSING message.
    void (async () => {
        try {
            const start = current();
            const apiKeyEnv = credentialRef(start.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
            const configured = (await resolveQueritApiKey(ctx, apiKeyEnv)) !== undefined
                || (start.apiKey?.trim().length ?? 0) > 0;
            if (!configured) {
                ctx.logger.warn(`web-search-querit: Querit web search is not configured yet — searches will fail until a key is provided. `
                    + `Open the Querit row's page in Settings, or in priority order: set "apiKey" on the web-search-querit row, `
                    + `add ${apiKeyEnv} to the credentials store, or (only where no credentials service runs) export `
                    + `${apiKeyEnv} in the launching environment. See the dsh-querit README for details.`);
            }
        }
        catch {
            // Probe-only; provider calls surface credential failures with full detail.
        }
    })();
}
/**
 * Resolve the Querit API key for one operation. An installed credentials
 * service is authoritative, including absence, as it is for the host's own
 * providers; only deployments without that service read the launching
 * environment.
 */
export async function resolveQueritApiKey(ctx, apiKeyEnv) {
    const credentials = ctx.get("credentials");
    if (credentials !== undefined) {
        const stored = await credentials.resolve(apiKeyEnv);
        return stored !== undefined && stored.value.length > 0 ? stored.value : undefined;
    }
    const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
    return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined;
}
/** Whether a key is configured, without resolving the stored value. */
export async function queritApiKeyConfigured(ctx, apiKeyEnv) {
    const credentials = ctx.get("credentials");
    return credentials === undefined
        ? (launchEnvironmentOf(ctx).get(apiKeyEnv)?.value.length ?? 0) > 0
        : (await credentials.describe(apiKeyEnv)).configured;
}
function normalizeTimeRange(value) {
    const trimmed = value?.trim();
    return trimmed !== undefined && isTimeRange(trimmed) ? trimmed : undefined;
}
function normalizeEnumList(values, allowed) {
    const allowedSet = new Set(allowed);
    const matched = new Set();
    for (const entry of values ?? []) {
        const normalized = entry.trim().toLowerCase();
        if (allowedSet.has(normalized))
            matched.add(normalized);
    }
    return [...matched];
}
function normalizeEnum(value, allowed) {
    return normalizeEnumList(value === undefined ? undefined : [value], allowed)[0];
}
