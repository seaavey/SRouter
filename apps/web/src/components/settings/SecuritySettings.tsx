import { useState, type FormEvent } from "react";
import { Check, Copy, Eye, EyeOff, KeyRound, Shield, ShieldAlert, Unlock } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsSection, SegmentedControl, ValueBadge } from "./settings-ui";

interface SecuritySettingsProps {
    requireApiKey: boolean;
    onToggleRequireApiKey: (value: boolean) => void;
    isUpdating: boolean;
    apiBase: string;
}

type CodeTab = "curl" | "typescript" | "python";

export function SecuritySettings({
    requireApiKey,
    onToggleRequireApiKey,
    isUpdating,
    apiBase
}: SecuritySettingsProps) {
    const [codeTab, setCodeTab] = useState<CodeTab>("curl");
    const [copied, setCopied] = useState(false);

    // Password change state
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [showPasswords, setShowPasswords] = useState(false);

    const getSnippet = (tab: CodeTab) => {
        if (tab === "curl") {
            return `curl ${apiBase}/chat/completions \\
  -H "Content-Type: application/json" \\
${
    requireApiKey
        ? '  -H "Authorization: Bearer sr-liv..._key" \\\n'
        : '  # -H "Authorization: Bearer ***" \\\n'
}  -d '{
    "model": "antigravity/gemini-2.5-flash",
    "messages": [
      { "role": "user", "content": "Explain quantum computing in one sentence." }
    ]
  }'`;
        }

        if (tab === "typescript") {
            return `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${apiBase}",
  apiKey: "${requireApiKey ? "sr-live-your_virtual_key" : "optional_or_any_string"}",
});

async function main() {
  const response = await client.chat.completions.create({
    model: "antigravity/gemini-2.5-flash",
    messages: [{ role: "user", content: "Hello SRouter!" }],
  });

  console.log(response.choices[0].message.content);
}

main();`;
        }

        return `from openai import OpenAI

client = OpenAI(
    base_url="${apiBase}",
    api_key="${requireApiKey ? "sr-live-your_virtual_key" : "optional_or_any_string"}"
)

response = client.chat.completions.create(
    model="antigravity/gemini-2.5-flash",
    messages=[{"role": "user", "content": "Hello SRouter!"}]
)

print(response.choices[0].message.content)`;
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(getSnippet(codeTab));
            setCopied(true);
            toast.success("Code snippet copied to clipboard");
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast.error("Failed to copy code snippet");
        }
    };

    const handleChangePassword = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setPasswordError(null);

        if (!currentPassword) {
            setPasswordError("Please enter your current admin password.");
            return;
        }

        if (newPassword !== confirmation) {
            setPasswordError("New password and confirmation do not match.");
            return;
        }

        setIsChangingPassword(true);
        try {
            await api.post("/v1/admin/change-password", {
                current_password: currentPassword,
                new_password: newPassword,
                confirmation
            });
            toast.success("Admin password changed successfully");
            setCurrentPassword("");
            setNewPassword("");
            setConfirmation("");
        } catch (err) {
            const msg = err instanceof ApiError ? err.message : "Failed to change admin password";
            setPasswordError(msg);
            toast.error(msg);
        } finally {
            setIsChangingPassword(false);
        }
    };

    return (
        <div className="space-y-5">
            {/* Section 1: API Key Enforcement */}
            <SettingsSection
                title="API Key Authentication"
                description="Control whether external clients must provide a Bearer API Key to access gateway routing endpoints."
                icon={<KeyRound className="size-4" />}
            >
                <div className="flex flex-col gap-4 rounded-xl border border-border/60 bg-muted/20 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                                Enforce Bearer Authentication
                                {requireApiKey ? (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-500">
                                        <Shield className="size-2.5" />
                                        Protected
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-500">
                                        <Unlock className="size-2.5" />
                                        Open
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                                {requireApiKey
                                    ? "Gateway endpoints will reject unauthenticated requests with HTTP 401."
                                    : "Open access mode: anyone can query without an API key."}
                            </p>
                        </div>
                        <SegmentedControl
                            options={[
                                { value: false, label: "Disabled" },
                                { value: true, label: "Required" }
                            ]}
                            value={requireApiKey}
                            onChange={onToggleRequireApiKey}
                            disabled={isUpdating}
                        />
                    </div>

                    {/* Client Request Code Preview */}
                    <div className="space-y-2 pt-2 border-t border-border/50">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                Client Integration Example
                            </span>
                            <SegmentedControl
                                options={[
                                    { value: "curl", label: "cURL" },
                                    { value: "typescript", label: "TS" },
                                    { value: "python", label: "Python" }
                                ]}
                                value={codeTab}
                                onChange={setCodeTab}
                            />
                        </div>

                        <div className="relative rounded-xl border border-border/70 bg-background p-3 font-mono text-[11px] leading-relaxed text-foreground overflow-x-auto">
                            <button
                                type="button"
                                onClick={handleCopy}
                                className="absolute top-2 right-2 flex items-center gap-1 rounded-lg bg-muted/70 px-2 py-1 text-[10px] font-semibold text-foreground opacity-0 transition-opacity hover:bg-muted focus:opacity-100 group-hover:opacity-100 cursor-pointer"
                                title="Copy code"
                            >
                                {copied ? (
                                    <Check className="size-3 text-emerald-500" />
                                ) : (
                                    <Copy className="size-3" />
                                )}
                                <span>{copied ? "Copied" : "Copy"}</span>
                            </button>
                            <pre className="pr-16">{getSnippet(codeTab)}</pre>
                        </div>
                    </div>
                </div>
            </SettingsSection>

            {/* Section 2: Admin Password */}
            <SettingsSection
                title="Admin Control Plane Password"
                description="Update the master administrator password used to lock settings, provider credentials, and token configurations."
                icon={<Shield className="size-4" />}
            >
                <form onSubmit={handleChangePassword} className="space-y-4 max-w-lg">
                    {passwordError && (
                        <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                            <ShieldAlert className="size-4 shrink-0 mt-0.5" />
                            <span>{passwordError}</span>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-foreground">
                            Current Password
                        </label>
                        <Input
                            type={showPasswords ? "text" : "password"}
                            placeholder="Enter current admin password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            required
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-foreground">
                                New Password
                            </label>
                            <Input
                                type={showPasswords ? "text" : "password"}
                                placeholder="New password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-foreground">
                                Confirm New Password
                            </label>
                            <Input
                                type={showPasswords ? "text" : "password"}
                                placeholder="Repeat new password"
                                value={confirmation}
                                onChange={(e) => setConfirmation(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Button
                            type="submit"
                            size="sm"
                            disabled={isChangingPassword}
                            className="font-semibold"
                        >
                            <KeyRound className="size-3.5" />
                            <span>{isChangingPassword ? "Updating..." : "Update Password"}</span>
                        </Button>
                        <button
                            type="button"
                            onClick={() => setShowPasswords(!showPasswords)}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                        >
                            {showPasswords ? (
                                <EyeOff className="size-3" />
                            ) : (
                                <Eye className="size-3" />
                            )}
                            <span>{showPasswords ? "Hide" : "Show"} passwords</span>
                        </button>
                    </div>
                </form>
            </SettingsSection>
        </div>
    );
}
