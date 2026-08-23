import { runCli } from "../src/cli.js";

const requiredVariables = ["QUERIT_API_KEY", "BROWSERBASE_API_KEY"] as const;
const missingVariables = requiredVariables.filter((name) => !process.env[name]?.trim());

if (missingVariables.length > 0) {
  throw new Error(`Live smoke requires environment variables: ${missingVariables.join(", ")}.`);
}

process.exitCode = await runCli({
  args: ["Browserbase Playwright connectOverCDP official documentation"],
});
