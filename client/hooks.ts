import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { useState } from "react";
import type { RunJob, RunMode } from "../shared/checkclaude";
import { jobRpc, runCheckRpc, snapshotRpc } from "../shared/checkclaude";

export const CHECKCLAUDE_QUERY_KEY = ["checkclaude"] as const;
const SNAPSHOT_KEY = [...CHECKCLAUDE_QUERY_KEY, "snapshot"] as const;

/** Cached snapshot of the last check, read from the daemon's CheckClaude data directory. */
export function useSnapshot() {
  const fetchSnapshot = useRpc(snapshotRpc);
  return useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: () => fetchSnapshot({}),
    staleTime: 20_000,
  });
}

const POLL_INTERVAL_MS = 1200;
const POLL_BUDGET_MS = 20 * 60 * 1000;

export type RunStage = "browser" | "check" | null;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a check on the daemon and follows its job until it finishes. The job first
 * collects browser signals with CheckClaude's own probe, then scores the machine,
 * so the RPC only starts work and polling reports progress.
 */
export function useRunCheck() {
  const start = useRpc(runCheckRpc);
  const pollJob = useRpc(jobRpc);
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<RunStage>(null);

  const mutation = useMutation<RunJob, Error, RunMode>({
    mutationFn: async (mode) => {
      setStage(null);
      const started = await start({ mode });
      let job = started.job;
      const deadline = Date.now() + POLL_BUDGET_MS;
      setStage(job.stage);
      while (job.status === "running") {
        if (Date.now() > deadline) throw new Error("CheckClaude is still running. Try again in a moment.");
        await wait(POLL_INTERVAL_MS);
        const next = await pollJob({ id: job.id });
        job = next.job;
        setStage(job.stage);
      }
      setStage(null);
      return job;
    },
    onSettled: () => {
      setStage(null);
      void queryClient.invalidateQueries({ queryKey: CHECKCLAUDE_QUERY_KEY });
    },
  });

  return { ...mutation, stage };
}
