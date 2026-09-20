import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
) as {
  peerDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const DSH_PEERS = [
  "@deepseek-ai/dsh-api-remotes",
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-settings",
  "@deepseek-ai/dsh-credentials",
  "@deepseek-ai/dsh-invariants",
  "@deepseek-ai/dsh-launch-environment",
  "@deepseek-ai/dsh-settings",
  "@deepseek-ai/dsh-tool-web",
  "@deepseek-ai/dsh-web",
] as const;

describe("dsh peer range", () => {
  it("uses one range that covers 0.1.2-rc.1 plus 0.1.5 and 0.1.6 prereleases", () => {
    const range = pkg.peerDependencies["@deepseek-ai/dsh-web"];
    expect(range).toBeDefined();
    for (const name of DSH_PEERS) {
      expect(pkg.peerDependencies[name]).toBe(range);
    }
    const branches = range!.split("||").map((branch) => branch.trim());
    expect(branches).toContain(">=0.1.2-rc.1 <0.2.0");
    expect(branches.some((branch) => /^>=0\.1\.5-\S+ <0\.2\.0$/.test(branch))).toBe(true);
    expect(branches.some((branch) => /^>=0\.1\.6-\S+ <0\.2\.0$/.test(branch))).toBe(true);
  });

  it("develops against the npm latest dsh 0.1.5-rc line", () => {
    expect(pkg.devDependencies["@deepseek-ai/dsh-web"]).toMatch(/0\.1\.5-rc\./);
  });
});
