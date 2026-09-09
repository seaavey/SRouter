import type { ComponentType } from "react";
import {
    FileText,
    Image as ImageIcon,
    Video,
    Mic,
    Volume2,
    FileSpreadsheet,
    Brain,
    Wrench,
    Code,
    LockOpen,
    Paperclip
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ModalityIconConfig {
    icon: ComponentType<{ className?: string }>;
    label: string;
}

const inputModalityIcons: Record<string, ModalityIconConfig> = {
    text: { icon: FileText, label: "Input: Text" },
    image: { icon: ImageIcon, label: "Input: Image" },
    video: { icon: Video, label: "Input: Video" },
    audio: { icon: Mic, label: "Input: Audio" },
    pdf: { icon: FileSpreadsheet, label: "Input: PDF / Document" }
};

const outputModalityIcons: Record<string, ModalityIconConfig> = {
    text: { icon: FileText, label: "Output: Text" },
    image: { icon: ImageIcon, label: "Output: Image" },
    video: { icon: Video, label: "Output: Video" },
    audio: { icon: Volume2, label: "Output: Audio" }
};

interface ModalityIconsProps {
    input?: string[];
    output?: string[];
}

export function ModalityIcons({ input = ["text"], output = ["text"] }: ModalityIconsProps) {
    return (
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            {/* Input Modalities */}
            <div className="flex items-center gap-1">
                {input.map((mod) => {
                    const cfg = inputModalityIcons[mod] ?? {
                        icon: FileText,
                        label: `Input: ${mod}`
                    };
                    const Icon = cfg.icon;
                    return (
                        <Tooltip key={`in-${mod}`}>
                            <TooltipTrigger
                                render={
                                    <span className="inline-flex size-5 items-center justify-center rounded border border-border/70 bg-secondary/50 text-foreground/80 hover:text-foreground">
                                        <Icon className="size-3" />
                                    </span>
                                }
                            />
                            <TooltipContent side="top">
                                <span>{cfg.label}</span>
                            </TooltipContent>
                        </Tooltip>
                    );
                })}
            </div>

            <span className="text-muted-foreground/60 text-[10px] select-none">→</span>

            {/* Output Modalities */}
            <div className="flex items-center gap-1">
                {output.map((mod) => {
                    const cfg = outputModalityIcons[mod] ?? {
                        icon: FileText,
                        label: `Output: ${mod}`
                    };
                    const Icon = cfg.icon;
                    return (
                        <Tooltip key={`out-${mod}`}>
                            <TooltipTrigger
                                render={
                                    <span className="inline-flex size-5 items-center justify-center rounded border border-border/70 bg-secondary/50 text-foreground/80 hover:text-foreground">
                                        <Icon className="size-3" />
                                    </span>
                                }
                            />
                            <TooltipContent side="top">
                                <span>{cfg.label}</span>
                            </TooltipContent>
                        </Tooltip>
                    );
                })}
            </div>
        </div>
    );
}

interface CapabilityIconsProps {
    reasoning?: boolean;
    toolCall?: boolean;
    structuredOutput?: boolean;
    openWeights?: boolean;
    attachment?: boolean;
}

export function CapabilityIcons({
    reasoning,
    toolCall,
    structuredOutput,
    openWeights,
    attachment
}: CapabilityIconsProps) {
    const caps: Array<{ key: string; icon: ComponentType<{ className?: string }>; label: string }> = [];

    if (reasoning) {
        caps.push({ key: "reasoning", icon: Brain, label: "Reasoning / Thinking" });
    }
    if (toolCall) {
        caps.push({ key: "tools", icon: Wrench, label: "Function / Tool Calling" });
    }
    if (structuredOutput) {
        caps.push({ key: "json", icon: Code, label: "Structured Outputs / JSON Mode" });
    }
    if (openWeights) {
        caps.push({ key: "open", icon: LockOpen, label: "Open Weights" });
    }
    if (attachment) {
        caps.push({ key: "attach", icon: Paperclip, label: "File Attachments" });
    }

    if (caps.length === 0) {
        return <span className="text-muted-foreground/40 text-[11px] font-mono">-</span>;
    }

    return (
        <div className="flex items-center gap-1">
            {caps.map(({ key, icon: Icon, label }) => (
                <Tooltip key={key}>
                    <TooltipTrigger
                        render={
                            <span className="inline-flex size-5 items-center justify-center rounded border border-border/60 bg-secondary/30 text-muted-foreground hover:text-foreground">
                                <Icon className="size-3" />
                            </span>
                        }
                    />
                    <TooltipContent side="top">
                        <span>{label}</span>
                    </TooltipContent>
                </Tooltip>
            ))}
        </div>
    );
}
