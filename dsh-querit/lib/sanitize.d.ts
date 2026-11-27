/**
 * Remove terminal escape/control sequences from untrusted remote text.
 * Newlines and tabs are preserved so page content remains readable.
 * Ported from pi-querit (MIT).
 * @module dsh-querit/sanitize
 */
export declare function sanitizeUntrustedText(value: string): string;
/** An error's message, sanitized: errors that carry remote text end up in the model's tool results. */
export declare function sanitizeErrorMessage(error: unknown): string;
