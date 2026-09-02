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
            <DialogContent className="sm:max-w-sm bg-card border-border p-6">
                <DialogHeader className="space-y-1 text-left">
                    <DialogTitle className="text-base font-semibold text-foreground">
                        Stop Cloudflare Tunnel?
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
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
                        className="h-8 text-xs font-semibold cursor-pointer"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={onConfirm}
                        disabled={busy}
                        className="h-8 px-3.5 text-xs font-semibold cursor-pointer gap-1.5"
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
    onRefresh: () => Promise<void>;
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
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/70 bg-background/70 px-2.5 text-[11px] font-semibold text-muted-foreground transition-[color,background-color,transform] hover:bg-secondary hover:text-foreground active:translate-y-px"
        >
            {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
            <span className={copied ? "text-emerald-500" : undefined}>
                {copied ? "Copied" : label}
            </span>
        </button>
    );
}

function StatusBadge({ status }: { status: TunnelStatus | null }) {
    const installing = status?.install?.inProgress ?? false;
    // Running but no URL yet → still connecting to Cloudflare's edge.
    const connecting = Boolean(status?.running && !status.domain);
    const label = status?.running
        ? connecting
            ? "Connecting"
            : "Connected"
        : installing
          ? "Installing"
          : "Offline";
    const tone = connecting
        ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
        : status?.running
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
          : installing
            ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
            : "border-border/50 bg-secondary/25 text-muted-foreground";
    const dot = connecting
        ? "bg-amber-400 animate-pulse"
        : status?.running
          ? "bg-emerald-500"
          : installing
            ? "bg-blue-400 animate-pulse"
            : "bg-muted-foreground/50";
    return (
        <span
            className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[8.5px] ${tone}`}
        >
            <span className={`size-1 rounded-full ${dot}`} aria-hidden="true" />
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
    onInstall,
    onRefresh
}: TunnelModalProps) {
    const [tunnelBusy, setTunnelBusy] = useState(false);
    const [installBusy, setInstallBusy] = useState(false);
    const [confirmStopOpen, setConfirmStopOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<"start" | "stop" | null>(null);
    const [token, setToken] = useState("");
    const [domain, setDomain] = useState("");

    const installing = status?.install?.inProgress ?? false;
    const cloudflaredMissing = status !== null && !status.cloudflaredAvailable && !installing;
    // Running but the assigned URL hasn't arrived yet (quick tunnels take ~10s).
    const connecting = Boolean(status?.running && !status.domain);
    // Hard lock: buttons stay disabled until SSE confirms the state change.
    const locked = tunnelBusy || pendingAction !== null || connecting;

    // Clear the action lock once the backend state matches what we asked for.
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
            await onRefresh();
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
            await onRefresh();
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
            await onRefresh();
        } catch {
            setPendingAction(null);
        } finally {
            setTunnelBusy(false);
        }
    };

    const handleInstall = async () => {
        setInstallBusy(true);
        await onInstall();
        await onRefresh();
        setInstallBusy(false);
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-md bg-card border-border p-6">
                <DialogHeader className="space-y-1 text-left">
                    <DialogTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
                        <Cloud className="size-4 text-sky-500" strokeWidth={1.75} />
                        Cloudflare Tunnel
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                        Expose the gateway to remote clients without opening any ports.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center justify-between gap-3 py-1">
                    <StatusBadge status={status} />
                    {status?.running && status.domain ? (
                        <CopyButton text={status.domain} label="Copy URL" />
                    ) : null}
                </div>

                {/* Installing */}
                {installing && (
                    <div className="space-y-1.5 py-1">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary/40">
                            <div
                                className="h-full rounded-full bg-sky-500 transition-[width] duration-300"
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
                        <p className="font-mono text-[9px] leading-relaxed text-muted-foreground/70">
                            {status?.install?.error
                                ? `Install failed: ${status.install.error}`
                                : status?.install?.platform
                                  ? `Downloading cloudflared for ${status.install.platform}/${status.install.arch}…`
                                  : "Installing cloudflared…"}
                        </p>
                    </div>
                )}

                {status?.install?.error && !installing ? (
                    <p className="font-mono text-[9px] leading-relaxed text-red-400/80">
                        {status.install.error}
                    </p>
                ) : null}

                {/* Missing binary */}
                {cloudflaredMissing && (
                    <div className="space-y-2 rounded-lg border border-border/50 bg-secondary/30 p-3">
                        <p className="text-[11px] text-muted-foreground">
                            The <code className="font-mono">cloudflared</code> binary isn't
                            installed on the server. Install it automatically to continue.
                        </p>
                        <Button
                            type="button"
                            onClick={() => void handleInstall()}
                            disabled={installBusy}
                            className="h-8 px-3.5 text-xs font-semibold cursor-pointer shadow-xs gap-1.5"
                        >
                            <Download className="size-3.5" />
                            {installBusy ? "Installing…" : "Install cloudflared"}
                        </Button>
                    </div>
                )}

                {/* Running */}
                {status?.running ? (
                    <div className="space-y-3 py-1">
                        {status.domain ? (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                                    <span>Tunnel URL</span>
                                    <CopyButton text={status.domain} label="Copy" />
                                </div>
                                <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 px-3 py-2">
                                    <code className="truncate font-mono text-[11.5px] text-foreground select-all">
                                        {status.domain}
                                    </code>
                                </div>
                                <p className="font-mono text-[9px] leading-relaxed text-muted-foreground/70">
                                    Use this URL as the Base URL in your OpenAI/Anthropic clients to
                                    reach this gateway from anywhere.
                                </p>
                            </div>
                        ) : (
                            <p className="font-mono text-[9px] leading-relaxed text-muted-foreground/70">
                                Tunnel is starting — the assigned URL will appear shortly.
                            </p>
                        )}
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={() => setConfirmStopOpen(true)}
                            disabled={locked}
                            title={
                                connecting
                                    ? "Tunnel is still starting — wait for the URL first"
                                    : undefined
                            }
                            className="h-8 w-full text-xs font-semibold cursor-pointer gap-1.5"
                        >
                            {connecting ? (
                                <Loader2 className="size-3 animate-spin" />
                            ) : (
                                <Square className="size-3" />
                            )}
                            {connecting ? "Starting…" : "Stop Tunnel"}
                        </Button>
                    </div>
                ) : (
                    !cloudflaredMissing &&
                    !installing && (
                        <div className="space-y-3 py-1">
                            <Button
                                type="button"
                                onClick={() => void handleStart()}
                                disabled={locked}
                                className="h-8 w-full text-xs font-semibold cursor-pointer shadow-xs gap-1.5"
                            >
                                {pendingAction === "start" ? (
                                    <Loader2 className="size-3 animate-spin" />
                                ) : (
                                    <Play className="size-3" />
                                )}
                                {pendingAction === "start" ? "Starting…" : "Start quick tunnel"}
                            </Button>
                            <div className="space-y-2 rounded-lg border border-border/50 bg-secondary/30 p-3">
                                <p className="font-mono text-[9px] leading-relaxed text-muted-foreground/70">
                                    Optional — use a named tunnel with your own hostname. A quick
                                    tunnel needs no token and gives a random *.trycloudflare.com
                                    URL.
                                </p>
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-medium text-foreground">
                                        Tunnel Token
                                    </label>
                                    <input
                                        type="password"
                                        value={token}
                                        onChange={(e) => setToken(e.target.value)}
                                        placeholder="Cloudflare Tunnel Token (eyJ...)"
                                        className="w-full rounded-md border border-border/50 bg-background px-2.5 py-1.5 font-mono text-[10.5px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-medium text-foreground">
                                        Custom Domain
                                    </label>
                                    <input
                                        type="text"
                                        value={domain}
                                        onChange={(e) => setDomain(e.target.value)}
                                        placeholder="router.example.com — optional"
                                        className="w-full rounded-md border border-border/50 bg-background px-2.5 py-1.5 font-mono text-[10.5px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                                    />
                                </div>
                                <Button
                                    type="button"
                                    onClick={() => void handleCustomConnect()}
                                    disabled={!token.trim() || locked}
                                    className="h-8 w-full text-xs font-semibold cursor-pointer shadow-xs"
                                >
                                    {pendingAction === "start" ? (
                                        <>
                                            <Loader2 className="size-3 animate-spin" />
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
                        className="h-8 text-xs font-semibold cursor-pointer"
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
