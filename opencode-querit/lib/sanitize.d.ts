/**
 * Remove terminal escape/control sequences from untrusted remote text.
 * Newlines and tabs are preserved so page content remains readable.
 * Ported from pi-querit / dsh-querit (MIT).
 * @module opencode-querit/sanitize
 */
export declare function sanitizeUntrustedText(value: string): string;
/** The text of a thrown value, sanitized: an error message can carry remote text such as a URL. */
export declare function sanitizeErrorMessage(error: unknown): string;
