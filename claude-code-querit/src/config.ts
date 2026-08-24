export const LOCAL_API_KEY_ENV = "QUERIT_API_KEY";

/** Resolve the credential per call so environment changes are visible. */
export function resolveQueritApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = env[LOCAL_API_KEY_ENV]?.trim();
  return key || undefined;
}

export function missingApiKeyMessage(): string {
  return [
    "Querit is not configured.",
    `Set the ${LOCAL_API_KEY_ENV} environment variable`,
    "and restart Claude Code so the MCP server inherits it.",
  ].join(" ");
}
