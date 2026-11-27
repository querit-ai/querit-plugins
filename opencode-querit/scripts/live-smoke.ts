import { QueritApiError, QueritClient, formatCost } from "../src/client.js";
import { resolveConfig, resolveQueritApiKey } from "../src/config.js";
import { createQueritFetchTool, createQueritWebSearchProvider } from "../src/index.js";

const config = resolveConfig({});
const apiKey = resolveQueritApiKey(config);
if (!apiKey) {
  throw new Error(
    `Querit is not configured. Set the ${config.apiKeyEnv} environment variable or pass "apiKey" in the opencode-querit plugin options.`,
  );
}

const client = new QueritClient({ apiKey, baseUrl: config.baseURL, timeoutMs: config.timeoutMs });
const search = await client.search({
  query: "OpenCode AI coding agent",
  count: 2,
});

if (search.results.length === 0) {
  throw new Error("Querit search succeeded but returned no results for the smoke-test query.");
}

// An absent cost means Querit did not report one; it is never a zero charge.
const costLabel = (cost: { currency: string; total: number } | undefined) => (cost ? formatCost(cost) : "unavailable");

console.log(`Querit search smoke test passed: results=${search.results.length}, searchId=${search.searchId ?? "n/a"}, cost=${costLabel(search.cost)}`);

// Exercise the v2 websearch provider path (built-in websearch tool routing).
const provider = createQueritWebSearchProvider({ apiKey });
const providerResults = await provider.execute(
  { query: "Querit web search API" },
  { signal: AbortSignal.timeout(config.timeoutMs) },
);
if (providerResults.length === 0 || !providerResults[0]?.url) {
  throw new Error("websearch provider returned no results with a usable URL.");
}
console.log(`websearch provider smoke test passed: results=${providerResults.length}, first=${providerResults[0]?.url}`);

const targetUrl = search.results[0]?.url;
if (!targetUrl) throw new Error("Querit search returned a result without a usable URL.");

// Exercise the v2 web_fetch tool path.
const tool = createQueritFetchTool({ apiKey });
try {
  const result = await tool.execute(
    { url: targetUrl },
    // What the host hands a tool: the call's abort signal and a progress reporter.
    { signal: AbortSignal.timeout(config.timeoutMs), progress: async () => undefined },
  );
  const metadata = result.metadata as { resultCount?: number; searchId?: string; cost?: { currency: string; total: number } };
  if (!metadata.resultCount) {
    throw new Error("Querit contents succeeded but returned no page content.");
  }

  console.log(`web_fetch tool smoke test passed: results=${metadata.resultCount}, searchId=${metadata.searchId ?? "n/a"}, cost=${costLabel(metadata.cost)}`);
} catch (error) {
  if (error instanceof QueritApiError) {
    console.error(`Querit contents smoke test failed: status=${error.status ?? "n/a"}, searchId=${error.searchId ?? "n/a"}, message=${error.message}`);
  } else {
    console.error(`Querit contents smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
}
