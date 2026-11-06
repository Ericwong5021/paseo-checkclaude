import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AUTO_TIMEZONE_SH, CLAUDE_CHECK_SH } from "./scripts/embedded";

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

/** Where the bundled scripts are materialised before they run. */
export function scriptsCacheDir(): string {
  return path.join(os.homedir(), ".paseo", "checkclaude", "scripts");
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}

async function writeIfChanged(file: string, content: string): Promise<void> {
  const existing = await fs.readFile(file, "utf8").catch(() => null);
  if (existing === content) return;
  await fs.writeFile(file, content, { mode: 0o755 });
  await fs.chmod(file, 0o755).catch(() => undefined);
}

/** Writes the embedded scripts into the cache directory and returns the entry path. */
export async function materializeScripts(): Promise<string> {
  const dir = scriptsCacheDir();
  await ensureDir(dir);
  await Promise.all(
    Object.entries(SCRIPT_FILES).map(([name, content]) => writeIfChanged(path.join(dir, name), content)),
  );
  return path.join(dir, SCRIPT_NAME);
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
