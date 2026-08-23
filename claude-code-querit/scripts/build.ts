import { builtinModules } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { build } from "esbuild";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const outputPath = join(packageRoot, "plugin", "dist", "server.js");
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const result = await build({
  entryPoints: [join(packageRoot, "src", "server.ts")],
  outfile: outputPath,
  bundle: true,
  packages: "bundle",
  platform: "node",
  format: "esm",
  target: "node22",
  treeShaking: true,
  sourcemap: false,
  minify: true,
  legalComments: "eof",
  charset: "utf8",
  metafile: true,
  logLevel: "info",
});

const unexpectedExternals = Object.values(result.metafile.outputs)
  .flatMap((output) => output.imports)
  .filter((item) => item.external && !builtins.has(item.path))
  .map((item) => item.path);

if (unexpectedExternals.length > 0) {
  throw new Error(`Runtime dependencies were not bundled: ${[...new Set(unexpectedExternals)].join(", ")}`);
}

const bundle = await readFile(outputPath, "utf8");
if (!bundle.startsWith("#!/usr/bin/env node")) {
  throw new Error("The MCP server bundle is missing its Node.js shebang.");
}
