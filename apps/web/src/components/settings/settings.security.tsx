import { useState, type FormEvent } from "react";
import { ShieldCheck, KeyRound, Eye, EyeOff, Lock, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsSection, SettingsRow, SegmentedControl } from "./settings.ui";

interface SecuritySettingsProps {
    requireApiKey: boolean;
    onToggleRequireApiKey: (value: boolean) => void;
    isUpdating: boolean;
    apiBase?: string;
}

export function SecuritySettings({
    requireApiKey,
    onToggleRequireApiKey,
    isUpdating
}: SecuritySettingsProps) {
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [showPasswords, setShowPasswords] = useState(false);

    const handleChangePassword = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setPasswordError(null);
        if (!currentPassword) {
            setPasswordError("Please enter your current admin password.");
            return;
        }
        if (newPassword.length < 6) {
            setPasswordError("New password must be at least 6 characters.");
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
            id="security"
            icon={ShieldCheck}
            tag="Core"
            title="Security & Access Control"
            description="Virtual API key bearer verification and admin dashboard authentication."
        >
            <SettingsRow
                title="Enforce Bearer Authentication"
                description={
                    requireApiKey
                        ? "Unauthenticated requests are rejected with HTTP 401."
                        : "Open access mode — requests pass through without API key verification."
                }
                control={
                    <div className="flex items-center gap-3">
                        <span
                            className={[
                                "hidden sm:inline-flex items-center gap-1.5 text-xs font-mono font-medium",
                                requireApiKey
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-text-muted"
                            ].join(" ")}
                        >
                            <span
                                className={[
                                    "size-1.5 rounded-full",
                                    requireApiKey ? "bg-emerald-500" : "bg-muted-foreground/40"
                                ].join(" ")}
                            />
                            {requireApiKey ? "Enforced" : "Permissive"}
                        </span>
                        <SegmentedControl
                            options={[
                                { value: false, label: "OFF" },
                                { value: true, label: "ON" }
                            ]}
                            value={requireApiKey}
                            onChange={onToggleRequireApiKey}
                            disabled={isUpdating}
                        />
                    </div>
                }
            />

            <div className="py-4 font-sans">
                <form
                    onSubmit={handleChangePassword}
                    className="rounded-2xl border border-hairline-soft bg-canvas-soft/30 p-5 space-y-4"
                >
                    <div className="flex items-center justify-between border-b border-hairline-soft pb-3.5">
                        <div className="flex items-center gap-2.5">
                            <Lock className="size-4 text-text-muted" />
                            <div>
                                <h3 className="text-xs font-semibold text-ink leading-none font-sans">
                                    Change Admin Password
                                </h3>
                                <p className="text-xs text-text-muted font-light mt-1 font-sans">
                                    Used to unlock dashboard management actions and sensitive
                                    config.
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowPasswords(!showPasswords)}
                            className="inline-flex items-center gap-1.5 text-xs font-mono text-text-muted hover:text-ink transition-colors cursor-pointer select-none px-3 py-1 rounded-full hover:bg-canvas"
                        >
                            {showPasswords ? (
                                <EyeOff className="size-3.5" />
                            ) : (
                                <Eye className="size-3.5" />
                            )}
                            <span>{showPasswords ? "Hide" : "Show"}</span>
                        </button>
                    </div>

                    {passwordError && (
                        <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-destructive font-sans">
                            <AlertCircle className="size-4 shrink-0" />
                            <span>{passwordError}</span>
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-sans">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-text-muted">
                                Current Password
                            </label>
                            <Input
                                type={showPasswords ? "text" : "password"}
                                placeholder="••••••••"
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                required
                                className="h-10 rounded-2xl border-hairline-soft bg-field text-xs font-mono text-ink"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-text-muted">
                                New Password
                            </label>
                            <Input
                                type={showPasswords ? "text" : "password"}
                                placeholder="••••••••"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                                className="h-10 rounded-2xl border-hairline-soft bg-field text-xs font-mono text-ink"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-text-muted">
                                Confirm Password
                            </label>
                            <Input
                                type={showPasswords ? "text" : "password"}
                                placeholder="••••••••"
                                value={confirmation}
                                onChange={(e) => setConfirmation(e.target.value)}
                                required
                                className="h-10 rounded-2xl border-hairline-soft bg-field text-xs font-mono text-ink"
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-hairline-soft">
                        <span className="text-[11px] text-text-muted font-mono">
                            Minimum 6 characters
                        </span>
                        <Button
                            type="submit"
                            size="sm"
                            disabled={
                                isChangingPassword ||
                                !currentPassword ||
                                !newPassword ||
                                !confirmation
                            }
                            className="font-semibold text-xs h-9 px-5 rounded-full cursor-pointer bg-ink text-canvas hover:opacity-90 shadow-none"
                        >
                            <KeyRound className="size-3.5" />
                            <span>{isChangingPassword ? "Saving..." : "Update Password"}</span>
                        </Button>
                    </div>
                </form>
            </div>
        </SettingsSection>
    );
}
