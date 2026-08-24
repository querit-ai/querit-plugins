export const CLAUDE_PLUGIN_API_KEY_ENV = "CLAUDE_PLUGIN_OPTION_API_KEY";
export const LOCAL_API_KEY_ENV = "QUERIT_API_KEY";

const UNEXPANDED_PLUGIN_API_KEY = "${user_config.api_key}";

/**
 * Resolve credentials per operation so environment changes are visible.
 * QUERIT_API_KEY wins over the plugin option; an unexpanded userConfig
 * placeholder is never treated as a key.
 */
export function resolveQueritApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const localKey = env[LOCAL_API_KEY_ENV]?.trim();
  if (localKey) return localKey;

  const pluginKey = env[CLAUDE_PLUGIN_API_KEY_ENV]?.trim();
  if (pluginKey && pluginKey !== UNEXPANDED_PLUGIN_API_KEY) return pluginKey;

  return undefined;
}

export function missingApiKeyMessage(): string {
  return [
    "Querit is not configured.",
    `Set the ${LOCAL_API_KEY_ENV} environment variable,`,
    "or the api_key plugin option in Claude Code.",
  ].join(" ");
}
