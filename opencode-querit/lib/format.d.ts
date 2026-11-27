/**
 * Render Querit responses as model-facing text. Everything from the API is
 * untrusted web data: the rendered output always carries a warning header and
 * every remote string is sanitized and length-capped before it is returned.
 * @module opencode-querit/format
 */
import { type QueritContentsResponse, type QueritFetchFormat } from "./client.js";
export declare function formatContentsResponse(response: QueritContentsResponse, requestedUrls: string[], format: QueritFetchFormat): string;
export declare function truncateUtf8(value: string, maxBytes: number): string;
/** Cap a rendered tool output in chars; returns the text unchanged when under the cap. */
export declare function capOutput(value: string, maxChars: number): string;
