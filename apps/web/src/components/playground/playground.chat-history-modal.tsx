import React, { useState, useMemo } from "react";
import { Bot, Check, Copy, MessageSquare, Plus, Search, Trash2, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { PlaygroundSession } from "./playground.types";

interface ChatHistoryModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sessions: PlaygroundSession[];
    activeChatId: string;
    onSwitchSession: (id: string) => void;
    onCreateSession: () => void;
    onDeleteSession: (id: string) => void;
    onCopyChatId: (id: string) => void;
    copiedChatId: boolean;
}

export function ChatHistoryModal({
    open,
    onOpenChange,
    sessions,
    activeChatId,
    onSwitchSession,
    onCreateSession,
    onDeleteSession,
    onCopyChatId,
    copiedChatId
}: ChatHistoryModalProps) {
    const [search, setSearch] = useState("");

    const filteredSessions = useMemo(() => {
        if (!search.trim()) return sessions;
        const q = search.toLowerCase();
        return sessions.filter(
            (s) =>
                s.title.toLowerCase().includes(q) ||
                s.id.toLowerCase().includes(q) ||
                s.model.toLowerCase().includes(q) ||
                s.messages.some((m) => m.content.toLowerCase().includes(q))
        );
    }, [sessions, search]);

    const formatTime = (timestamp: number) => {
        const diff = Date.now() - timestamp;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return "Just now";
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-0 shadow-2xl backdrop-blur-xl">
                {/* Modal Header */}
                <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
                    <div className="flex items-center gap-2">
                        <div className="flex size-7 items-center justify-center rounded-[8px] bg-[var(--field)] text-[var(--ink)]">
                            <MessageSquare className="size-3.5" />
                        </div>
                        <div>
                            <h3 className="font-mono text-[13px] font-bold text-[var(--ink)]">
                                Conversations ({sessions.length})
                            </h3>
                            <p className="text-[11px] text-[var(--ink-3)]">
                                Switch or manage saved chat sessions
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                onCreateSession();
                                onOpenChange(false);
                            }}
                            className="flex h-7 items-center gap-1 rounded-[8px] bg-[var(--ink)] px-2.5 font-mono text-[11px] font-semibold text-[var(--canvas)] shadow-xs transition-opacity hover:opacity-90 cursor-pointer"
                        >
                            <Plus className="size-3" />
                            <span>New</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => onOpenChange(false)}
                            className="rounded-[6px] p-1 text-[var(--ink-3)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                        >
                            <X className="size-4" />
                        </button>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="border-b border-[var(--line)] px-4 py-2.5">
                    <div className="flex items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--canvas)] px-2.5 py-1.5">
                        <Search className="size-3.5 text-[var(--ink-3)]" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search chats by title, model, or content..."
                            className="w-full bg-transparent font-mono text-[12px] text-[var(--ink)] placeholder:text-[var(--ink-3)] outline-none"
                            autoFocus
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => setSearch("")}
                                className="text-[var(--ink-3)] hover:text-[var(--ink)]"
                            >
                                <X className="size-3" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Sessions List */}
                <div className="max-h-80 overflow-y-auto p-3 space-y-1.5">
                    {filteredSessions.length === 0 ? (
                        <div className="py-8 text-center font-mono text-[12px] text-[var(--ink-3)]">
                            No conversations found matching &quot;{search}&quot;
                        </div>
                    ) : (
                        filteredSessions.map((session) => {
                            const isActive = session.id === activeChatId;
                            return (
                                <div
                                    key={session.id}
                                    className={`group flex items-center justify-between rounded-[10px] border p-2.5 transition-all ${
                                        isActive
                                            ? "border-[var(--line-strong)] bg-[var(--field)] shadow-xs"
                                            : "border-[var(--line)]/60 bg-[var(--surface)] hover:border-[var(--line)] hover:bg-[var(--hover)]"
                                    }`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onSwitchSession(session.id);
                                            onOpenChange(false);
                                        }}
                                        className="flex flex-1 flex-col text-left truncate pr-2 cursor-pointer"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="truncate font-mono text-[12px] font-semibold text-[var(--ink)]">
                                                {session.title || "Untitled Conversation"}
                                            </span>
                                            {isActive && (
                                                <span className="shrink-0 rounded bg-[var(--ink)] px-1.5 py-0.2 text-[9px] font-bold uppercase text-[var(--canvas)]">
                                                    Active
                                                </span>
                                            )}
                                        </div>

                                        <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-[var(--ink-3)]">
                                            <span className="flex items-center gap-1">
                                                <Bot className="size-2.5" />
                                                <span className="truncate max-w-[120px]">
                                                    {session.model}
                                                </span>
                                            </span>
                                            <span>·</span>
                                            <span>{session.messages.length} msgs</span>
                                            <span>·</span>
                                            <span>{formatTime(session.updatedAt)}</span>
                                        </div>
                                    </button>

                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onCopyChatId(session.id);
                                            }}
                                            className="flex size-7 items-center justify-center rounded-[6px] text-[var(--ink-3)] hover:bg-[var(--hover-2)] hover:text-[var(--ink)] transition-colors"
                                            title={`Copy chat_id: ${session.id}`}
                                        >
                                            {copiedChatId && isActive ? (
                                                <Check className="size-3 text-emerald-500" />
                                            ) : (
                                                <Copy className="size-3" />
                                            )}
                                        </button>

                                        {sessions.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onDeleteSession(session.id);
                                                }}
                                                className="flex size-7 items-center justify-center rounded-[6px] text-[var(--ink-3)] opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                                                title="Delete session"
                                            >
                                                <Trash2 className="size-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
