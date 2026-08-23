export const CLAUDE_PLUGIN_API_KEY_ENV = "CLAUDE_PLUGIN_OPTION_API_KEY";
export const LOCAL_API_KEY_ENV = "QUERIT_API_KEY";

const UNEXPANDED_PLUGIN_API_KEY = "${user_config.api_key}";

/** Resolve credentials per operation so local environment changes are visible. */
export function resolveQueritApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const pluginKey = env[CLAUDE_PLUGIN_API_KEY_ENV]?.trim();
  if (pluginKey && pluginKey !== UNEXPANDED_PLUGIN_API_KEY) return pluginKey;

  const localKey = env[LOCAL_API_KEY_ENV]?.trim();
  return localKey || undefined;
}

export function missingApiKeyMessage(): string {
  return [
    "Querit is not configured.",
    "Set the required api_key plugin option in Claude Code,",
    `or set ${LOCAL_API_KEY_ENV} when developing locally.`,
  ].join(" ");
}
