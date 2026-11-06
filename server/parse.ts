import type { Gain, Signal, Snapshot } from "../shared/checkclaude";

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

function splitList(value: string, separator: string): string[] {
  return value
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseSignals(value: string): Signal[] {
  const signals: Signal[] = [];
  for (const row of splitList(value, ";")) {
    const [group, label, weight, points, ...rest] = row.split("~");
    if (!group || !label) continue;
    signals.push({
      group,
      label,
      weight: Number(weight) || 0,
      points: Number(points) || 0,
      value: rest.join("~").trim(),
    });
  }
  return signals;
}

function parseGains(value: string): Gain[] {
  const gains: Gain[] = [];
  for (const row of splitList(value, "|")) {
    const [label, points, ...rest] = row.split("~");
    if (!label) continue;
    gains.push({
      label,
      points: Number(points) || 0,
      hint: rest.join("~").trim(),
    });
  }
  return gains;
}

/** Parses a `claude_status` key=value file into a structured snapshot. */
export function parseStatusFile(text: string): Snapshot | null {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    values[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  if (!("score" in values)) return null;

  return {
    checkedAt: values.time ?? "",
    score: Number(values.score) || 0,
    grade: values.grade ?? "",
    riskLevel: values.risklevel ?? "",
    safeUse: values.safeuse === "1",
    verdict: values.verdict ?? "",
    signals: parseSignals(values.signals ?? ""),
    gains: parseGains(values.gains ?? ""),
    issues: splitList(values.issues ?? "", "|"),
    fixes: splitList(values.fixes ?? "", "|"),
    values,
  };
}
