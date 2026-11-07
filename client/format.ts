import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { Gain, Signal, Snapshot } from "../shared/checkclaude";

type Theme = PluginScreenProps["theme"];

export interface SignalGroup {
  name: string;
  rows: Signal[];
  points: number;
  weight: number;
}

/** Groups scored signals in their original order, with per-group totals. */
export function groupSignals(signals: readonly Signal[]): SignalGroup[] {
  const groups: SignalGroup[] = [];
  for (const signal of signals) {
    let group = groups[groups.length - 1];
    if (!group || group.name !== signal.group) {
      group = { name: signal.group, rows: [], points: 0, weight: 0 };
      groups.push(group);
    }
    group.rows.push(signal);
    group.points += signal.points;
    group.weight += signal.weight;
  }
  return groups;
}

export function scoreColor(theme: Theme, score: number): string {
  if (score >= 90) return theme.colors.statusSuccess;
  if (score >= 70) return theme.colors.statusWarning;
  return theme.colors.statusDanger;
}

export function scoreVerdict(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Risky";
  return "Unsafe";
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Renders an ISO timestamp as a short relative age, or an empty string when invalid. */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const delta = Math.max(0, now - time);
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} min ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)} h ago`;
  return `${Math.floor(delta / DAY)} d ago`;
}

/** Signals that already have full points, used for the summary line. */
export function fullCreditCount(snapshot: Snapshot): number {
  return snapshot.signals.filter((signal) => signal.points >= signal.weight).length;
}

export function sortGains(gains: readonly Gain[]): Gain[] {
  return [...gains].sort((left, right) => right.points - left.points);
}

/** Detail rows worth showing above the fold, keyed by claude_status field. */
export const DETAIL_FIELDS: readonly { key: string; label: string }[] = [
  { key: "probe_state", label: "Route probe" },
  { key: "probe_detail", label: "Route probe details" },
  { key: "ip", label: "Exit IP" },
  { key: "countryname", label: "Country" },
  { key: "city", label: "City" },
  { key: "isp", label: "ISP" },
  { key: "asn", label: "ASN" },
  { key: "iptype", label: "IP type" },
  { key: "dns", label: "DNS" },
  { key: "dnsresult", label: "claude.ai DNS" },
  { key: "systz", label: "System timezone" },
  { key: "iptz", label: "Exit timezone" },
  { key: "locale", label: "Locale" },
  { key: "proxymode", label: "Proxy mode" },
  { key: "ipchanges", label: "IP changes (24h)" },
  { key: "os", label: "System" },
  { key: "claudever", label: "Claude Code" },
  { key: "base", label: "API base" },
  { key: "brapi", label: "Browser to API" },
  { key: "brrtc", label: "WebRTC exit" },
];

/** Informational route notices do not change the score's normal color. */
export function snapshotColor(theme: Theme, snapshot: Snapshot): string {
  return scoreColor(theme, snapshot.score);
}
