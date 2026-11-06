import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { RunJob, RunMode, Snapshot } from "../shared/checkclaude";
import { parseStatusFile, stripAnsi } from "./parse";
import { materializeProbe, resolveDataDir, resolveScript, unsupportedReason } from "./paths";

/** Extra PATH entries so a daemon started from Finder still finds curl and friends. */
const EXTRA_PATH = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

const MAX_JOBS = 8;

/** The native probe waits for a browser tab, so it gets a longer budget than the silent mode. */
const PROBE_TIMEOUT_MS: Record<"webview" | "browser", number> = {
  webview: 30_000,
  browser: 150_000,
};

const jobs = new Map<string, RunJob>();
let activeJobId: string | null = null;
let latest: RunJob | null = null;
let sequence = 0;

export interface RunOptions {
  dataDir: string;
  scriptPath: string;
  timeoutSeconds: number;
  browserProbe: "webview" | "browser" | "off";
}

function clone(job: RunJob): RunJob {
  return { ...job };
}

function pruneJobs(): void {
  while (jobs.size > MAX_JOBS) {
    const oldest = jobs.keys().next();
    if (oldest.done) break;
    if (oldest.value === activeJobId) break;
    jobs.delete(oldest.value);
  }
}

export function runningJob(): RunJob | null {
  if (!activeJobId) return null;
  const job = jobs.get(activeJobId);
  return job && job.status === "running" ? clone(job) : null;
}

/** The most recently finished or running job, kept for the screen after a reload. */
export function latestJob(): RunJob | null {
  return latest ? clone(latest) : null;
}

export function getJob(id: string): RunJob | null {
  const job = jobs.get(id);
  return job ? clone(job) : null;
}

/** Starts a check, or returns the one already running. */
export function startJob(mode: RunMode, options: RunOptions): RunJob {
  const active = runningJob();
  if (active) return active;

  const job: RunJob = {
    id: `check-${Date.now().toString(36)}-${(sequence += 1)}`,
    mode,
    status: "running",
    stage: null,
    probe: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    score: null,
    report: null,
    error: null,
  };
  jobs.set(job.id, job);
  latest = job;
  activeJobId = job.id;
  pruneJobs();

  void execute(job, options).finally(() => {
    if (activeJobId === job.id) activeJobId = null;
  });

  return clone(job);
}

async function execute(job: RunJob, options: RunOptions): Promise<void> {
  const dataDir = resolveDataDir(options.dataDir);
  const unsupported = unsupportedReason();
  if (unsupported) {
    finish(job, { error: unsupported, dataDir });
    return;
  }

  const script = await resolveScript(options.scriptPath);
  if (!script) {
    finish(job, {
      error: "Could not find claude-check.sh. Set a script path in the plugin settings.",
      dataDir,
    });
    return;
  }

  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 }).catch(() => undefined);

  if (options.browserProbe !== "off") {
    const note = await runProbe(job, dataDir, options.browserProbe);
    if (job.status !== "running") return;
    job.probe = note;
  }

  job.stage = "check";
  const args = [script];
  if (job.mode === "fix") args.push("--fix");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AUTO_TZ_DIR: dataDir,
    HOME: process.env.HOME ?? "",
    PATH: [process.env.PATH, ...EXTRA_PATH].filter(Boolean).join(":"),
  };

  const result = await runProcess("/bin/bash", args, {
    cwd: path.dirname(script),
    env,
    timeoutMs: options.timeoutSeconds * 1000,
  });

  if (job.status !== "running") return;

  if (result.timedOut) {
    finish(job, {
      error: `CheckClaude timed out after ${options.timeoutSeconds}s.`,
      report: result.stdout + result.stderr,
      dataDir,
    });
    return;
  }
  finish(job, {
    error: result.code === 0 ? null : `claude-check.sh exited with code ${result.code ?? "unknown"}.`,
    report: result.stdout + result.stderr,
    dataDir,
  });
}

/**
 * Runs the bundled probe binary, which is compiled from the CheckClaude menu bar
 * app's own BrowserProbe/BrowserBridge classes. It writes `browser_signals` into
 * the data directory and exits, so nothing stays resident.
 */
async function runProbe(
  job: RunJob,
  dataDir: string,
  mode: "webview" | "browser",
): Promise<string> {
  const binary = await materializeProbe();
  if (!binary) return "unavailable on this platform";

  job.stage = "browser";
  const timeoutMs = PROBE_TIMEOUT_MS[mode];
  const args = [
    "--out",
    path.join(dataDir, "browser_signals"),
    "--mode",
    mode,
    "--timeout",
    String(Math.round(timeoutMs / 1000)),
  ];
  if (mode === "browser") args.push("--open");

  const result = await runProcess(binary, args, {
    cwd: path.dirname(binary),
    env: { ...process.env, HOME: process.env.HOME ?? "" },
    timeoutMs,
  });

  if (job.status !== "running") return result.stdout.trim();

  if (result.timedOut) return `${mode} timed out after ${Math.round(timeoutMs / 1000)}s`;

  const payload = parseProbeOutput(result.stdout);
  if (payload?.status === "ok") {
    const seconds = typeof payload.ms === "number" ? ` ${(payload.ms / 1000).toFixed(1)}s` : "";
    return `${mode} ok${seconds}`;
  }
  const detail = typeof payload?.detail === "string" ? `: ${payload.detail}` : "";
  return `${mode} ${payload?.status ?? "failed"}${detail}`;
}

function parseProbeOutput(stdout: string): Record<string, unknown> | null {
  const line = stdout
    .split("\n")
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.startsWith("{"))
    .pop();
  if (!line) return null;
  try {
    const parsed = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs,
      killSignal: "SIGTERM",
    });

    const done = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr, timedOut });
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 400_000) stdout = stdout.slice(-300_000);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 60_000) stderr = stderr.slice(-40_000);
    });
    child.on("error", (error) => {
      stderr += error.message;
      done(null);
    });
    child.on("close", (code, signal) => {
      if (signal === "SIGTERM" && code === null) timedOut = true;
      done(code);
    });
  });
}

function finish(
  job: RunJob,
  input: { error: string | null; report?: string; dataDir: string },
): void {
  if (input.report !== undefined) {
    const report = stripAnsi(input.report).trim();
    job.report = report.length > 0 ? report : null;
  }
  job.status = input.error ? "failed" : "done";
  job.error = input.error;
  job.stage = null;
  job.finishedAt = new Date().toISOString();
  void readSnapshot(input.dataDir).then((snapshot) => {
    if (snapshot) job.score = snapshot.snapshot?.score ?? null;
  });
}

export interface SnapshotFile {
  snapshot: Snapshot | null;
  updatedAt: string | null;
}

/** Reads the `claude_status` snapshot the script writes into its data directory. */
export async function readSnapshot(dataDir: string): Promise<SnapshotFile> {
  const file = path.join(resolveDataDir(dataDir), "claude_status");
  const [text, stat] = await Promise.all([
    fs.readFile(file, "utf8").catch(() => null),
    fs.stat(file).catch(() => null),
  ]);
  if (!text) return { snapshot: null, updatedAt: null };
  return {
    snapshot: parseStatusFile(text),
    updatedAt: stat ? stat.mtime.toISOString() : null,
  };
}
