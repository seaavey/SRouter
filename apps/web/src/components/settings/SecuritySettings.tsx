import { useState, type FormEvent } from "react";
import {
    Check,
    Copy,
    KeyRound,
    Lock,
    Shield,
    ShieldAlert,
    ShieldCheck,
    Terminal,
    Unlock,
    KeySquare,
    Loader2
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

    const getSnippet = (tab: CodeTab) => {
        if (tab === "curl") {
            return `curl ${apiBase}/chat/completions \\
  -H "Content-Type: application/json" \\
${
    requireApiKey
        ? '  -H "Authorization: Bearer sr-live-your_virtual_key" \\\n'
        : '  # -H "Authorization: Bearer <optional_key>" \\\n'
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
        <div className="space-y-6">
            {/* Section 1: API Key & Gateway Access Enforcement */}
            <div className="rounded-xl border border-border/80 bg-card p-5 space-y-5 shadow-2xs">
                <div>
                    <div className="flex items-center gap-2">
                        <KeyRound className="size-4 text-amber-500" />
                        <h2 className="text-sm font-bold text-foreground tracking-tight">
                            API Key Authentication Enforcement
                        </h2>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                        Control whether external clients must provide a Bearer API Key to access
                        gateway routing endpoints.
                    </p>
                </div>

                <div className="rounded-lg border border-border/70 bg-muted/20 p-4 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-4">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-bold text-foreground">
                                    Enforce Bearer Authentication
                                </span>
                                {requireApiKey ? (
                                    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                        <ShieldCheck className="size-3" />
                                        <span>Protected (Enforced)</span>
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                        <Unlock className="size-3" />
                                        <span>Open Access (Optional)</span>
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed max-w-xl">
                                {requireApiKey
                                    ? "Gateway endpoints will reject unauthenticated requests with HTTP 401 Unauthorized unless a valid virtual SRouter key is supplied in the Authorization header."
                                    : "Open access mode: Anyone can query SRouter models without an API key. Ideal for localhost development, IDE extensions, or private network deployments."}
                            </p>
                        </div>

                        {/* Action Switch Buttons */}
                        <div className="inline-flex items-center rounded-lg border border-border/80 bg-background/90 p-1 shadow-2xs self-start sm:self-auto shrink-0 font-mono gap-1">
                            <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() => onToggleRequireApiKey(false)}
                                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                                    !requireApiKey
                                        ? "bg-foreground text-background shadow-xs font-bold"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                <Unlock className="size-3" />
                                <span>Disabled</span>
                            </button>
                            <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() => onToggleRequireApiKey(true)}
                                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                                    requireApiKey
                                        ? "bg-foreground text-background shadow-xs font-bold"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                <Lock className="size-3" />
                                <span>Required</span>
                            </button>
                        </div>
                    </div>

                    {/* Client Request Code Preview */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                Client Request Integration Example:
                            </span>
                            <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/80 bg-background/90 p-0.5 font-mono">
                                {(["curl", "typescript", "python"] as const).map((tab) => (
                                    <button
                                        key={tab}
                                        type="button"
                                        onClick={() => setCodeTab(tab)}
                                        className={`px-2.5 py-1 text-[10.5px] font-semibold rounded-md capitalize transition-colors cursor-pointer ${
                                            codeTab === tab
                                                ? "bg-foreground text-background shadow-xs font-bold"
                                                : "text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {tab}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="relative rounded-lg border border-border/80 bg-background p-3 font-mono text-[11px] text-foreground overflow-x-auto">
                            <button
                                type="button"
                                onClick={handleCopy}
                                className="absolute top-2.5 right-2.5 flex items-center gap-1 rounded bg-muted/80 hover:bg-muted px-2 py-1 text-[10px] font-semibold text-foreground transition-colors cursor-pointer"
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
            </div>

            {/* Section 2: Admin Password & Control Plane Security */}
            <div className="rounded-xl border border-border/80 bg-card p-5 space-y-4 shadow-2xs">
                <div>
                    <div className="flex items-center gap-2">
                        <Shield className="size-4 text-emerald-500" />
                        <h2 className="text-sm font-bold text-foreground tracking-tight">
                            Admin Control Plane Password
                        </h2>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                        Update the master administrator password used to lock settings, provider
                        credentials, and token configurations.
                    </p>
                </div>

                <form onSubmit={handleChangePassword} className="space-y-3.5 max-w-lg">
                    {passwordError && (
                        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                            <ShieldAlert className="size-4 shrink-0 mt-0.5" />
                            <span>{passwordError}</span>
                        </div>
                    )}

                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-foreground">
                            Current Password
                        </label>
                        <Input
                            type="password"
                            placeholder="Enter current admin password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            required
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-foreground">
                                New Password
                            </label>
                            <Input
                                type="password"
                                placeholder="New password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-foreground">
                                Confirm New Password
                            </label>
                            <Input
                                type="password"
                                placeholder="Repeat new password"
                                value={confirmation}
                                onChange={(e) => setConfirmation(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <Button
                        type="submit"
                        disabled={isChangingPassword}
                        size="sm"
                        className="mt-2 font-semibold"
                    >
                        {isChangingPassword ? (
                            <>
                                <Loader2 className="size-3.5 animate-spin" />
                                <span>Updating Password...</span>
                            </>
                        ) : (
                            <>
                                <KeySquare className="size-3.5" />
                                <span>Update Admin Password</span>
                            </>
                        )}
                    </Button>
                </form>
            </div>
        </div>
    );
}
