import { useEffect, useState } from "react";
import { Check, Cloud, Copy, Download, Loader2, Play, Square } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { TunnelStatus } from "@/hooks/useTunnel";

function ConfirmStopDialog({
    open,
    busy,
    onCancel,
    onConfirm
}: {
    open: boolean;
    busy: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
            <DialogContent className="sm:max-w-md bg-canvas border border-hairline-soft rounded-3xl p-6 md:p-8 shadow-none">
                <DialogHeader className="space-y-1 text-left">
                    <DialogTitle className="font-heading text-lg font-semibold text-ink">
                        Stop Cloudflare Tunnel?
                    </DialogTitle>
                    <DialogDescription className="text-xs text-text-muted leading-relaxed font-sans">
                        Remote clients will immediately lose access to the gateway. The tunnel URL
                        will change the next time you start it.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex items-center justify-end gap-2 pt-4">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={onCancel}
                        disabled={busy}
                        className="rounded-full h-9 text-xs font-semibold cursor-pointer"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={onConfirm}
                        disabled={busy}
                        className="rounded-full h-9 px-4 text-xs font-semibold cursor-pointer gap-1.5"
                    >
                        <Square className="size-3" />
                        {busy ? "Stopping…" : "Yes, stop it"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

type TunnelModalProps = {
    open: boolean;
    onClose: () => void;
    status: TunnelStatus | null;
    onStart: (payload: { token?: string; domain?: string }) => Promise<boolean>;
    onStop: () => Promise<boolean>;
    onInstall: () => Promise<boolean>;
};

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
    const [copied, setCopied] = useState(false);
    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // ignore
        }
    }
    return (
        <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-canvas px-3 text-xs font-medium text-ink transition-colors hover:bg-canvas-soft active:translate-y-px cursor-pointer"
        >
            {copied ? <Check className="size-3 text-ink" /> : <Copy className="size-3" />}
            <span>{copied ? "Copied" : label}</span>
        </button>
    );
}

