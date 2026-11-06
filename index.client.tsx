import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CheckClaudeScreen } from "./client/checkclaude-screen";
import { CheckClaudeSettings } from "./client/checkclaude-settings";
import { CheckClaudeSidebarItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "check", title: "CheckClaude", Component: CheckClaudeScreen });
  client.addSettingsScreen({
    id: "settings",
    title: "CheckClaude",
    icon: "ShieldCheck",
    Component: CheckClaudeSettings,
  });
  client.addSidebarFooterItem({ id: "check", title: "CheckClaude", Component: CheckClaudeSidebarItem });

  client.addCommandCenterItem({
    id: "checkclaude-run",
    title: "Check Claude environment",
    icon: "ShieldCheck",
    keywords: ["claude", "checkclaude", "environment", "score", "fingerprint"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "check", params: { autorun: String(Date.now()), mode: "report" } });
    },
  });

  client.addCommandCenterItem({
    id: "checkclaude-fix",
    title: "Fix Claude environment",
    icon: "Wrench",
    keywords: ["claude", "checkclaude", "dns", "timezone", "repair"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "check", params: { autorun: String(Date.now()), mode: "fix" } });
    },
  });

  client.addSlashCommand({
    name: "checkclaude",
    description: "Score this machine's Claude environment",
    argumentHint: "[fix]",
    context: "workspace",
    onSubmit({ args, openScreen }) {
      const mode = args.trim().toLowerCase() === "fix" ? "fix" : "report";
      openScreen({ screenId: "check", params: { autorun: String(Date.now()), mode } });
    },
  });

  return () => {};
}
