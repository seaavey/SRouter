import { Terminal, Sparkles, Radio, Code2, Bot, FileJson, PenTool } from "lucide-react";
import type { AppSettings } from "@/hooks/useSettings";
import { Switch } from "@/components/ui/switch";
import { SettingsSection, SettingsRow, SegmentedControl, ValueBadge } from "./settings.ui";

interface PlaygroundSettingsProps {
    settings: AppSettings;
    updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

const PRESETS = [
    {
        name: "General",
        icon: Bot,
        prompt: "You are a helpful, versatile, and precise AI assistant."
    },
    {
        name: "Engineer",
        icon: Code2,
        prompt: "You are a senior full-stack software engineer. Provide robust, clean, idiomatic code with clear explanations and best practices."
    },
    {
        name: "JSON",
        icon: FileJson,
        prompt: "You are an automated data extractor. Always output raw, valid JSON only without markdown formatting or introductory text."
    },
    {
        name: "Writer",
        icon: PenTool,
        prompt: "You are an expert technical writer. Explain complex engineering concepts clearly using concise metaphors and structured tables."
    }
];

export function PlaygroundSettings({ settings, updateSetting }: PlaygroundSettingsProps) {
    return (
        <SettingsSection
            index="05"
            title="Playground"
            description="Default inference parameters for new playground sessions."
        >
            <SettingsRow
                title="Temperature"
                control={<ValueBadge>{settings.defaultTemperature.toFixed(2)}</ValueBadge>}
            />
            <div className="py-2 space-y-1">
                <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={settings.defaultTemperature}
                    onChange={(e) =>
                        updateSetting("defaultTemperature", parseFloat(e.target.value))
                    }
                    className="w-full accent-foreground cursor-pointer h-1 rounded-lg bg-muted appearance-none"
                />
                <div className="flex justify-between text-[9px] font-mono text-muted-foreground">
                    <span>0.0</span>
                    <span>0.7</span>
                    <span>2.0</span>
                </div>
            </div>

            <SettingsRow
                title="Top P"
                control={<ValueBadge>{settings.defaultTopP.toFixed(2)}</ValueBadge>}
            />
            <div className="py-2 space-y-1">
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.defaultTopP}
                    onChange={(e) => updateSetting("defaultTopP", parseFloat(e.target.value))}
                    className="w-full accent-foreground cursor-pointer h-1 rounded-lg bg-muted appearance-none"
                />
                <div className="flex justify-between text-[9px] font-mono text-muted-foreground">
                    <span>0.0</span>
                    <span>0.95</span>
                    <span>1.0</span>
                </div>
            </div>

            <SettingsRow
                title="Max Output Tokens"
                control={<ValueBadge>{settings.defaultMaxTokens.toLocaleString()}</ValueBadge>}
            />
            <div className="py-2">
                <SegmentedControl
                    options={[1024, 2048, 4096, 8192, 16384].map((t) => ({
                        value: t,
                        label: t >= 1000 ? `${t / 1024}k` : `${t}`
                    }))}
                    value={settings.defaultMaxTokens}
                    onChange={(t) => updateSetting("defaultMaxTokens", t)}
                />
            </div>

            <SettingsRow
                title="Stream by Default"
                description="Enable real-time token streaming in the playground."
                control={
                    <Switch
                        checked={settings.streamResponse}
                        onCheckedChange={(val) => updateSetting("streamResponse", val)}
                    />
                }
            />

            <SettingsRow title="Default System Prompt" description="Quick presets:" />
            <div className="flex flex-wrap gap-1.5 pb-2">
                {PRESETS.map(({ name, icon: Icon, prompt }) => (
                    <button
                        key={name}
                        type="button"
                        onClick={() => updateSetting("systemPromptDefault", prompt)}
                        className="flex items-center gap-1 rounded-md border border-border/70 bg-background hover:bg-muted/60 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                        <Icon className="size-3" />
                        {name}
                    </button>
                ))}
            </div>
            <textarea
                rows={3}
                value={settings.systemPromptDefault}
                onChange={(e) => updateSetting("systemPromptDefault", e.target.value)}
                placeholder="Enter default system instructions..."
                className="w-full rounded-md border border-border/70 bg-background p-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
        </SettingsSection>
    );
}
