import type { PluginServerContext } from "@getpaseo/plugin/server";
import { jobRpc, runCheckRpc, settingsDefinition, snapshotRpc } from "./shared/checkclaude";
import { resolveDataDir, resolveScript, unsupportedReason } from "./server/paths";
import { getJob, latestJob, readSnapshot, startJob } from "./server/run";

const DEFAULT_SETTINGS = {
  dataDir: "",
  scriptPath: "",
  timeoutSeconds: 240,
  browserProbe: "webview" as const,
};

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(settingsDefinition);

  async function currentSettings() {
    const state = await settings.read();
    return state.status === "ready" ? state.values : DEFAULT_SETTINGS;
  }

  server.handle(snapshotRpc, async () => {
    const values = await currentSettings();
    const dataDir = resolveDataDir(values.dataDir);
    const [file, scriptPath] = await Promise.all([
      readSnapshot(dataDir),
      resolveScript(values.scriptPath),
    ]);
    const lastJob = latestJob();
    return {
      snapshot: file.snapshot,
      updatedAt: file.updatedAt,
      dataDir,
      scriptPath,
      supported: unsupportedReason() === null,
      unsupportedReason: unsupportedReason(),
      lastReport: lastJob?.report ?? null,
      lastJob,
    };
  });

  server.handle(runCheckRpc, async ({ mode }) => {
    const values = await currentSettings();
    return {
      job: startJob(mode, {
        dataDir: values.dataDir,
        scriptPath: values.scriptPath,
        timeoutSeconds: values.timeoutSeconds,
        browserProbe: values.browserProbe,
      }),
    };
  });

  server.handle(jobRpc, async ({ id }) => {
    const job = getJob(id);
    if (!job) throw new Error(`Unknown check job: ${id}`);
    return { job };
  });

  return () => {};
}
