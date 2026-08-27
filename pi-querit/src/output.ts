import { rmSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  withFileMutationQueue,
  type TruncationResult,
} from "@earendil-works/pi-coding-agent";

const TEMP_DIRECTORY_NAME = "pi-querit";
const TEMP_FILE_PATTERN = /^(.+)-(\d+)-(\d+)(\.[^.]+)?$/;

const createdFiles = new Set<string>();
let fileCounter = 0;
let exitCleanupRegistered = false;

export interface LimitedOutput {
  text: string;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

export async function limitToolOutput(text: string, fileName: string): Promise<LimitedOutput> {
  const initial = truncateHead(text, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  if (!initial.truncated) return { text };

  const fullOutputPath = await reserveTempFile(fileName);
  await withFileMutationQueue(fullOutputPath, async () => {
    await writeFile(fullOutputPath, text, "utf8");
  });

  const notice = `[Output truncated from ${initial.totalLines} lines (${formatSize(initial.totalBytes)}). Full output saved to: ${fullOutputPath}]`;
  const suffix = `\n\n${notice}`;
  let bodyByteLimit = Math.max(1, DEFAULT_MAX_BYTES - Buffer.byteLength(suffix, "utf8"));
  let bodyLineLimit = Math.max(1, DEFAULT_MAX_LINES - 2);
  let truncation = truncateHead(text, { maxBytes: bodyByteLimit, maxLines: bodyLineLimit });
  let resultText = `${truncation.content}${suffix}`;

  while (Buffer.byteLength(resultText, "utf8") > DEFAULT_MAX_BYTES || lineCount(resultText) > DEFAULT_MAX_LINES) {
    const byteOverflow = Math.max(0, Buffer.byteLength(resultText, "utf8") - DEFAULT_MAX_BYTES);
    const lineOverflow = Math.max(0, lineCount(resultText) - DEFAULT_MAX_LINES);
    const nextByteLimit = Math.max(1, bodyByteLimit - byteOverflow);
    const nextLineLimit = Math.max(1, bodyLineLimit - lineOverflow);
    // Safety valve: if limits cannot shrink further the suffix alone exceeds the
    // cap — stop iterating instead of looping forever.
    if (nextByteLimit === bodyByteLimit && nextLineLimit === bodyLineLimit) break;
    bodyByteLimit = nextByteLimit;
    bodyLineLimit = nextLineLimit;
    truncation = truncateHead(text, { maxBytes: bodyByteLimit, maxLines: bodyLineLimit });
    resultText = `${truncation.content}${suffix}`;
  }

  return {
    text: resultText,
    truncation,
    fullOutputPath,
  };
}

function tempDirectoryPath(): string {
  return join(tmpdir(), TEMP_DIRECTORY_NAME);
}

/**
 * All truncated output lives in one shared temp directory so search content never
 * scatters across per-call folders. File names embed the creating pid so concurrent
 * Pi instances cannot collide and stale files from dead processes can be swept.
 */
async function reserveTempFile(fileName: string): Promise<string> {
  // mkdir on every call: the directory may have been removed externally since a
  // previous write; recursive mkdir on an existing directory is a cheap no-op.
  await mkdir(tempDirectoryPath(), { recursive: true });
  const dot = fileName.lastIndexOf(".");
  const base = dot === -1 ? fileName : fileName.slice(0, dot);
  const extension = dot === -1 ? "" : fileName.slice(dot);
  const path = join(tempDirectoryPath(), `${base}-${process.pid}-${++fileCounter}${extension}`);
  createdFiles.add(path);
  return path;
}

/** Deletes only the files this process created; the shared folder is never removed. */
export async function cleanupTempFiles(): Promise<void> {
  const paths = [...createdFiles];
  createdFiles.clear();
  await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => undefined)));
}

/** Synchronous best-effort fallback for exits that skip session_shutdown (e.g. signals). */
export function registerProcessExitCleanup(): void {
  if (exitCleanupRegistered) return;
  exitCleanupRegistered = true;
  process.once("exit", () => {
    for (const path of createdFiles) {
      try {
        rmSync(path, { force: true });
      } catch {
        // Best effort only.
      }
    }
    createdFiles.clear();
  });
}

/** Removes leftovers from previous runs whose process no longer exists. */
export async function sweepStaleTempFiles(): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(tempDirectoryPath());
  } catch {
    return;
  }
  await Promise.all(entries.map(async (entry) => {
    const match = TEMP_FILE_PATTERN.exec(entry);
    if (!match || isProcessAlive(Number(match[2]))) return;
    await rm(join(tempDirectoryPath(), entry), { force: true }).catch(() => undefined);
  }));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function lineCount(value: string): number {
  return value.length === 0 ? 0 : value.split("\n").length;
}
