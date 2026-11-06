import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** One scored signal row: group, label, points earned of the weight, observed value. */
export const signalSchema = z.object({
  group: z.string(),
  label: z.string(),
  weight: z.number(),
  points: z.number(),
  value: z.string(),
});

/** A point still available, with the action that recovers it. */
export const gainSchema = z.object({
  label: z.string(),
  points: z.number(),
  hint: z.string(),
});

/** Parsed `claude_status` snapshot written by claude-check.sh. */
export const snapshotSchema = z.object({
  checkedAt: z.string(),
  score: z.number(),
  grade: z.string(),
  riskLevel: z.string(),
  safeUse: z.boolean(),
  verdict: z.string(),
  signals: z.array(signalSchema),
  gains: z.array(gainSchema),
  issues: z.array(z.string()),
  fixes: z.array(z.string()),
  /** Every raw key=value field, kept for the detail sheet and future fields. */
  values: z.record(z.string(), z.string()),
});

export const runModeSchema = z.enum(["report", "fix"]);

export const jobSchema = z.object({
  id: z.string(),
  mode: runModeSchema,
  status: z.enum(["running", "done", "failed"]),
  /** Which step is running: browser signal collection or the environment check. */
  stage: z.enum(["browser", "check"]).nullable(),
  /** Short summary of the browser probe result, for the screen and logs. */
  probe: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  score: z.number().nullable(),
  report: z.string().nullable(),
  error: z.string().nullable(),
});

export const runCheckRpc = defineRpc({
  name: "checkclaude.run",
  input: z.object({ mode: runModeSchema.default("report") }),
  output: z.object({ job: jobSchema }),
});

export const jobRpc = defineRpc({
  name: "checkclaude.job",
  input: z.object({ id: z.string() }),
  output: z.object({ job: jobSchema }),
});

export const snapshotRpc = defineRpc({
  name: "checkclaude.snapshot",
  input: z.object({}),
  output: z.object({
    snapshot: snapshotSchema.nullable(),
    /** ISO time of the snapshot file, or null when it does not exist yet. */
    updatedAt: z.string().nullable(),
    dataDir: z.string(),
    scriptPath: z.string().nullable(),
    supported: z.boolean(),
    unsupportedReason: z.string().nullable(),
    /** Report text of the most recent finished job, kept across plugin reloads. */
    lastReport: z.string().nullable(),
    lastJob: jobSchema.nullable(),
  }),
});

export const settingsDefinition = defineSettings({
  id: "checkclaude",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Empty means the CheckClaude default for this platform. */
    dataDir: z.string().default(""),
    /** Empty means the bundled script; set a path to use another claude-check.sh. */
    scriptPath: z.string().default(""),
    timeoutSeconds: z.number().int().min(30).max(900).default(240),
    /**
     * Browser signals come from CheckClaude's own probe, run on demand.
     * webview is silent, browser opens the default browser for the full fingerprint.
     */
    browserProbe: z.enum(["webview", "browser", "off"]).default("webview"),
  }),
});

export type Signal = z.infer<typeof signalSchema>;
export type Gain = z.infer<typeof gainSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type RunJob = z.infer<typeof jobSchema>;
export type RunMode = z.infer<typeof runModeSchema>;
export type SnapshotResult = z.infer<typeof snapshotRpc.output>;
