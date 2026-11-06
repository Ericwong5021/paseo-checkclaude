import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { Gain, Snapshot } from "../shared/checkclaude";
import {
  DETAIL_FIELDS,
  fullCreditCount,
  groupSignals,
  relativeTime,
  scoreColor,
  scoreVerdict,
  sortGains,
  type SignalGroup,
} from "./format";
import { useRunCheck, useSnapshot } from "./hooks";

type Theme = PluginScreenProps["theme"];
type Styles = ReturnType<typeof buildStyles>;

function buildStyles(theme: Theme, compact: boolean) {
  const pad = compact ? 16 : 24;
  return {
    scroll: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: {
      padding: pad,
      gap: compact ? 12 : 16,
      maxWidth: 960,
      width: "100%" as const,
      alignSelf: "center" as const,
    },
    card: {
      backgroundColor: theme.colors.surface1,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 14,
      padding: compact ? 14 : 18,
      gap: 10,
    },
    row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
    rowWrap: {
      flexDirection: compact ? ("column" as const) : ("row" as const),
      alignItems: compact ? ("stretch" as const) : ("center" as const),
      gap: 10,
    },
    scoreRow: {
      flexDirection: compact ? ("column" as const) : ("row" as const),
      alignItems: compact ? ("flex-start" as const) : ("center" as const),
      gap: compact ? 6 : 20,
    },
    score: { fontSize: compact ? 44 : 56, fontWeight: "700" as const, lineHeight: compact ? 50 : 62 },
    scoreSuffix: { color: theme.colors.foregroundMuted, fontSize: 14, marginTop: 10 },
    title: { color: theme.colors.foreground, fontSize: compact ? 16 : 18, fontWeight: "600" as const },
    body: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
    muted: { color: theme.colors.foregroundMuted, fontSize: compact ? 12 : 13, lineHeight: 18 },
    sectionTitle: {
      color: theme.colors.foregroundMuted,
      fontSize: 11,
      fontWeight: "700" as const,
      letterSpacing: 0.6,
      textTransform: "uppercase" as const,
    },
    barTrack: {
      height: 8,
      borderRadius: 999,
      backgroundColor: theme.colors.surface2,
      overflow: "hidden" as const,
      flexGrow: 1,
      minWidth: 120,
    },
    barFill: { height: 8, borderRadius: 999 },
    button: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 8,
      paddingVertical: 11,
      paddingHorizontal: 16,
      borderRadius: 10,
      borderWidth: 1,
    },
    primaryButton: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    primaryLabel: { color: theme.colors.accentForeground, fontSize: 14, fontWeight: "600" as const },
    secondaryButton: { backgroundColor: theme.colors.surface2, borderColor: theme.colors.border },
    secondaryLabel: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" as const },
    disabled: { opacity: 0.5 },
    signalRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8 },
    signalLabel: { color: theme.colors.foreground, fontSize: 13, flexShrink: 1 },
    signalValue: { color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1 },
    points: { fontSize: 12, fontWeight: "600" as const, fontVariant: ["tabular-nums" as const] },
    detailRow: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "flex-start" as const,
      gap: 12,
    },
    detailLabel: { color: theme.colors.foregroundMuted, fontSize: 12 },
    detailValue: { color: theme.colors.foreground, fontSize: 12, flexShrink: 1, textAlign: "right" as const },
    listItem: { flexDirection: "row" as const, gap: 8, alignItems: "flex-start" as const },
    bullet: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
    itemText: { color: theme.colors.foreground, fontSize: 13, lineHeight: 19, flexShrink: 1 },
    notice: { color: theme.colors.statusDanger, fontSize: 13, lineHeight: 19 },
    success: { color: theme.colors.statusSuccess, fontSize: 13 },
    report: {
      color: theme.colors.foreground,
      fontSize: 12,
      lineHeight: 18,
    },
    modalBody: { padding: 16, gap: 8 },
  };
}

