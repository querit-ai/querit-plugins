import { QueritApiError, QueritClient } from "../src/client.js";
import { getQueritConfigPath, resolveQueritApiKey } from "../src/config.js";

const configPath = getQueritConfigPath();
const apiKey = await resolveQueritApiKey({ configPath });
if (!apiKey) {
  throw new Error(`Querit is not configured. Run /querit-setup or set QUERIT_API_KEY. Expected config: ${configPath}`);
}

const client = new QueritClient({ apiKey });
const search = await client.search({
  query: "Pi coding agent",
  count: 2,
});

if (search.results.length === 0) {
  throw new Error("Querit search succeeded but returned no results for the smoke-test query.");
}

console.log(`Querit search smoke test passed: results=${search.results.length}, searchId=${search.searchId ?? "n/a"}`);

const targetUrl = search.results[0]?.url;
if (!targetUrl) throw new Error("Querit search returned a result without a usable URL.");

try {
  const contents = await client.contents({
    urls: [targetUrl],
    format: "markdown",
    crawlTimeout: 20,
    extrasMeta: true,
  });

  if (contents.results.length === 0) {
    throw new Error("Querit contents succeeded but returned no page content.");
  }

  console.log(`Querit contents smoke test passed: results=${contents.results.length}, searchId=${contents.searchId ?? "n/a"}`);
} catch (error) {
  if (error instanceof QueritApiError) {
    console.error(`Querit contents smoke test failed: status=${error.status ?? "n/a"}, searchId=${error.searchId ?? "n/a"}, message=${error.message}`);
  } else {
    console.error(`Querit contents smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
}
