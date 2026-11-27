import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
) as {
  engines: { node: string; dsh?: string };
  exports: Record<string, unknown>;
  peerDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** Host packages whose instances the plugin must share with the running dsh. */
const DSH_PEERS = [
  "@deepseek-ai/dsh-api-remotes",
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-settings",
  "@deepseek-ai/dsh-credentials",
  "@deepseek-ai/dsh-launch-environment",
  "@deepseek-ai/dsh-settings",
  "@deepseek-ai/dsh-tool-web",
  "@deepseek-ai/dsh-web",
] as const;

describe("dsh compatibility range", () => {
  it("declares engines.dsh, which the host checks on its own", () => {
    expect(pkg.engines.dsh).toMatch(/^>=0\.2\.\d+(-[a-z]+\.\d+)? <0\.3\.0$/);
  });

  it("uses that same range for every host peer", () => {
    for (const name of DSH_PEERS) {
      expect(pkg.peerDependencies[name], name).toBe(pkg.engines.dsh);
    }
  });

  it("drops the invariant companion the host removed after 0.2.0-rc.2", () => {
    expect(pkg.peerDependencies["@deepseek-ai/dsh-invariants"]).toBeUndefined();
    expect(pkg.devDependencies["@deepseek-ai/dsh-invariants"]).toBeUndefined();
    expect(pkg.exports["./invariant"]).toBeUndefined();
  });

  it("requires the Node version the host requires", () => {
    expect(pkg.engines.node).toBe(">=24.9.0");
  });

  it("develops against the npm latest dsh 0.2.2 line", () => {
    expect(pkg.devDependencies["@deepseek-ai/dsh-web"]).toMatch(/^\^?0\.2\.2-rc\./);
  });
});
