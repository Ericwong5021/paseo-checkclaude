import fs from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { AUTO_TIMEZONE_SH, CLAUDE_CHECK_SH, PROBE_BINARY_GZIP_BASE64 } from "./scripts/embedded";

export const SCRIPT_NAME = "claude-check.sh";

const SCRIPT_FILES: Record<string, string> = {
  "claude-check.sh": CLAUDE_CHECK_SH,
  "auto-timezone.sh": AUTO_TIMEZONE_SH,
};

export function isSupportedPlatform(): boolean {
  return process.platform === "darwin" || process.platform === "linux";
}

export function unsupportedReason(): string | null {
  if (isSupportedPlatform()) return null;
  return "CheckClaude ships bash scripts and runs on macOS and Linux only.";
}

/** The native browser probe is a macOS binary compiled from the menu bar app's own probes. */
export function probeSupported(): boolean {
  return process.platform === "darwin";
}

/** Default CheckClaude data directory, matching the upstream app per platform. */
export function defaultDataDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "CheckClaude");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, "CheckClaude");
  }
  const xdg = process.env.XDG_DATA_HOME?.trim();
  return path.join(xdg && xdg.length > 0 ? xdg : path.join(home, ".local", "share"), "CheckClaude");
}

/** Where the bundled scripts and probe are materialised before they run. */
export function runtimeDir(): string {
  return path.join(os.homedir(), ".paseo", "checkclaude");
}

export function scriptsCacheDir(): string {
  return path.join(runtimeDir(), "scripts");
}

export function probeCachePath(): string {
  return path.join(runtimeDir(), "bin", "ccprobe");
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}

async function writeIfChanged(file: string, content: string, mode: number): Promise<void> {
  const existing = await fs.readFile(file, "utf8").catch(() => null);
  if (existing === content) return;
  await fs.writeFile(file, content, { mode });
  await fs.chmod(file, mode).catch(() => undefined);
}

/** Writes the embedded scripts into the runtime directory and returns the entry path. */
export async function materializeScripts(): Promise<string> {
  const dir = scriptsCacheDir();
  await ensureDir(dir);
  await Promise.all(
    Object.entries(SCRIPT_FILES).map(([name, content]) =>
      writeIfChanged(path.join(dir, name), content, 0o755),
    ),
  );
  return path.join(dir, SCRIPT_NAME);
}

/**
 * Writes the embedded browser probe binary into the runtime directory. The binary
 * is compiled from the CheckClaude menu bar app's own BrowserProbe/BrowserBridge
 * classes, so the plugin can collect browser signals without the app running.
 */
export async function materializeProbe(): Promise<string | null> {
  if (!probeSupported()) return null;
  const file = probeCachePath();
  const binary = gunzipSync(Buffer.from(PROBE_BINARY_GZIP_BASE64, "base64"));
  const existing = await fs.readFile(file).catch(() => null);
  if (existing?.equals(binary)) {
    await fs.chmod(file, 0o700);
    return file;
  }
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, binary, { mode: 0o700 });
  await fs.chmod(file, 0o700).catch(() => undefined);
  return file;
}

async function isFile(file: string): Promise<boolean> {
  const stat = await fs.stat(file).catch(() => null);
  return Boolean(stat?.isFile());
}

/**
 * Resolves the claude-check.sh to run: an explicit override wins, then the
 * materialised bundled copy, then an existing CheckClaude installation.
 */
export async function resolveScript(explicitPath: string): Promise<string | null> {
  const candidates: string[] = [];
  const trimmed = explicitPath.trim();
  if (trimmed) candidates.push(trimmed);
  if (isSupportedPlatform()) candidates.push((await materializeScripts().catch(() => "")) || "");
  const home = os.homedir();
  candidates.push(
    path.join("/Applications", "CheckClaude.app", "Contents", "Resources", SCRIPT_NAME),
    path.join(home, "CheckClaude", SCRIPT_NAME),
    path.join(home, "Applications", "CheckClaude", SCRIPT_NAME),
  );
  for (const candidate of candidates) {
    if (candidate && (await isFile(candidate))) return candidate;
  }
  return null;
}

export function resolveDataDir(override: string): string {
  const trimmed = override.trim();
  return trimmed.length > 0 ? trimmed : defaultDataDir();
}
