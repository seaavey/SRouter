import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface AdminStatus {
    setupRequired: boolean;
    authenticated: boolean;
}

interface AdminAuthFormProps {
    setupRequired: boolean;
    onAuthenticated: () => void;
}

function AdminAuthForm({ setupRequired, onAuthenticated }: AdminAuthFormProps) {
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);
        setIsSubmitting(true);

        try {
            await api.post<{ authenticated: boolean }>(
                setupRequired ? "/v1/admin/setup" : "/v1/admin/login",
                setupRequired ? { password, confirmation } : { password }
            );
            setPassword("");
            setConfirmation("");
            onAuthenticated();
        } catch (cause) {
            setError(cause instanceof ApiError ? cause.message : "Unable to authenticate");
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        SRouter control plane
                    </p>
                    <CardTitle>
                        {setupRequired ? "Create your admin password" : "Sign in to SRouter"}
                    </CardTitle>
                    <CardDescription>
                        {setupRequired
                            ? "This password protects provider credentials, API keys, and gateway settings."
                            : "Enter the admin password to open the gateway dashboard."}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                        <label className="flex flex-col gap-1.5 text-xs font-medium">
                            Password
                            <Input
                                autoFocus
                                type="password"
                                autoComplete={setupRequired ? "new-password" : "current-password"}
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                placeholder={setupRequired ? "Choose a password" : "Admin password"}
                                required
                            />
                        </label>

                        {setupRequired ? (
                            <>
                                <label className="flex flex-col gap-1.5 text-xs font-medium">
                                    Confirm password
                                    <Input
                                        type="password"
                                        autoComplete="new-password"
                                        value={confirmation}
                                        onChange={(event) => setConfirmation(event.target.value)}
                                        placeholder="Repeat the password"
                                        required
                                    />
                                </label>

                                <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] font-normal text-amber-600 dark:text-amber-400">
                                    First-come-wins: anyone who opens this page before you finish
                                    setup can claim the instance. Set your password right after
                                    deploying.
                                </p>
                            </>
                        ) : null}

                        {error ? (
                            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                                {error}
                            </p>
                        ) : null}

                        <Button type="submit" disabled={isSubmitting} className="mt-1 w-full">
                            {isSubmitting
                                ? "Please wait…"
                                : setupRequired
                                  ? "Create password"
                                  : "Sign in"}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </main>
    );
}

function AuthLoadingScreen() {
    return (
        <main className="flex min-h-svh items-center justify-center bg-background px-4">
            <p className="font-mono text-xs text-muted-foreground">Checking admin session…</p>
        </main>
    );
}

function AuthUnavailableScreen({ onRetry }: { onRetry: () => void }) {
    return (
        <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Gateway unavailable</CardTitle>
                    <CardDescription>
                        SRouter could not verify the admin session. Make sure the API is running and
                        try again.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button type="button" variant="outline" onClick={onRetry} className="w-full">
                        Try again
                    </Button>
                </CardContent>
            </Card>
        </main>
    );
}

export function AdminAuthGate({ children }: { children: ReactNode }) {
    const statusQuery = useQuery({
        queryKey: ["admin-auth-status"],
        queryFn: () => api.get<AdminStatus>("/v1/admin/status"),
        retry: false,
        staleTime: 0
    });

    if (statusQuery.isPending) return <AuthLoadingScreen />;
    if (statusQuery.isError || !statusQuery.data) {
        return <AuthUnavailableScreen onRetry={() => void statusQuery.refetch()} />;
    }
    if (!statusQuery.data.authenticated) {
        return (
            <AdminAuthForm
                setupRequired={statusQuery.data.setupRequired}
                onAuthenticated={() => void statusQuery.refetch()}
            />
        );
    }

    return <>{children}</>;
}
