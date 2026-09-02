# querit-plugins conventions

## Publishing: every new plugin deploys automatically

Every plugin distributed through npm must ship with its automated publish
workflow `.github/workflows/<plugin>-publish.yml` in the same change that
adds the plugin — never rely on manual `npm publish`. Copy the established
pattern from `dsh-querit-publish.yml` / `opencode-querit-publish.yml` /
`pi-querit-publish.yml`:

- Trigger on push to `main` with a `paths` filter for the plugin directory
  (plus the workflow file itself) and `workflow_dispatch` for re-runs.
- Before publishing, read the version from `package.json` and check the
  registry with `npm view <package>@<version>`; skip when that version is
  already on npm, so pushes without a version bump publish nothing.
- Publish with npm trusted publishing (OIDC): `permissions: id-token: write`,
  `npm install --global npm@11`, no NPM_TOKEN. Publishing requires a one-time
  trusted-publisher entry in the package's npm settings (owner `querit-ai`,
  repository `querit-plugins`, the new workflow filename, environment blank) —
  remind the maintainer to add it when the plugin is first released.
- Let the package's `prepack` script run the check/test/build gates; do not
  duplicate them as workflow steps.

Plugins with a different distribution channel get that channel's automation
instead of an npm workflow: `claude-code-querit` ships via the Claude Code
marketplace catalog, `zapier-querit` via `zapier push` (Zapier review, not
npm), and `browserbase-querit-demo` is an unpublished demo.
