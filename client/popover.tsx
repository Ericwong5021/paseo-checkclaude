import type { PluginPopoverProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  fullCreditCount,
  groupSignals,
  relativeTime,
  scoreColor,
  scoreVerdict,
  type SignalGroup,
} from "./format";
import { useRunCheck, useSnapshot } from "./hooks";

type Theme = PluginPopoverProps["theme"];

function buildStyles(theme: Theme, compact: boolean) {
  return {
    root: { width: compact ? undefined : 340, gap: 12 },
    headerRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    headerTitle: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const, flexGrow: 1 },
    scoreRow: { flexDirection: "row" as const, alignItems: "flex-end" as const, gap: 6 },
    score: { fontSize: 40, fontWeight: "700" as const, lineHeight: 44 },
    scoreSuffix: { color: theme.colors.foregroundMuted, fontSize: 12, marginBottom: 6 },
    grade: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const, flexGrow: 1 },
    muted: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
    danger: { color: theme.colors.statusDanger, fontSize: 12, lineHeight: 17 },
    success: { color: theme.colors.statusSuccess, fontSize: 12 },
    barTrack: {
      height: 6,
      borderRadius: 999,
      backgroundColor: theme.colors.surface2,
      overflow: "hidden" as const,
    },
    barFill: { height: 6, borderRadius: 999 },
    groupRow: { gap: 4 },
    groupHeader: { flexDirection: "row" as const, alignItems: "baseline" as const, gap: 6 },
    groupName: { color: theme.colors.foreground, fontSize: 12, fontWeight: "500" as const, flexGrow: 1 },
    points: {
      color: theme.colors.foregroundMuted,
      fontSize: 11,
      fontVariant: ["tabular-nums" as const],
    },
    actions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    button: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: 1,
    },
    primaryButton: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent, flexGrow: 1 },
    primaryLabel: { color: theme.colors.accentForeground, fontSize: 12, fontWeight: "600" as const },
    secondaryButton: { backgroundColor: theme.colors.surface2, borderColor: theme.colors.border },
    secondaryLabel: { color: theme.colors.foreground, fontSize: 12, fontWeight: "500" as const },
    disabled: { opacity: 0.5 },
  };
}

type Styles = ReturnType<typeof buildStyles>;

/** Score popover opened from the sidebar row: total on top, one bar per signal group. */
export function CheckClaudePopover({ theme, layout, close, openScreen }: PluginPopoverProps) {
  const styles = useMemo(() => buildStyles(theme, layout.compact), [theme, layout.compact]);
  const query = useSnapshot();
  const runCheck = useRunCheck();
  const toast = useToast();

  const result = query.data;
  const snapshot = result?.snapshot ?? null;
  const groups = snapshot ? groupSignals(snapshot.signals) : [];
  const busy = runCheck.isPending;

  async function run() {
    try {
      const job = await runCheck.mutateAsync("report");
      if (job.status === "failed") toast.error(job.error ?? "CheckClaude reported a failure.");
      else toast.show("Check complete", { variant: "success" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CheckClaude failed to run.");
    }
  }

  function openDetails() {
    close();
    openScreen({ screenId: "check" });
  }

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>CheckClaude</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={busy ? "Checking" : "Refresh score"}
          disabled={busy}
          onPress={() => void run()}
          style={busy ? styles.disabled : undefined}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.colors.accent} />
          ) : (
            <Icon name="RefreshCw" size={15} color={theme.colors.foregroundMuted} />
          )}
        </Pressable>
      </View>

      {result && !result.supported ? (
        <Text style={styles.danger}>{result.unsupportedReason ?? "CheckClaude cannot run here."}</Text>
      ) : null}

      {query.isLoading ? (
        <View style={styles.scoreRow}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.muted}>Reading the last snapshot…</Text>
        </View>
      ) : snapshot ? (
        <>
          <View style={styles.scoreRow}>
            <Text style={[styles.score, { color: scoreColor(theme, snapshot.score) }]}>
              {snapshot.score}
            </Text>
            <Text style={styles.scoreSuffix}>/100</Text>
            <Text style={styles.grade}>{snapshot.grade || scoreVerdict(snapshot.score)}</Text>
          </View>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.max(0, Math.min(100, snapshot.score))}%`,
                  backgroundColor: scoreColor(theme, snapshot.score),
                },
              ]}
            />
          </View>
          <Text style={styles.muted} numberOfLines={2}>
            {snapshot.verdict}
          </Text>

          <View style={{ gap: 8 }}>
            {groups.map((group) => (
              <GroupRow key={group.name} group={group} styles={styles} theme={theme} />
            ))}
          </View>

          <Text style={styles.muted}>
            {fullCreditCount(snapshot)}/{snapshot.signals.length} signals at full points
            {snapshot.issues.length > 0 ? ` · ${snapshot.issues.length} problems` : " · no problems"}
            {result?.updatedAt ? ` · ${relativeTime(result.updatedAt)}` : ""}
          </Text>
        </>
      ) : (
        <Text style={styles.muted}>
          No snapshot yet. Run a check to score the exit route, DNS, timezone, and locale.
        </Text>
      )}

      {runCheck.data?.status === "failed" && runCheck.data.error ? (
        <Text style={styles.danger}>{runCheck.data.error}</Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Run check"
          disabled={busy || (result ? !result.supported : false)}
          onPress={() => void run()}
          style={[
            styles.button,
            styles.primaryButton,
            busy || (result ? !result.supported : false) ? styles.disabled : null,
          ]}
        >
          <Icon name="Play" size={13} color={theme.colors.accentForeground} />
          <Text style={styles.primaryLabel}>{busy ? "Checking…" : "Run check"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open details"
          onPress={openDetails}
          style={[styles.button, styles.secondaryButton]}
        >
          <Icon name="Maximize2" size={13} color={theme.colors.foreground} />
          <Text style={styles.secondaryLabel}>Details</Text>
        </Pressable>
      </View>
    </View>
  );
}

function GroupRow(props: { group: SignalGroup; styles: Styles; theme: Theme }) {
  const { group, styles, theme } = props;
  const ratio = group.weight > 0 ? group.points / group.weight : 0;
  const color =
    ratio >= 1 ? theme.colors.statusSuccess : ratio >= 0.6 ? theme.colors.statusWarning : theme.colors.statusDanger;
  return (
    <View style={styles.groupRow}>
      <View style={styles.groupHeader}>
        <Text style={styles.groupName}>{group.name}</Text>
        <Text style={styles.points}>
          {group.points}/{group.weight}
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.min(100, ratio * 100)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}
