# querit-plugins

Official [Querit](https://www.querit.ai) search plugins for AI agent harnesses.

| Harness | What it does | Install |
| --- | --- | --- |
| [pi](./pi-querit) | `web_search` / `fetch_content` custom tools wired to the Querit API | `pi install npm:pi-querit` |
| [dsh](./dsh-querit) | Querit-backed search & fetch providers for the `ctx.web` capability seam | `dsh plugin --profile web add dsh-querit` |
| [opencode](./opencode-querit) | `web_search` / `web_fetch` custom tools wired to the Querit API | `plugin: ["opencode-querit"]` |

## Repository layout

Each directory is an independent npm package with its own version, CI, and
release cycle. There is no root workspace: the two harnesses have entirely
different dependency trees, so each package keeps its own `package.json`,
lockfile, and `node_modules`.

```text
querit-plugins/
├── pi-querit/      # Pi extension (TypeScript, no build step)
├── dsh-querit/     # DeepSeek Harness provider package (compiled lib/ committed)
└── opencode-querit # OpenCode plugin (compiled lib/ committed)
```

## Development

Work inside a package directory; the root has no scripts:

```bash
cd pi-querit && npm ci && npm run check && npm test
cd dsh-querit && npm ci && npm run check && npm run build && npm test
cd opencode-querit && npm ci && npm run check && npm run build && npm test
```

Publishing is per package: bump the version, run `npm publish` from the package
directory. Releases are tagged on GitHub with the package name prefix, e.g.
`pi-querit@0.4.0`.

## License

MIT — see each package's LICENSE file.
