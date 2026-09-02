import { useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsSection, SettingsRow, SegmentedControl } from "./settings.ui";

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
            toast.success("Code snippet copied");
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
        <SettingsSection
            index="01"
            title="Security"
            description="API key enforcement and the admin control plane password."
        >
            <SettingsRow
                title="Enforce Bearer Authentication"
                description={
                    requireApiKey
                        ? "Unauthenticated requests are rejected with HTTP 401."
                        : "Anyone can query without an API key."
                }
                control={
                    <SegmentedControl
                        options={[
                            { value: false, label: "OFF" },
                            { value: true, label: "ON" }
                        ]}
                        value={requireApiKey}
                        onChange={onToggleRequireApiKey}
                        disabled={isUpdating}
                    />
                }
            />

            <div className="py-3.5">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Client Integration
                    </span>
                    <SegmentedControl
                        options={[
                            { value: "curl", label: "curl" },
                            { value: "typescript", label: "ts" },
                            { value: "python", label: "py" }
                        ]}
                        value={codeTab}
                        onChange={setCodeTab}
                    />
                </div>
                <div className="relative rounded-md border border-border/70 bg-background p-3 font-mono text-[10.5px] leading-relaxed text-foreground overflow-x-auto">
                    <button
                        type="button"
                        onClick={handleCopy}
                        className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                        {copied ? (
                            <Check className="size-2.5 text-emerald-500" />
                        ) : (
                            <Copy className="size-2.5" />
                        )}
                        {copied ? "done" : "copy"}
                    </button>
                    <pre className="pr-14">{getSnippet(codeTab)}</pre>
                </div>
            </div>

            <div className="py-3.5">
                <div className="mb-2 text-xs font-semibold text-foreground">Admin Password</div>
                <form onSubmit={handleChangePassword} className="space-y-2 max-w-xl">
                    {passwordError && (
                        <div className="text-[11px] text-destructive">{passwordError}</div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            type={showPasswords ? "text" : "password"}
                            placeholder="Current"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            required
                            className="w-36 text-[11px]"
                        />
                        <Input
                            type={showPasswords ? "text" : "password"}
                            placeholder="New"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                            className="w-36 text-[11px]"
                        />
                        <Input
                            type={showPasswords ? "text" : "password"}
                            placeholder="Confirm"
                            value={confirmation}
                            onChange={(e) => setConfirmation(e.target.value)}
                            required
                            className="w-36 text-[11px]"
                        />
                        <Button
                            type="submit"
                            size="sm"
                            disabled={isChangingPassword}
                            className="font-semibold"
                        >
                            <KeyRound className="size-3.5" />
                            {isChangingPassword ? "Updating..." : "Update"}
                        </Button>
                        <button
                            type="button"
                            onClick={() => setShowPasswords(!showPasswords)}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                            {showPasswords ? (
                                <EyeOff className="size-3" />
                            ) : (
                                <Eye className="size-3" />
                            )}
                            {showPasswords ? "Hide" : "Show"}
                        </button>
                    </div>
                </form>
            </div>
        </SettingsSection>
    );
}
