## Repository Rules

Read [docs/AGENTS.md](docs/AGENTS.md) for the shared engineering and safety rules.
The application is implemented; inspect the current source and package scripts
rather than treating historical scaffold notes as current state.

### Keep Documentation In Sync

- After every behavior, configuration or file-structure change in this repository,
  update affected documentation and source comments in the same turn, without
  asking the user or deferring documentation to a later task.
- Check README, every document under `docs/` for relevance, and affected in-app
  help. Update the owning route, environment, API, schema, architecture, design,
  setup, operations and readiness sections as appropriate; do not merely append
  a changelog or rewrite unrelated documents.
- Document new files in the existing architecture/file map. Keep purpose headers
  on touched/new source files and explain only non-obvious decisions inline.
- Keep implementation, local tests, external verification and approvals distinct.
  Never turn an unconfigured integration or historical test result into a current
  production-readiness claim. Preserve unresolved launch gates.
- Guides are native app pages under `src/app/user-guide` and `src/app/tech-guide`,
  with content under `src/components/guides`. Do not recreate retired Markdown/HTML
  guide copies or renderer hooks. Run `node --test scripts/docs/check.test.mjs`
  and relevant guide browser checks; verify links and section anchors.
- When UI changes alter illustrated controls, content, navigation or workflow
  steps, refresh only affected guide screenshots using synthetic data, then
  update the curated `public/guides` assets/dimensions and run documentation checks.
  Footer-only additions do not require screenshot updates. Preserve screenshot
  redaction and disposable-environment safeguards; report blocked captures honestly.
- Run focused checks first and build/lint for code changes. Documentation-only
  edits need documentation checks, not another application build. Do not create
  additional Markdown files just to record changes; update existing documents.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
