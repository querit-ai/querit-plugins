import { QueritApiError, QueritClient, formatCost } from "../src/client.js";
import { getQueritConfigPath, resolveQueritApiKey } from "../src/config.js";

const configPath = getQueritConfigPath();
const apiKey = await resolveQueritApiKey({ configPath });
if (!apiKey) {
  throw new Error(`Querit is not configured. Run /querit-setup or set QUERIT_API_KEY. Expected config: ${configPath}`);
}

const costOf = (cost: { currency: string; total: number } | undefined) => (cost ? formatCost(cost) : "n/a");

const client = new QueritClient({ apiKey });
const search = await client.search({
  query: "Pi coding agent",
  count: 2,
  highlights: true,
});

if (search.results.length === 0) {
  throw new Error("Querit search succeeded but returned no results for the smoke-test query.");
}

console.log(
  `Querit search smoke test passed: results=${search.results.length}, `
  + `highlights=${search.results.filter((result) => result.highlights.length > 0).length}, `
  + `searchId=${search.searchId ?? "n/a"}, cost=${costOf(search.cost)}`,
);

const targetUrl = search.results[0]?.url;
if (!targetUrl) throw new Error("Querit search returned a result without a usable URL.");

try {
  const contents = await client.contents({
    urls: [targetUrl],
    format: "markdown",
    crawlTimeout: 20,
    extrasMeta: true,
    highlights: { maxCharacters: 300 },
  });

  if (contents.results.length === 0) {
    throw new Error("Querit contents succeeded but returned no page content.");
  }

  console.log(
    `Querit contents smoke test passed: results=${contents.results.length}, `
    + `highlights=${contents.results[0]?.highlights.length ?? 0}, `
    + `searchId=${contents.searchId ?? "n/a"}, cost=${costOf(contents.cost)}`,
  );
} catch (error) {
  if (error instanceof QueritApiError) {
    console.error(`Querit contents smoke test failed: status=${error.status ?? "n/a"}, searchId=${error.searchId ?? "n/a"}, message=${error.message}`);
  } else {
    console.error(`Querit contents smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
}
