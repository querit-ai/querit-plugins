import { safeErrorMessage } from "./security.js";

export type IntegrationErrorCode =
  | "BROWSERBASE_API_ERROR"
  | "BROWSER_CLEANUP_FAILED"
  | "BROWSER_VERIFICATION_FAILED"
  | "INVALID_CONFIGURATION"
  | "INVALID_QUERY"
  | "NO_RESULTS"
  | "NO_SAFE_RESULT"
  | "QUERIT_API_ERROR";

export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode;

  constructor(code: IntegrationErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "IntegrationError";
    this.code = code;
  }
}

export function wrapIntegrationError(
  code: IntegrationErrorCode,
  prefix: string,
  error: unknown,
  secrets: readonly string[] = [],
): IntegrationError {
  if (error instanceof IntegrationError) return error;
  return new IntegrationError(code, `${prefix}: ${safeErrorMessage(error, secrets)}`, { cause: error });
}
