import { spawn } from "node:child_process";
import { access, constants, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTempFiles,
  limitToolOutput,
  sweepStaleTempFiles,
} from "../src/output.js";

const sharedDirectory = join(tmpdir(), "pi-querit");

function oversizedText(): string {
  return Array.from({ length: 3_000 }, (_, index) => `line ${index} ${"x".repeat(40)}`).join("\n");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""]);
  const pid = child.pid!;
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return pid;
}

afterEach(async () => {
  await cleanupTempFiles();
});

describe("limited tool output", () => {
  it("returns small output as-is without touching the temp folder", async () => {
    const result = await limitToolOutput("small text", "search-results.md");
    expect(result).toEqual({ text: "small text" });
    expect(result.fullOutputPath).toBeUndefined();
  });

  it("stores truncated output as unique files inside one shared temp folder", async () => {
    const text = oversizedText();
    const first = await limitToolOutput(text, "search-results.md");
    const second = await limitToolOutput(text, "fetched-contents.md");

    expect(dirname(first.fullOutputPath!)).toBe(sharedDirectory);
    expect(dirname(second.fullOutputPath!)).toBe(sharedDirectory);
    expect(first.fullOutputPath).not.toBe(second.fullOutputPath);
    expect(await readFile(first.fullOutputPath!, "utf8")).toBe(text);
    expect(first.text).toContain("Full output saved to");
    expect(first.truncation?.truncated).toBe(true);
  });

  it("removes only the files this process created on cleanup", async () => {
    const text = oversizedText();
    const { fullOutputPath } = await limitToolOutput(text, "search-results.md");
    const foreign = join(sharedDirectory, `search-results-${process.pid}-99999.md`);
    await mkdir(sharedDirectory, { recursive: true });
    await writeFile(foreign, "kept", "utf8");

    await cleanupTempFiles();

    expect(await pathExists(fullOutputPath!)).toBe(false);
    expect(await pathExists(foreign)).toBe(true);
    await rm(foreign, { force: true });
  });

  it("sweeps stale files from dead processes but keeps live ones", async () => {
    const deadPid = await exitedPid();
    const stale = join(sharedDirectory, `search-results-${deadPid}-1.md`);
    const live = join(sharedDirectory, `search-results-${process.pid}-1.md`);
    await mkdir(sharedDirectory, { recursive: true });
    await Promise.all([
      writeFile(stale, "stale", "utf8"),
      writeFile(live, "live", "utf8"),
    ]);

    await sweepStaleTempFiles();

    expect(await pathExists(stale)).toBe(false);
    expect(await pathExists(live)).toBe(true);
    await rm(live, { force: true });
  });
});
