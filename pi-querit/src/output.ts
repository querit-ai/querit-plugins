import { mkdtemp, writeFile } from "node:fs/promises";
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

  const directory = await mkdtemp(join(tmpdir(), "pi-querit-"));
  const fullOutputPath = join(directory, fileName);
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

function lineCount(value: string): number {
  return value.length === 0 ? 0 : value.split("\n").length;
}
