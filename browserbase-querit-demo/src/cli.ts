import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLiveAdapters } from "./adapters.js";
import { runDemo } from "./demo.js";
import { IntegrationError } from "./errors.js";
import { safeErrorMessage, stringifyRedactedJson } from "./security.js";
import type { DemoAdapters } from "./types.js";

const USAGE = [
  "Usage: npm start -- \"<search query>\"",
  "Required environment variables: QUERIT_API_KEY, BROWSERBASE_API_KEY",
].join("\n");

interface OutputWriter {
  write(chunk: string): unknown;
}

export interface CliOptions {
  adapterFactory?: (keys: { browserbaseApiKey: string; queritApiKey: string }) => DemoAdapters;
  args?: readonly string[];
  artifactPath?: string;
  env?: Readonly<Record<string, string | undefined>>;
  stderr?: OutputWriter;
  stdout?: OutputWriter;
}

export async function runCli(options: CliOptions = {}): Promise<number> {
  const args = options.args ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    stdout.write(`${USAGE}\n`);
    return 0;
  }

  const query = args.join(" ").trim();
  const queritApiKey = env.QUERIT_API_KEY?.trim() ?? "";
  const browserbaseApiKey = env.BROWSERBASE_API_KEY?.trim() ?? "";
  const secrets = [queritApiKey, browserbaseApiKey];

  try {
    if (!query) throw new IntegrationError("INVALID_QUERY", USAGE);

    const missing = [
      ...(queritApiKey ? [] : ["QUERIT_API_KEY"]),
      ...(browserbaseApiKey ? [] : ["BROWSERBASE_API_KEY"]),
    ];
    if (missing.length > 0) {
      throw new IntegrationError(
        "INVALID_CONFIGURATION",
        `Missing required environment variables: ${missing.join(", ")}.`,
      );
    }

    const adapters = (options.adapterFactory ?? createLiveAdapters)({
      browserbaseApiKey,
      queritApiKey,
    });
    const summary = await runDemo(
      {
        query,
        ...(options.artifactPath === undefined ? {} : { artifactPath: options.artifactPath }),
      },
      adapters,
    );

    stdout.write(`${stringifyRedactedJson(summary, secrets)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof IntegrationError ? error.code : "INTEGRATION_FAILED";
    stderr.write(`${stringifyRedactedJson({ error: { code, message: safeErrorMessage(error, secrets) } }, secrets)}\n`);
    return 1;
  }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isDirectExecution()) {
  process.exitCode = await runCli();
}
