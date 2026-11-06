import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
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

const POLL_INTERVAL_MS = 1500;
const POLL_BUDGET_MS = 15 * 60 * 1000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a check on the daemon and follows its job until it finishes. The run
 * takes 20 to 60 seconds, so the RPC only starts work and polling reports it.
 */
export function useRunCheck() {
  const start = useRpc(runCheckRpc);
  const pollJob = useRpc(jobRpc);
  const queryClient = useQueryClient();

  return useMutation<RunJob, Error, RunMode>({
    mutationFn: async (mode) => {
      const started = await start({ mode });
      let job = started.job;
      const deadline = Date.now() + POLL_BUDGET_MS;
      while (job.status === "running") {
        if (Date.now() > deadline) throw new Error("CheckClaude is still running. Try again in a moment.");
        await wait(POLL_INTERVAL_MS);
        const next = await pollJob({ id: job.id });
        job = next.job;
      }
      return job;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: CHECKCLAUDE_QUERY_KEY });
    },
  });
}
