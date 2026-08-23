import { QueritApiError, QueritClient } from "../src/client.js";
import { resolveQueritApiKey } from "../src/config.js";
import { safeErrorMessage } from "../src/sanitize.js";

if (process.env.QUERIT_LIVE_SMOKE !== "1") {
  process.stdout.write("Querit live smoke test skipped; set QUERIT_LIVE_SMOKE=1 to enable it.\n");
} else {
  const apiKey = resolveQueritApiKey();
  if (!apiKey) {
    throw new Error("Querit live smoke test requires QUERIT_API_KEY for local development.");
  }

  try {
    const client = new QueritClient({ apiKey });
    const search = await client.search({
      query: "Claude Code coding agent",
      count: 2,
      chunksPerDoc: 1,
      needContent: false,
    });

    if (search.results.length === 0) {
      throw new Error("Querit search succeeded but returned no results for the smoke-test query.");
    }
    process.stdout.write(`Querit search smoke test passed: results=${search.results.length}.\n`);

    const targetUrl = search.results[0]?.url;
    if (!targetUrl) throw new Error("Querit search returned no usable result URL.");

    const contents = await client.contents({
      urls: [targetUrl],
      format: "markdown",
      crawlTimeout: 20,
      extrasMeta: true,
    });
    if (contents.results.length === 0) {
      throw new Error("Querit contents succeeded but returned no page content.");
    }
    process.stdout.write(`Querit contents smoke test passed: results=${contents.results.length}.\n`);
  } catch (error) {
    const status = error instanceof QueritApiError && error.status !== undefined
      ? ` status=${error.status}.`
      : "";
    process.stderr.write(`Querit live smoke test failed.${status} ${safeErrorMessage(error, [apiKey])}\n`);
    process.exitCode = 1;
  }
}
