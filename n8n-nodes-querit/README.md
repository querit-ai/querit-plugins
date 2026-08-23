# n8n-nodes-querit

An [n8n](https://n8n.io/) community node for [Querit](https://www.querit.ai). Search the live web and fetch clean page content from workflows or AI agents. The node is programmatic because Querit returns nested result arrays and application-level error codes that require explicit validation, normalization, and item linking.

- One `Querit` node, marked `usableAsTool: true`
- No runtime dependencies
- One output item per normalized search/content result, with a paired empty summary when none are usable
- Native n8n errors, `Continue On Fail`, and paired-item support

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Example workflow](#example-workflow) · [Compatibility](#compatibility) · [Development](#development) · [Publishing with provenance](#publishing-with-provenance)

## Installation

Follow n8n's [community node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/), and install:

```text
n8n-nodes-querit
```

For local development, run `npm run dev` in this directory and open the n8n instance started by `@n8n/node-cli`.

## Credentials

1. Create a Querit account at [Querit.ai](https://www.querit.ai) and obtain an API key.
2. In n8n, create a **Querit API** credential.
3. Paste the key into the password-protected **API Key** field.
4. Select **Test**. The test sends a minimal authenticated `POST /v1/search` request with `count: 1`.

The credential adds `Authorization: Bearer <key>` to Querit requests. n8n encrypts the value at rest. The node never logs credential values and redacts the configured key from remote error messages.

## Operations

### Search Web

Calls `POST https://api.querit.ai/v1/search`.

| Parameter         | Required | Description                                                                         |
| ----------------- | -------- | ----------------------------------------------------------------------------------- |
| Query             | Yes      | Search query, up to 1,000 characters                                                |
| Count             | No       | Maximum results, from 1 to 20; default `5`                                          |
| Chunks Per Result | No       | Sentence-level excerpts per result, from 1 to 3                                     |
| Countries         | No       | Country targeting from Querit's supported list                                      |
| Exclude Domains   | No       | Comma-separated domain blacklist                                                    |
| Include Content   | No       | Requests sentence-level excerpts                                                    |
| Include Domains   | No       | Comma-separated domain whitelist                                                    |
| Languages         | No       | Language filters from Querit's supported list                                       |
| Time Range        | No       | Relative range (`d7`, `w2`, `m3`, `y1`) or inclusive `YYYY-MM-DDtoYYYY-MM-DD` range |

The node validates Querit's nested payload, keeps the exact `search_id` even when it exceeds JavaScript's safe integer range, accepts only HTTP(S) result URLs, removes URL fragments, and deduplicates normalized URLs. Each result becomes one n8n item with `query`, `title`, `url`, `snippet`, `sentences`, optional source fields, `searchId`, and server timing when available. If a successful response contains no usable result URLs, the node emits one paired `{ query, results: [] }` summary instead of dropping the input item.

### Fetch Content

Calls `POST https://api.querit.ai/v1/contents`.

| Parameter        | Required | Description                                                               |
| ---------------- | -------- | ------------------------------------------------------------------------- |
| URLs             | Yes      | One to 10 unique HTTP(S) URLs; embedded URL credentials are rejected      |
| Format           | No       | `HTML`, `Markdown` (default), or `Text`                                   |
| Crawl Timeout    | No       | Per-page timeout from 1 to 60 seconds; default `10`                       |
| Include Metadata | No       | Includes page title, publication time, site name, and icon when available |

Each returned page becomes one n8n item with its `id`, normalized `url`, `content`, status, optional `metadata`, `searchId`, format, and server timing. Querit status records that do not have a matching content result are also emitted as items, so failed crawls are not silently discarded. If a successful response has neither usable results nor statuses, the node emits one paired `{ urls, items: [] }` summary.

## Error handling and security

- HTTP failures and Querit responses where `error_code` is present and not `200` become `NodeApiError` instances.
- Invalid inputs, unsupported URL schemes, malformed user parameters, and unknown operations become `NodeOperationError` instances.
- Malformed JSON and structurally invalid successful payloads fail explicitly.
- When **Continue On Fail** is enabled, the node returns a paired error item instead of stopping the workflow.
- Every emitted item has `pairedItem` pointing to its source input item.
- Authentication is restricted to `api.querit.ai`; credentials are not forwarded across redirects.
- The package does not access environment variables or the file system.

Web pages and search snippets are untrusted external data. If an AI agent uses this node as a tool, instruct the agent to treat returned content as data, never as instructions, and to cite returned URLs.

## Example workflow

Import [`examples/querit-search-and-fetch.workflow.json`](./examples/querit-search-and-fetch.workflow.json) into n8n. Select your **Querit API** credential on both Querit nodes, then run either branch.

## Compatibility

- Node.js `22.22.x`
- n8n / `n8n-workflow` `2.16.0` or later
- Developed and type-checked against `n8n-workflow` `2.35.3`

The package intentionally targets supported Node 22 rather than untested newer Node majors.

## Development

```bash
npm ci --ignore-scripts
npm run check
npm run lint
npm test
npm run build
npm run pack
```

| Script            | Purpose                                                                             |
| ----------------- | ----------------------------------------------------------------------------------- |
| `npm run check`   | Strict TypeScript check for source and tests                                        |
| `npm run lint`    | Official strict `n8n-node lint` checks                                              |
| `npm test`        | Pure helper and practical node behavior tests                                       |
| `npm run build`   | Build nodes, credentials, metadata, and icons with `n8n-node`                       |
| `npm run dev`     | Start n8n with hot reload                                                           |
| `npm run scan`    | Scan the published npm package with `@n8n/scan-community-package`                   |
| `npm run pack`    | Build and inspect the npm tarball without publishing                                |
| `npm run release` | Create the version commit/tag locally, or publish with provenance in GitHub Actions |

The n8n development toolchain does not require transitive dependency lifecycle scripts, so installs use `npm ci --ignore-scripts`. The official community scanner downloads from npm; it cannot scan an unpublished local package. Run `npm run scan` after the version is visible in the npm registry.

## Publishing with provenance

The repository-root [`n8n-querit-publish.yml`](../.github/workflows/n8n-querit-publish.yml) workflow publishes tags matching `n8n-nodes-querit@*` with npm provenance and an OIDC identity; no npm token is required.

### One-time npm trusted publisher setup

After the npm package exists, open its **Settings → Trusted Publishers**, choose **GitHub Actions**, and enter:

- **Repository owner:** `querit-ai`
- **Repository name:** `querit-plugins`
- **Workflow filename:** `n8n-querit-publish.yml`
- **Environment:** leave blank

Grant the workflow only `contents: read` and `id-token: write`. Do not add an `NPM_TOKEN` when trusted publishing is enabled.

To release:

```bash
npm run release
```

The configured tag format is `n8n-nodes-querit@<version>`. Pushing that tag triggers the publish workflow, which installs with `npm ci --ignore-scripts`, runs the official lint/build release path, and calls `npm publish` with provenance enabled.

## Resources

- [Querit](https://www.querit.ai)
- [n8n community node documentation](https://docs.n8n.io/integrations/community-nodes/)
- [n8n verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines/)

## License

[MIT](./LICENSE)