export function CheckClaudeScreen(props: PluginScreenProps) {
  const { theme, layout, params } = props;
  const styles = useMemo(() => buildStyles(theme, layout.compact), [theme, layout.compact]);
  const snapshotQuery = useSnapshot();
  const runCheck = useRunCheck();
  const toast = useToast();
  const [reportOpen, setReportOpen] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const handledAutorun = useRef<string | null>(null);

  const result = snapshotQuery.data;
  const snapshot = result?.snapshot ?? null;
  const busy = runCheck.isPending;
  const report = runCheck.data?.report ?? result?.lastReport ?? null;
  const failure = runCheck.data?.status === "failed" ? runCheck.data.error : null;

  async function run(mode: "report" | "fix") {
    setFixOpen(false);
    try {
      const job = await runCheck.mutateAsync(mode);
      if (job.status === "failed") {
        toast.error(job.error ?? "CheckClaude reported a failure.");
        return;
      }
      toast.show(job.mode === "fix" ? "Fixes applied" : "Check complete", { variant: "success" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CheckClaude failed to run.");
    }
  }

  useEffect(() => {
    const autorun = params.autorun;
    if (!autorun || handledAutorun.current === autorun) return;
    handledAutorun.current = autorun;
    void run(params.mode === "fix" ? "fix" : "report");
    // `run` is stable enough for a one-shot trigger keyed by the param.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.autorun, params.mode]);

  async function copyReport() {
    if (!report) {
      toast.error("No report to copy yet. Run a check first.");
      return;
    }
    try {
      await copyText(report);
      toast.show("Report copied", { variant: "success" });
    } catch {
      toast.error("Could not copy the report.");
    }
  }

  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {result && !result.supported ? (
          <View style={styles.card}>
            <Text style={styles.title}>Unsupported platform</Text>
            <Text style={styles.muted}>{result.unsupportedReason ?? "CheckClaude cannot run here."}</Text>
          </View>
        ) : null}

        <ScoreCard
          snapshot={snapshot}
          updatedAt={result?.updatedAt ?? null}
          busy={busy}
          loading={snapshotQuery.isLoading}
          theme={theme}
          styles={styles}
        />

        <View style={styles.rowWrap}>
          <ActionButton
            styles={styles}
            theme={theme}
            primary
            icon="Play"
            label={busy ? "Checking…" : "Run check"}
            disabled={busy || (result ? !result.supported : false)}
            onPress={() => void run("report")}
          />
          <ActionButton
            styles={styles}
            theme={theme}
            icon="Wrench"
            label="Fix safe items"
            disabled={busy || (result ? !result.supported : false)}
            onPress={() => setFixOpen(true)}
          />
          <ActionButton
            styles={styles}
            theme={theme}
            icon="FileText"
            label="View report"
            disabled={!report}
            onPress={() => setReportOpen(true)}
          />
          <ActionButton
            styles={styles}
            theme={theme}
            icon="Copy"
            label="Copy"
            disabled={!report}
            onPress={() => void copyReport()}
          />
        </View>

        {busy ? (
          <View style={[styles.card, styles.row]}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.muted}>
              Probing exit routes, DNS, timezone, and locale. This usually takes 20 to 60 seconds.
            </Text>
          </View>
        ) : null}

        {failure ? <Text style={styles.notice}>{failure}</Text> : null}
        {snapshotQuery.isError ? (
          <Text style={styles.notice}>
            Could not read the snapshot:{" "}
            {snapshotQuery.error instanceof Error ? snapshotQuery.error.message : "unknown error"}
          </Text>
        ) : null}

        {snapshot ? (
          <>
            <GainsCard gains={snapshot.gains} styles={styles} theme={theme} />
            <SignalsCard groups={groupSignals(snapshot.signals)} styles={styles} theme={theme} />
            <IssuesCard snapshot={snapshot} styles={styles} theme={theme} />
            <DetailsCard snapshot={snapshot} styles={styles} />
            {result ? <Footer result={result} styles={styles} /> : null}
          </>
        ) : (
          !snapshotQuery.isLoading && result?.supported ? (
            <View style={styles.card}>
              <Text style={styles.title}>No check has run yet</Text>
              <Text style={styles.muted}>
                Run a check to score how consistent this machine looks to Claude: exit route, DNS,
                timezone, locale, and browser fingerprint.
              </Text>
            </View>
          ) : null
        )}
      </ScrollView>

      <Modal
        title="CheckClaude report"
        icon={<Icon name="FileText" size={18} color={theme.colors.foreground} />}
        open={reportOpen}
        onOpenChange={setReportOpen}
      >
        <Modal.Content scrollable={false}>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text selectable style={styles.report}>
              {report ?? "No report yet."}
            </Text>
          </ScrollView>
        </Modal.Content>
      </Modal>

      <Modal
        title="Apply safe fixes?"
        icon={<Icon name="Wrench" size={18} color={theme.colors.foreground} />}
        open={fixOpen}
        onOpenChange={setFixOpen}
      >
        <Modal.Content>
          <Text style={styles.body}>
            CheckClaude applies the reversible fixes it can make without administrator rights, such as
            switching DNS resolvers, then scores the machine again.
          </Text>
          <Text style={styles.muted}>
            Changes that need sudo stay listed as manual steps. You can revert any applied change from
            System Settings.
          </Text>
          <View style={styles.rowWrap}>
            <ActionButton
              styles={styles}
              theme={theme}
              primary
              icon="Check"
              label="Apply fixes"
              onPress={() => void run("fix")}
            />
            <ActionButton
              styles={styles}
              theme={theme}
              icon="X"
              label="Cancel"
              onPress={() => setFixOpen(false)}
            />
          </View>
        </Modal.Content>
      </Modal>
    </>
  );
}

function ScoreCard(props: {
  snapshot: Snapshot | null;
  updatedAt: string | null;
  busy: boolean;
  loading: boolean;
  theme: Theme;
  styles: Styles;
}) {
  const { snapshot, updatedAt, busy, loading, theme, styles } = props;
  if (loading) {
    return (
      <View style={[styles.card, styles.row]}>
        <ActivityIndicator color={theme.colors.accent} />
        <Text style={styles.muted}>Reading the last snapshot…</Text>
      </View>
    );
  }
  if (!snapshot) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Claude environment</Text>
        <Text style={styles.muted}>No snapshot yet.</Text>
      </View>
    );
  }
  const color = scoreColor(theme, snapshot.score);
  const full = fullCreditCount(snapshot);
  const ratio = Math.max(0, Math.min(1, snapshot.score / 100));
  return (
    <View style={styles.card}>
      <View style={styles.scoreRow}>
        <View style={styles.row}>
          <Text style={[styles.score, { color }]}>{snapshot.score}</Text>
          <Text style={styles.scoreSuffix}>/100</Text>
        </View>
        <View style={{ flexShrink: 1, gap: 4 }}>
          <Text style={styles.title}>
            {snapshot.grade || scoreVerdict(snapshot.score)}
            {snapshot.riskLevel ? ` · ${snapshot.riskLevel}` : ""}
          </Text>
          <Text style={styles.body}>{snapshot.verdict}</Text>
          <Text style={styles.muted}>
            {full}/{snapshot.signals.length} signals at full points
            {updatedAt ? ` · checked ${relativeTime(updatedAt)}` : ""}
            {busy ? " · rechecking…" : ""}
          </Text>
        </View>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${ratio * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function ActionButton(props: {
  styles: Styles;
  theme: Theme;
  icon: string;
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const { styles, theme, icon, label, onPress, primary, disabled } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        primary ? styles.primaryButton : styles.secondaryButton,
        disabled ? styles.disabled : null,
      ]}
    >
      <Icon
        name={icon}
        size={16}
        color={primary ? theme.colors.accentForeground : theme.colors.foreground}
      />
      <Text style={primary ? styles.primaryLabel : styles.secondaryLabel}>{label}</Text>
    </Pressable>
  );
}

function GainsCard(props: { gains: readonly Gain[]; styles: Styles; theme: Theme }) {
  const { gains, styles, theme } = props;
  const sorted = sortGains(gains);
  if (sorted.length === 0) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Points still available</Text>
      {sorted.map((gain) => (
        <View key={`${gain.label}-${gain.points}`} style={styles.listItem}>
          <Text style={[styles.points, { color: theme.colors.statusWarning }]}>+{gain.points}</Text>
          <View style={{ flexShrink: 1, gap: 1 }}>
            <Text style={styles.itemText}>{gain.label}</Text>
            {gain.hint ? <Text style={styles.signalValue}>{gain.hint}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function SignalsCard(props: { groups: SignalGroup[]; styles: Styles; theme: Theme }) {
  const { groups, styles, theme } = props;
  if (groups.length === 0) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Signals</Text>
      {groups.map((group) => (
        <View key={group.name} style={{ gap: 8, marginTop: 4 }}>
          <View style={styles.row}>
            <Text style={styles.title}>{group.name}</Text>
            <Text style={styles.muted}>
              {group.points}/{group.weight}
            </Text>
          </View>
          {group.rows.map((signal) => {
            const full = signal.points >= signal.weight;
            return (
              <View key={`${group.name}-${signal.label}`} style={styles.signalRow}>
                <Icon
                  name={full ? "CircleCheck" : "TriangleAlert"}
                  size={14}
                  color={full ? theme.colors.statusSuccess : theme.colors.statusWarning}
                />
                <View style={{ flexShrink: 1, gap: 1, flexGrow: 1 }}>
                  <Text style={styles.signalLabel}>{signal.label}</Text>
                  {signal.value ? <Text style={styles.signalValue}>{signal.value}</Text> : null}
                </View>
                <Text
                  style={[
                    styles.points,
                    { color: full ? theme.colors.foregroundMuted : theme.colors.statusWarning },
                  ]}
                >
                  {signal.points}/{signal.weight}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function IssuesCard(props: { snapshot: Snapshot; styles: Styles; theme: Theme }) {
  const { snapshot, styles, theme } = props;
  if (snapshot.issues.length === 0 && snapshot.fixes.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.success}>No contradictory environment signals found.</Text>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      {snapshot.issues.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Problems</Text>
          {snapshot.issues.map((issue, index) => (
            <View key={`issue-${index}`} style={styles.listItem}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.itemText}>{issue}</Text>
            </View>
          ))}
        </>
      ) : null}
      {snapshot.fixes.length > 0 ? (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 6 }]}>What to do</Text>
          {snapshot.fixes.map((fix, index) => (
            <View key={`fix-${index}`} style={styles.listItem}>
              <Text style={[styles.bullet, { color: theme.colors.accent }]}>→</Text>
              <Text style={styles.itemText}>{fix}</Text>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

function DetailsCard(props: { snapshot: Snapshot; styles: Styles }) {
  const { snapshot, styles } = props;
  const rows = DETAIL_FIELDS.map((field) => ({ ...field, value: snapshot.values[field.key] }))
    .filter((row): row is { key: string; label: string; value: string } => Boolean(row.value?.trim()))
    .slice(0, 12);
  if (rows.length === 0) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Details</Text>
      {rows.map((row) => (
        <View key={row.key} style={styles.detailRow}>
          <Text style={styles.detailLabel}>{row.label}</Text>
          <Text style={styles.detailValue}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

function Footer(props: {
  result: NonNullable<ReturnType<typeof useSnapshot>["data"]>;
  styles: Styles;
}) {
  const { result, styles } = props;
  return (
    <Text style={styles.muted}>
      {result.dataDir}
      {result.scriptPath ? ` · ${result.scriptPath}` : " · bundled script"}
    </Text>
  );
}
