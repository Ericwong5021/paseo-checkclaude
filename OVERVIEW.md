# CheckClaude

CheckClaude scores how consistent this machine looks to Claude and Claude Code: where traffic
actually exits, whether DNS and timezone agree with that exit, and whether the browser fingerprint
matches. It shows the score, the signals that cost points, what to change, and can apply the safe
fixes for you.

The scoring comes from [CheckClaude](https://github.com/zzusec/CheckClaude), which ships the same
weights as a menu bar app and a command line tool. The plugin runs that script on the daemon and
renders the result inside Paseo, so you can check before a long session without leaving the window.
It bundles the upstream `claude-check.sh` and `auto-timezone.sh`, so the CheckClaude app does not
have to be installed.

## Setup

The plugin runs `claude-check.sh` with bash, so the daemon must be on macOS or Linux. On Windows
the screen explains that the platform is unsupported.

A check takes 20 to 60 seconds because it probes several networks at once. It reads the last
snapshot on open, so the score is available immediately after the first run.

Settings:

- **Data directory** defaults to the CheckClaude directory for the platform, the same one the
  app and CLI use. Sharing it means the 24 hour route history behind the stability signal carries
  over between the menu bar app, the CLI, and this plugin.
- **Script path** points at another `claude-check.sh` when you want to test a modified copy.
- **Timeout** stops a stalled run, 240 seconds by default.

## What it does

`/checkclaude` opens the screen and starts a check. `/checkclaude fix` also applies the reversible
fixes. The sidebar row shows the last score, the Command Center has entries for checking and fixing,
and Settings has the options above.

The browser signals (WebRTC exit, browser timezone and language, Client Hints, fonts) are only
collected by the menu bar app's hidden WebView. A command line run leaves those signals at their
partial scores, so a check started from Paseo usually lands lower than the same check in the app.

Fixes do not use sudo. Anything that needs administrator rights, such as installing a DNS profile,
stays listed as a manual step, and every applied change is reversible from System Settings.

The plugin reads and writes files in the CheckClaude data directory and runs network probes to the
same endpoints the CLI uses. Nothing leaves the machine beyond those probes, and no account or
token is involved.

The score describes contradictions in the local environment fingerprint only. It is not an
Anthropic verdict and does not guarantee account safety.
