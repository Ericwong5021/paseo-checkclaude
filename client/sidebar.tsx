import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { scoreColor } from "./format";
import { useSnapshot } from "./hooks";
import { CheckClaudePopover } from "./popover";

/** Sidebar footer row: shows the last score and opens the score popover. */
export function CheckClaudeSidebarItem({
  theme,
  currentScreen,
  openPopover,
}: PluginSidebarItemProps) {
  const query = useSnapshot();
  const score = query.data?.snapshot?.score;
  return (
    <SidebarRow
      icon="ShieldCheck"
      label="CheckClaude"
      active={currentScreen?.screenId === "check"}
      trailing={
        typeof score === "number" ? (
          <Text style={{ color: scoreColor(theme, score), fontSize: 12, fontWeight: "600" }}>
            {score}
          </Text>
        ) : undefined
      }
      onPress={() => openPopover(CheckClaudePopover)}
    />
  );
}
