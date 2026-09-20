# AGENTS.md

`pi-opencode-go-usage` is a pi/omp extension plugin that tracks OpenCode Go usage limits
(rolling 5h / weekly / monthly) in-session.

## What it does

OpenCode Go exposes usage through the ZEN API, keyed by an OpenCode Go API key:

```
GET https://opencode.ai/zen/go/v1/usage      header: Authorization: Bearer <api-key>
-> { usage: {
      rolling: { status, percent, resetsAt },
      weekly:  { status, percent, resetsAt },
      monthly: { status, percent, resetsAt } } }
```

The extension calls that endpoint with the user's Go API key and reads the three
percentages (`percent` is already a 0-100 number, clamped and rounded to 0.1) plus
reset countdowns. It reports percentages and countdowns only. Each window carries
its own `resetsAt` ISO timestamp — there is no period-end fallback anymore.

## Build / test / lint

No build step: omp loads the `.ts` extension directly via its Bun-based loader.

```bash
bun test                 # run the parser/formatter/factory tests (test/parse.test.ts)
bun -e '...'             # ad-hoc probes (see examples below)
```

TypeScript is transpiled at load by omp; there is no tsc/lint pipeline. `import type { ExtensionAPI }`
from `@earendil-works/pi-coding-agent` is type-only and erased at runtime — it resolves at load time
from `~/.omp/plugins/node_modules` when omp loads the plugin.

## Layout

- `extensions/opencode-go-usage.ts` — the whole extension: fetch/parse, config persistence,
  status bar, `/opencode-go` command, periodic refresh.
- `package.json` — `omp.extensions` / `pi.extensions` manifest pointing at the extension entry.
- `test/parse.test.ts` — unit + wiring smoke tests.

## Conventions

- Single extension file; no build, no runtime deps. Bun globals (`fetch`, `setInterval`,
  `AbortController`) and `node:*` builtins only.
- Pure logic (`parseUsage`, `fetchUsage`, `bar`, `countdown`) is exported from the
  extension module so tests import it without running the factory.
- Credentials: the `OPENCODE_GO_API_KEY` env var (wins), or `config.apiKey` saved by
  `/opencode-go --connect <api-key>` / `--key <v>` to `~/.omp/agent/opencode-go-usage.json`
  (mode 0600), overridable with `OPENCODE_GO_CONFIG_PATH` (the test suite uses this so it
  never writes the real file). The env value wins over the saved key, so
  `--connect`/`--key`/`--disconnect` warn when they are being shadowed.
- Fetch failures are typed: `noCredentials` / `timeout` / `network` / `unauthorized` /
  `http` / `noSubscription` / `noPayload`. `unauthorized` = the ZEN API rejected the key,
  `noSubscription` = kept in the union but unused for now, `noPayload` = the ZEN API
  changed shape (missing/empty `usage`, or every window unusable).

## Testing a live fetch

```bash
bun -e 'import { fetchUsage } from "./extensions/opencode-go-usage.ts";
fetchUsage("<api-key>").then(console.log, e => console.log(e.kind));'
```

## Install

```bash
omp plugin link /path/to/pi-opencode-go-usage   # local dev
omp plugin install github:Dakai/pi-opencode-go-usage   # from this repo
pi install npm:pi-opencode-go-usage   # published package
```

## Releasing

Bump `version` in `package.json`, commit, push, then tag that commit:

```bash
git tag v1.1.1 && git push origin v1.1.1
```

`.github/workflows/release.yml` runs the tests, refuses to publish unless the tag
equals `v<package.json version>`, and publishes to npm. It prefers npm **trusted
publishing** (OIDC, `id-token: write`; configure GitHub as the trusted publisher for
`pi-opencode-go-usage` on npmjs.com) and falls back to an `NPM_TOKEN` repository
secret when one is set. GitHub-installed copies track the repo, so they need no
npm step — `omp plugin install github:Dakai/pi-opencode-go-usage --force` refreshes
them.
