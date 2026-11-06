import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { RunJob, RunMode, Snapshot } from "../shared/checkclaude";
import { parseStatusFile, stripAnsi } from "./parse";
import { resolveDataDir, resolveScript, unsupportedReason } from "./paths";

/** Extra PATH entries so a daemon started from Finder still finds curl and friends. */
const EXTRA_PATH = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

const MAX_JOBS = 8;

const jobs = new Map<string, RunJob>();
let activeJobId: string | null = null;
let sequence = 0;
let latest: RunJob | null = null;

export interface RunOptions {
  dataDir: string;
  scriptPath: string;
  timeoutSeconds: number;
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

  const args = [script];
  if (job.mode === "fix") args.push("--fix");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AUTO_TZ_DIR: dataDir,
    HOME: process.env.HOME ?? "",
    PATH: [process.env.PATH, ...EXTRA_PATH].filter(Boolean).join(":"),
  };

  await new Promise<void>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn("/bin/bash", args, {
      cwd: path.dirname(script),
      env,
      timeout: options.timeoutSeconds * 1000,
      killSignal: "SIGTERM",
    });

    const done = (error: string | null) => {
      if (settled) return;
      settled = true;
      const report = stripAnsi(`${stdout}${stderr ? `\n${stderr}` : ""}`).trim();
      finish(job, { error, report, dataDir });
      resolve();
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
    child.on("error", (error) => done(error.message));
    child.on("close", (code, signal) => {
      if (signal === "SIGTERM" && code !== 0) {
        done(`CheckClaude timed out after ${options.timeoutSeconds}s.`);
        return;
      }
      done(code === 0 ? null : `claude-check.sh exited with code ${code ?? "unknown"}.`);
    });
  });
}

function finish(
  job: RunJob,
  input: { error: string | null; report?: string; dataDir: string },
): void {
  if (input.report !== undefined) job.report = input.report.length > 0 ? input.report : null;
  job.status = input.error ? "failed" : "done";
  job.error = input.error;
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
