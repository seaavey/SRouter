import React, { useState } from "react";
import { Bot } from "lucide-react";

interface AgentBadgeIconProps {
    agentName: string;
    className?: string;
}

const AGENT_IMAGE_MAP: Record<string, string> = {
    cursor: "/icons/providers/cursor.png",
    cline: "/icons/providers/cline.png",
    continue: "/icons/providers/continue.png",
    claude: "/icons/providers/claude.png",
    codex: "/icons/providers/codex.png",
    antigravity: "/icons/providers/antigravity.png",
    agy: "/icons/providers/antigravity.png",
    opencode: "/icons/providers/opencode.png"
};

/**
 * Returns accurate brand logos for known coding agents, falling back to clean SVGs / Bot icon.
 */
export function AgentBadgeIcon({ agentName, className = "size-5" }: AgentBadgeIconProps) {
    const [imgFailed, setImgFailed] = useState(false);
    const lower = agentName.toLowerCase();

    // Check mapped image assets first
    const matchedKey = Object.keys(AGENT_IMAGE_MAP).find((key) => lower.includes(key));
    if (matchedKey && !imgFailed) {
        return (
            <img
                src={AGENT_IMAGE_MAP[matchedKey]}
                alt={agentName}
                className={`${className} object-contain rounded shrink-0`}
                onError={() => setImgFailed(true)}
                loading="lazy"
            />
        );
    }

    // Hermes Agent
    if (lower.includes("hermes")) {
        return (
            <svg viewBox="0 0 24 24" fill="none" className={className}>
                <path
                    d="M4 16l4-8 4 8 4-8 4 8"
                    className="stroke-foreground"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <circle cx="12" cy="6" r="2" className="fill-foreground" />
            </svg>
        );
    }

    // Aider
    if (lower.includes("aider")) {
        return (
            <svg viewBox="0 0 24 24" fill="none" className={className}>
                <rect width="24" height="24" rx="5" className="fill-foreground/10" />
                <path
                    d="M8 12h8M12 8v8"
                    className="stroke-foreground"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                />
            </svg>
        );
    }

    // Default fallback
    return (
        <div
            className={`flex items-center justify-center rounded-xl bg-field text-ink border border-hairline-soft ${className}`}
        >
            <Bot className="size-3.5" />
        </div>
    );
}
