# pi-opencode-go-usage

[![npm version](https://img.shields.io/npm/v/pi-opencode-go-usage?color=cb0000)](https://www.npmjs.com/package/pi-opencode-go-usage) [![pi package](https://img.shields.io/badge/pi-package-7a5cff)](https://pi.dev/packages/pi-opencode-go-usage) [![license MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**[Galego](README.gl.md) · English**

Track OpenCode Go usage limits — **rolling 5-hour, weekly, and monthly** — in-session
with a live status bar and a `/opencode-go` report widget.
![Status bar showing OpenCode Go usage](assets/pi-opencode-go-usage.png)

```
Status bar:  Go 5h 62% · wk 31% · mo 44%

Report widget:
  OpenCode Go Usage
  Rolling 5h ██████░░░░  62% · 1h 12m
  Weekly     ███░░░░░░░  31% · 3d 4h
  Monthly    ████░░░░░░  44% · 12d 0h
  Updated 2:32:05 PM  (time format follows your locale)
```

## Why this exists

OpenCode Go exposes usage directly through the ZEN API with an API key:

```
GET https://opencode.ai/zen/go/v1/usage     (Authorization: Bearer <api-key>)
-> { usage: {
      rolling: { status, percent, resetsAt },
      weekly:  { status, percent, resetsAt },
      monthly: { status, percent, resetsAt } } }
```

This extension calls that endpoint with your Go API key and reads the three
percentages (`percent` is already a 0-100 number) plus reset countdowns — each
window carries its own `resetsAt`. It reports **percentages and countdowns
only** — it does not spend screen space on dollar figures.

## Install

```bash
pi install npm:pi-opencode-go-usage   # Pi (recommended)
# or
omp plugin install github:Dakai/pi-opencode-go-usage
# or, for local dev:
omp plugin link /path/to/pi-opencode-go-usage
```

Then restart the session (or `/reload`).

## Connect

You need an **OpenCode Go API key** from your signed-in opencode.ai account
(the API key issued for the Go product; env-var and saved-file values are sent
as `Authorization: Bearer <api-key>`).

Either set the env var (recommended — keeps the key out of session history):

```bash
export OPENCODE_GO_API_KEY='…'
```

or use the slash command (persists to `$XDG_CONFIG_HOME/opencode-go-usage/config.json` (or `~/.config/opencode-go-usage/config.json`), mode 0600):

```
/opencode-go --connect <api-key>
```

Env vars **take precedence** over the saved file: while `OPENCODE_GO_API_KEY` is
set, `--connect` / `--key` save but have no effect (the command warns when it
detects this). Unset it, or export the new value. `OPENCODE_GO_CONFIG_PATH`
overrides where the file lives (default `$XDG_CONFIG_HOME/opencode-go-usage/config.json`, or `~/.config/opencode-go-usage/config.json`).

## Commands

| Command                                 | Effect                                                        |
| --------------------------------------- | ------------------------------------------------------------- |
| `/opencode-go`                          | Fetch and show the report widget                              |
| `/opencode-go --connect <api-key>`      | Save the key, fetch, show (alias `--setup`)                   |
| `/opencode-go --key <value>`            | Save the key only (alias `--api-key`)                         |
| `/opencode-go --disconnect`             | Forget the key                                                |
| `/opencode-go --refresh`                | Fetch again now                                               |
| `/opencode-go --compact [on\|off]`      | Toggle compact status bar (`Go: 5h 0% · wk 2% · mo 2%`)       |
| `/opencode-go --json`                   | Export report to `$XDG_CONFIG_HOME/opencode-go-usage/usage-report.json` (or `~/.config/opencode-go-usage/usage-report.json`) |

Usage refreshes automatically every 5 minutes.

## Failure modes

| Status text                           | Meaning                        | Fix                                             |
| ------------------------------------- | ------------------------------ | ----------------------------------------------- |
| `Invalid API key`                     | The ZEN API rejected the key   | Update `OPENCODE_GO_API_KEY` or re-run `/opencode-go --connect <api-key>` |
| `No Go subscription on this account`  | The account has no Go plan     | Check the account                               |
| `ZEN API response unrecognised`       | The ZEN API changed shape      | Update the parser                               |
| `Network error` / `Request timed out` | Transient                      | Retry                                           |

## Security

This is an authenticated read of your own usage figures, using a Go API key
stored in a `0600`-mode file (or in an env var). It reports only what the API
already exposes; an API change will break it, and it will say so instead of
showing a confident zero.

## License

MIT
