# Repository Guidelines

## Project Structure & Module Organization

This repository contains three main areas. `smallphone-app/` is the Node.js product app: backend entrypoint in `apps/core/server.js`, browser UI in `apps/web/`, domain logic in `packages/domain/`, storage in `packages/storage/`, runtime adapters in `packages/openclaw-adapter/`, and tests in `test/` plus package-local `*.test.js` files. `generic-mini-phone-beta/` is the static beta frontend, with `index.html`, `style.css`, shared scripts in `scripts/`, app modules in `apps/`, and product docs in `docs/`. `openclaw-smallphone-plugin/` contains the OpenClaw plugin manifest and TypeScript extension entrypoint. Root-level `docs/` stores integration and handoff notes.

## Build, Test, and Development Commands

Run backend commands from `smallphone-app/`:

```bash
npm start                    # start the app on http://127.0.0.1:22000
npm run start:cc-webclient   # start with cc-webclient runtime mode
npm run start:openclaw-http  # start with OpenClaw HTTP runtime mode
npm run check                # syntax-check key CommonJS files
npm test                     # run Node test suite
```

From the repo root, `./start_smallphone.sh` starts the broader local SmallPhone stack and beta frontend, using environment variables for host, ports, runtime mode, and provider credentials.

## Coding Style & Naming Conventions

Use JavaScript CommonJS style in `smallphone-app/` unless a package explicitly declares ESM. Keep two-space indentation, semicolons, and descriptive camelCase identifiers. Use kebab-case for directories and files such as `openclaw-adapter/` and `json-store.js`. Keep browser modules small and organized by feature under `generic-mini-phone-beta/apps/<feature>/index.js`. Avoid exposing server-only secrets to frontend code.

## Testing Guidelines

Tests use Node's built-in test runner (`node --test`). Name tests `*.test.js` and place them near the package they cover or under `smallphone-app/test/` for cross-cutting behavior. Add focused tests for adapter behavior, storage/domain changes, and regressions involving attachments, contacts, permissions, or runtime routing. Run `npm test` and `npm run check` before handing off changes.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit-style messages, for example `feat(smallphone): ...`, `fix(frontend): ...`, and `chore(runtime): ...`. Keep commits scoped and imperative. Pull requests should include a short behavior summary, test results, linked issue or handoff context when available, and screenshots or screen recordings for visible UI changes.

## Security & Configuration Tips

Runtime configuration is environment-driven. Keep API keys, OpenClaw tokens, cc-connect management tokens, and local provider credentials out of browser code and commits. Prefer `127.0.0.1` bindings for local gateways unless a shared device workflow explicitly requires another host.
