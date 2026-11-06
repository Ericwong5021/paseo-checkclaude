import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsSelect,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text, View } from "react-native";
import { settingsDefinition } from "../shared/checkclaude";

interface Draft {
  dataDir: string;
  scriptPath: string;
  timeout: string;
  browserProbe: "webview" | "browser" | "off";
}

export function CheckClaudeSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(settingsDefinition);
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);

  const muted = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 };
  const danger = { color: theme.colors.statusDanger, fontSize: 13, lineHeight: 19 };

  if (settings.status === "loading") {
    return <Text style={muted}>Loading settings…</Text>;
  }

  if (settings.status === "invalid" || settings.status === "error") {
    const message =
      settings.error.length > 0 ? settings.error : "Could not load settings.";
    return (
      <View style={{ gap: 12 }}>
        <Text style={danger}>{message}</Text>
        <SettingsSection title="Recovery">
          <SettingsCard>
            <SettingsAction
              label="Saved values are unusable"
              hint="Reset writes the defaults back over the stored document."
              actionLabel="Reset"
              onPress={() => {
                void settings.reset().then((ok) => {
                  if (ok) toast.show("Settings reset", { variant: "success" });
                  else toast.show("Could not reset settings", { variant: "error" });
                });
              }}
            />
          </SettingsCard>
        </SettingsSection>
      </View>
    );
  }

  const values = settings.values;
  const revision = settings.revision;
  const current: Draft = draft ?? {
    dataDir: values.dataDir,
    scriptPath: values.scriptPath,
    timeout: String(values.timeoutSeconds),
    browserProbe: values.browserProbe,
  };

  function update(patch: Partial<Draft>) {
    setDraft({ ...current, ...patch });
  }

  async function save() {
    const timeoutSeconds = Number.parseInt(current.timeout.trim(), 10);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 900) {
      toast.error("Timeout must be a whole number between 30 and 900 seconds.");
      return;
    }
    const ok = await settings.save(
      {
        dataDir: current.dataDir.trim(),
        scriptPath: current.scriptPath.trim(),
        timeoutSeconds,
        browserProbe: current.browserProbe,
      },
      revision,
    );
    if (ok) {
      setDraft(null);
      toast.show("Settings saved", { variant: "success" });
      return;
    }
    toast.error(settings.saveError ?? "Could not save settings.");
  }

  return (
    <View style={{ gap: 8 }}>
      <SettingsSection
        title="Data directory"
        info="Where claude-check.sh writes claude_status, route history, and logs. Leave empty to share the CheckClaude app directory."
      >
        <SettingsCard>
          <SettingsInput
            label="Directory"
            hint="Absolute path. Empty uses the CheckClaude default for this platform."
            placeholder="~/Library/Application Support/CheckClaude"
            initialValue={current.dataDir}
            onChangeText={(dataDir) => update({ dataDir })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Script"
        info="The plugin bundles the upstream claude-check.sh. Point this at another copy to use it instead."
      >
        <SettingsCard>
          <SettingsInput
            label="claude-check.sh path"
            hint="Absolute path to a claude-check.sh. Leave empty to use the bundled copy."
            placeholder="/Applications/CheckClaude.app/Contents/Resources/claude-check.sh"
            initialValue={current.scriptPath}
            onChangeText={(scriptPath) => update({ scriptPath })}
          />
          <SettingsInput
            label="Timeout"
            hint="Seconds before a stalled run is stopped."
            placeholder="240"
            initialValue={current.timeout}
            onChangeText={(timeout) => update({ timeout })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Browser signals"
        info="WebRTC exit, browser timezone and language, fonts, and rendering come from CheckClaude's own probe, compiled from its menu bar app. It runs on demand and exits, so nothing stays resident."
      >
        <SettingsCard>
          <SettingsSelect
            label="Probe"
            hint="WebView is silent and takes about five seconds. Browser opens your default browser once for the real fingerprint, including Client Hints."
            value={current.browserProbe}
            options={[
              { label: "WebView (silent)", value: "webview" },
              { label: "Default browser", value: "browser" },
              { label: "Off", value: "off" },
            ]}
            onValueChange={(browserProbe) =>
              update({ browserProbe: browserProbe as Draft["browserProbe"] })
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Apply">
        <SettingsCard>
          <SettingsAction
            label="Save settings"
            hint={draft ? "Changes are not saved yet." : "Saved values match the fields above."}
            actionLabel={settings.saving ? "Saving…" : "Save"}
            disabled={settings.saving || !draft}
            onPress={() => void save()}
          />
          <SettingsAction
            label="Reset to defaults"
            hint="Uses the shared CheckClaude directory, the bundled script, and a 240 second timeout."
            actionLabel="Reset"
            disabled={settings.saving}
            onPress={() => {
              setDraft(null);
              void settings.reset().then((ok) => {
                if (ok) toast.show("Settings reset", { variant: "success" });
                else toast.show("Could not reset settings", { variant: "error" });
              });
            }}
          />
        </SettingsCard>
      </SettingsSection>

      {settings.saveError ? <Text style={danger}>{settings.saveError}</Text> : null}
    </View>
  );
}