function StatusBadge({ status }: { status: TunnelStatus | null }) {
    const installing = status?.install?.inProgress ?? false;
    const connecting = Boolean(status?.running && !status.domain);
    const label = status?.running
        ? connecting
            ? "Connecting"
            : "Connected"
        : installing
          ? "Installing"
          : "Offline";

    const tone = connecting
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : status?.running
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : installing
            ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
            : "bg-canvas-soft text-text-muted";

    const dot = connecting
        ? "bg-amber-500 animate-pulse"
        : status?.running
          ? "bg-emerald-500"
          : installing
            ? "bg-sky-500 animate-pulse"
            : "bg-text-faint";

    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] font-semibold ${tone}`}
        >
            <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" />
            {label}
        </span>
    );
}

export function TunnelModal({
    open,
    onClose,
    status,
    onStart,
    onStop,
    onInstall
}: TunnelModalProps) {
    const [tunnelBusy, setTunnelBusy] = useState(false);
    const [installBusy, setInstallBusy] = useState(false);
    const [confirmStopOpen, setConfirmStopOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<"start" | "stop" | null>(null);
    const [token, setToken] = useState("");
    const [domain, setDomain] = useState("");

    const installing = status?.install?.inProgress ?? false;
    const cloudflaredMissing = status !== null && !status.cloudflaredAvailable && !installing;
    const connecting = Boolean(status?.running && !status.domain);
    const locked = tunnelBusy || pendingAction !== null || connecting;

    useEffect(() => {
        if (!pendingAction || !status) return;
        if (pendingAction === "start" && status.running) setPendingAction(null);
        if (pendingAction === "stop" && !status.running) setPendingAction(null);
    }, [status, pendingAction]);

    const handleStart = async () => {
        setTunnelBusy(true);
        setPendingAction("start");
        try {
            const okStart = await onStart({});
            if (!okStart) setPendingAction(null);
        } catch {
            setPendingAction(null);
        } finally {
            setTunnelBusy(false);
        }
    };

    const handleCustomConnect = async () => {
        if (!token.trim()) return;
        setTunnelBusy(true);
        setPendingAction("start");
        try {
            const okStart = await onStart({ token: token.trim(), domain: domain.trim() });
            if (okStart) {
                setToken("");
                setDomain("");
            } else {
                setPendingAction(null);
            }
        } catch {
            setPendingAction(null);
        } finally {
            setTunnelBusy(false);
        }
    };

    const handleStop = async () => {
        setTunnelBusy(true);
        setPendingAction("stop");
        try {
            const okStop = await onStop();
            if (okStop) setConfirmStopOpen(false);
            else setPendingAction(null);
        } catch {
            setPendingAction(null);
        } finally {
            setTunnelBusy(false);
        }
    };

    const handleInstall = async () => {
        setInstallBusy(true);
        await onInstall();
        setInstallBusy(false);
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-md bg-canvas border border-hairline-soft rounded-3xl p-6 md:p-8 shadow-none overflow-y-auto max-h-[calc(100dvh-2rem)]">
                <DialogHeader className="space-y-1 text-left">
                    <DialogTitle className="flex items-center gap-2.5 font-heading text-lg font-semibold text-ink">
                        <div className="flex size-7 items-center justify-center rounded-full bg-canvas-soft text-ink">
                            <Cloud className="size-4" strokeWidth={1.75} />
                        </div>
                        Cloudflare Tunnel.
                    </DialogTitle>
                    <DialogDescription className="text-xs text-text-muted leading-relaxed font-sans">
                        Expose the gateway to remote clients without opening any ports.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center justify-between gap-3 py-2">
                    <StatusBadge status={status} />
                    {status?.running && status.domain ? (
                        <CopyButton text={status.domain} label="Copy URL" />
                    ) : null}
                </div>

                {/* Installing */}
                {installing && (
                    <div className="space-y-2 py-1">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-field">
                            <div
                                className="h-full rounded-full bg-ink transition-[width] duration-300"
                                style={{
                                    width: `${
                                        status?.install?.totalBytes && status.install.totalBytes > 0
                                            ? Math.min(
                                                  100,
                                                  Math.round(
                                                      ((status.install.downloadedBytes ?? 0) /
                                                          status.install.totalBytes) *
                                                          100
                                                  )
                                              )
                                            : 0
                                    }%`
                                }}
                            />
                        </div>
                        <p className="font-mono text-[10px] leading-relaxed text-text-muted">
                            {status?.install?.error
                                ? `Install failed: ${status.install.error}`
                                : status?.install?.platform
                                  ? `Downloading cloudflared for ${status.install.platform}/${status.install.arch}…`
                                  : "Installing cloudflared…"}
                        </p>
                    </div>
                )}

                {status?.install?.error && !installing ? (
                    <p className="font-mono text-[10px] leading-relaxed text-red-600 dark:text-red-400">
                        {status.install.error}
                    </p>
                ) : null}

                {/* Missing binary */}
                {cloudflaredMissing && (
                    <div className="space-y-3 rounded-2xl border border-hairline-soft bg-canvas-soft/50 p-4">
                        <p className="text-xs text-text-muted font-sans leading-relaxed">
                            The{" "}
                            <code className="font-mono text-ink font-semibold">cloudflared</code>{" "}
                            binary isn't installed on the server. Install it automatically to
                            continue.
                        </p>
                        <Button
                            type="button"
                            onClick={() => void handleInstall()}
                            disabled={installBusy}
                            className="rounded-full h-9 px-4 text-xs font-semibold cursor-pointer shadow-none gap-1.5"
                        >
                            <Download className="size-3.5" />
                            {installBusy ? "Installing…" : "Install cloudflared"}
                        </Button>
                    </div>
                )}

                {/* Running */}
                {status?.running ? (
                    <div className="space-y-4 py-1">
                        {status.domain ? (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs font-medium text-text-muted">
                                    <span>Tunnel URL</span>
                                    <CopyButton text={status.domain} label="Copy" />
                                </div>
                                <div className="flex items-center justify-between rounded-2xl border border-hairline-soft bg-field px-4 py-3">
                                    <code className="truncate font-mono text-xs text-ink font-medium select-all">
                                        {status.domain}
                                    </code>
                                </div>
                                <p className="font-sans text-xs leading-relaxed text-text-muted">
                                    Use this URL as the Base URL in your OpenAI/Anthropic clients to
                                    reach this gateway from anywhere.
                                </p>
                            </div>
                        ) : (
                            <p className="font-sans text-xs leading-relaxed text-text-muted">
                                Tunnel is starting: the assigned URL will appear shortly.
                            </p>
                        )}
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={() => setConfirmStopOpen(true)}
                            disabled={locked}
                            title={
                                connecting
                                    ? "Tunnel is still starting: wait for the URL first"
                                    : undefined
                            }
                            className="rounded-full h-10 w-full text-xs font-semibold cursor-pointer gap-2 shadow-none"
                        >
                            {connecting ? (
                                <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                                <Square className="size-3.5" />
                            )}
                            {connecting ? "Starting…" : "Stop Tunnel"}
                        </Button>
                    </div>
                ) : (
                    !cloudflaredMissing &&
                    !installing && (
                        <div className="space-y-4 py-1">
                            <Button
                                type="button"
                                onClick={() => void handleStart()}
                                disabled={locked}
                                className="rounded-full h-10 w-full text-xs font-semibold cursor-pointer shadow-none gap-2"
                            >
                                {pendingAction === "start" ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                    <Play className="size-3.5" />
                                )}
                                {pendingAction === "start" ? "Starting…" : "Start quick tunnel"}
                            </Button>
                            <div className="space-y-3 rounded-2xl border border-hairline-soft bg-canvas-soft/50 p-4">
                                <p className="font-sans text-xs leading-relaxed text-text-muted">
                                    Optional: use a named tunnel with your own hostname. A quick
                                    tunnel needs no token and gives a random *.trycloudflare.com
                                    URL.
                                </p>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-ink font-sans">
                                        Tunnel Token
                                    </label>
                                    <input
                                        type="password"
                                        value={token}
                                        onChange={(e) => setToken(e.target.value)}
                                        placeholder="Cloudflare Tunnel Token (eyJ...)"
                                        className="w-full rounded-2xl border-0 bg-field px-4 py-2.5 font-mono text-xs text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none shadow-none"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-ink font-sans">
                                        Custom Domain
                                    </label>
                                    <input
                                        type="text"
                                        value={domain}
                                        onChange={(e) => setDomain(e.target.value)}
                                        placeholder="router.example.com (optional)"
                                        className="w-full rounded-2xl border-0 bg-field px-4 py-2.5 font-mono text-xs text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none shadow-none"
                                    />
                                </div>
                                <Button
                                    type="button"
                                    onClick={() => void handleCustomConnect()}
                                    disabled={!token.trim() || locked}
                                    className="rounded-full h-9 w-full text-xs font-semibold cursor-pointer shadow-none mt-1"
                                >
                                    {pendingAction === "start" ? (
                                        <>
                                            <Loader2 className="size-3.5 animate-spin" />
                                            Connecting…
                                        </>
                                    ) : (
                                        "Connect with custom domain"
                                    )}
                                </Button>
                            </div>
                        </div>
                    )
                )}

                <div className="flex justify-end pt-2">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={onClose}
                        className="rounded-full h-9 px-4 text-xs font-semibold cursor-pointer"
                    >
                        Close
                    </Button>
                </div>
            </DialogContent>

            <ConfirmStopDialog
                open={confirmStopOpen}
                busy={locked}
                onCancel={() => setConfirmStopOpen(false)}
                onConfirm={() => void handleStop()}
            />
        </Dialog>
    );
}
