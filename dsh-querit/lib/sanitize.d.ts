/**
 * Remove terminal escape/control sequences from untrusted remote text.
 * Newlines and tabs are preserved so page content remains readable.
 * Ported from pi-querit (MIT).
 * @module dsh-querit/sanitize
 */
export declare function sanitizeUntrustedText(value: string): string;
