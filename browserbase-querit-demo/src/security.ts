import { isIP } from "node:net";

const LOCAL_HOST_SUFFIXES = [".home.arpa", ".internal", ".local", ".localhost"];
const MAX_URL_LENGTH = 4_096;

export function normalizeSafeWebUrl(value: string): string | undefined {
  const input = value.trim();
  if (!input || input.length > MAX_URL_LENGTH) return undefined;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username || url.password) return undefined;
  if (isUnsafeHostname(url.hostname)) return undefined;

  return url.toString();
}

export function sanitizeText(value: string, maxLength = 1_000): string {
  const normalized = value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function redactSecrets(value: string, secrets: readonly string[]): string {
  let redacted = value;
  const uniqueSecrets = [...new Set(secrets.map((secret) => secret.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);

  for (const secret of uniqueSecrets) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }

  return sanitizeText(redacted, 2_000);
}

export function safeErrorMessage(error: unknown, secrets: readonly string[] = []): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message, secrets) || "Unknown integration error.";
}

export function stringifyRedactedJson(value: unknown, secrets: readonly string[]): string {
  return JSON.stringify(redactJsonValue(value, secrets), null, 2);
}

function redactJsonValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redactSecrets(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactJsonValue(item, secrets));
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactJsonValue(item, secrets)]),
  );
}

function isUnsafeHostname(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || hostname === "localhost") return true;
  if (LOCAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return true;

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) return isUnsafeIpv4(hostname);
  if (ipVersion === 6) return isUnsafeIpv6(hostname);
  return false;
}

function isUnsafeIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const first = octets[0];
  const second = octets[1];
  const third = octets[2];
  if (first === undefined || second === undefined || third === undefined) return true;

  return (
    first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && (third === 0 || third === 2))
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224
  );
}

function isUnsafeIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups) return true;

  const first = groups[0] ?? 0;
  const isUnspecified = groups.every((group) => group === 0);
  const isLoopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const isUniqueLocal = (first & 0xfe00) === 0xfc00;
  const isLinkLocal = (first & 0xffc0) === 0xfe80;
  const isMulticast = (first & 0xff00) === 0xff00;
  const isDocumentation = first === 0x2001 && groups[1] === 0x0db8;

  if (isUnspecified || isLoopback || isUniqueLocal || isLinkLocal || isMulticast || isDocumentation) {
    return true;
  }

  const isIpv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const isIpv4Compatible = groups.slice(0, 6).every((group) => group === 0);
  if (!isIpv4Mapped && !isIpv4Compatible) return false;

  const high = groups[6] ?? 0;
  const low = groups[7] ?? 0;
  return isUnsafeIpv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
}

function expandIpv6(address: string): number[] | undefined {
  const halves = address.split("::");
  if (halves.length > 2) return undefined;

  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return undefined;

  const groups = [...left, ...Array<string>(missing).fill("0"), ...right]
    .map((group) => Number.parseInt(group, 16));

  return groups.length === 8 && groups.every((group) => Number.isInteger(group)) ? groups : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
