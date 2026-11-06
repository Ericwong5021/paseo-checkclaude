# paseo-checkclaude

A [Paseo](https://paseo.sh) plugin that runs [CheckClaude](https://github.com/zzusec/CheckClaude)
and shows the result inside Paseo.

CheckClaude scores the environment Claude sees: exit IP and route consistency, DNS and PAC
handling, system timezone and locale, proxy shape, Claude Code reachability, and browser
fingerprint signals. 26 weighted signals, 100 points, plus the list of what each missing point
costs and how to get it back.

## Install

```bash
paseo plugin install github:<owner>/paseo-checkclaude
# or from a local checkout
paseo plugin install /absolute/path/to/paseo-checkclaude
```

Requires Paseo 0.15.1 or newer, and a macOS or Linux daemon.

## Use

- Sidebar footer row `CheckClaude` shows the last score and opens the screen.
- `/checkclaude` in the composer opens the screen and starts a check; `/checkclaude fix` also
  applies the safe fixes.
- Command Center (⌘K): `Check Claude environment`, `Fix Claude environment`.
- Settings → Plugins → CheckClaude: data directory, script path, timeout.

A run takes 20 to 60 seconds. The screen shows a spinner while it runs, then the score, per-group
signals, remaining points, problems, fixes, and the key details. `View report` shows the raw
`claude-check.sh` output.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Data directory | CheckClaude default for the platform | Where `claude_status`, route history, and logs live. Empty uses `~/Library/Application Support/CheckClaude` on macOS and `~/.local/share/CheckClaude` on Linux, the same directory as the app. |
| Script path | bundled | Run another `claude-check.sh`. Empty uses the bundled copy. |
| Timeout | 240 s | Kills a stalled run. |
| Browser probe | `WebView` | `WebView` is silent, `Default browser` opens the default browser once for the full fingerprint including Client Hints, `Off` skips it. |

Sharing the app's data directory keeps the 24 hour route history used by the exit stability
signal continuous across the menu bar app, the CLI, and this plugin.

## How it works

Paseo bundles the server entry into a single file, so the upstream scripts travel as strings in
`server/scripts/embedded.ts` and are written to `~/.paseo/checkclaude/scripts` on first run. The
daemon spawns `/bin/bash claude-check.sh` with `AUTO_TZ_DIR` set to the data directory, then parses
the `claude_status` key=value file it writes.

Browser signals come from `server/native/main.swift`, a headless driver compiled together with
`BrowserProbe` and `BrowserBridge` copied from the CheckClaude menu bar app. The app has no
command line entry, so this rebuilds the same two probes as a standalone binary: it collects the
signals, writes `browser_signals`, and exits. No menu bar item, no launch agent, nothing resident.
The binary is embedded gzipped in `embedded.ts` and unpacked to `~/.paseo/checkclaude/bin/ccprobe`,
so `swiftc` is only needed to rebuild it:

```bash
./server/native/build.sh   # universal arm64 + x86_64, then npm run embed
```

`webview` mode runs the hidden WKWebView probe (silent, about five seconds). `browser` mode serves
a loopback page and launches the default browser, which posts back the full fingerprint including
Client Hints, Sec-Fetch, and Accept-Language.

`checkclaude.run` only starts a job and returns it; `checkclaude.job` reports progress, so a slow
probe cannot hit an RPC timeout. `checkclaude.snapshot` reads the last snapshot for instant display.

## Development

```bash
npm install
npm run typecheck
npm run embed      # regenerate server/scripts/embedded.ts after editing the .sh files
paseo plugin install .   # registers the working directory
paseo plugin reload checkclaude
paseo plugin logs checkclaude
```

`npm install` pins `electron-to-chromium` through `overrides` because one transitive tarball was
missing from the registry; drop the override when the upstream package resolves again.

## Layout

```
index.client.tsx              screen, settings screen, sidebar row, commands
index.server.ts               RPC handlers and settings registration
client/                       React Native UI, hooks, formatting
server/                       job runner, status parser, paths, bundled scripts
shared/checkclaude.ts         Zod contracts for snapshots, jobs, and settings
```

## Credits and license

CheckClaude is MIT licensed; its `claude-check.sh` and `auto-timezone.sh` are vendored in
`server/scripts/` with the upstream license, and its `BrowserProbe` and `BrowserBridge` classes are
copied into `server/native/CheckClaudeProbe.swift`. `server/scripts/generate-embedded.mjs` and
`server/native/build.sh` regenerate the embedded copies. The plugin code is MIT licensed as well.

The score reflects contradictions in the local environment fingerprint only. It is not an
Anthropic verdict and is not a guarantee of account safety.
