import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { scoreColor } from "./format";
import { useSnapshot } from "./hooks";

export function CheckClaudeSidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
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
      onPress={() => openScreen({ screenId: "check" })}
    />
  );
}
