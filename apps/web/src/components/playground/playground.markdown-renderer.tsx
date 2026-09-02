import React, { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";

interface MarkdownRendererProps {
    content: string;
    isStreaming?: boolean;
}

interface CodeBlockProps {
    language: string;
    code: string;
}

function CodeBlock({ language, code }: CodeBlockProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // fallback ignore
        }
    };

    return (
        <div className="my-3 overflow-hidden rounded-md border border-border/80 bg-secondary/40">
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5 font-semibold text-foreground/80 lowercase">
                    <Terminal className="size-3 text-muted-foreground" />
                    {language || "code"}
                </span>
                <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    title="Copy code"
                >
                    {copied ? (
                        <>
                            <Check className="size-3 text-emerald-500" />
                            <span className="text-emerald-500">Copied</span>
                        </>
                    ) : (
                        <>
                            <Copy className="size-3" />
                            <span>Copy</span>
                        </>
                    )}
                </button>
            </div>
            <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-foreground">
                <code>{code}</code>
            </pre>
        </div>
    );
}

function renderFormattedLine(text: string): React.ReactNode {
    // Process bold, inline code, and links
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let keyIdx = 0;

    while (remaining.length > 0) {
        // Check for inline code `...`
        const codeMatch = remaining.match(/`([^`]+)`/);
        // Check for bold **...**
        const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);

        // Find which match comes first
        const codeIdx = codeMatch ? remaining.indexOf(codeMatch[0]) : -1;
        const boldIdx = boldMatch ? remaining.indexOf(boldMatch[0]) : -1;

        if (codeIdx !== -1 && (boldIdx === -1 || codeIdx < boldIdx)) {
            if (codeIdx > 0) {
                parts.push(<span key={keyIdx++}>{remaining.slice(0, codeIdx)}</span>);
            }
            parts.push(
                <code
                    key={keyIdx++}
                    className="rounded border border-border/60 bg-secondary/50 px-1 py-0.5 font-mono text-[11px] text-foreground"
                >
                    {codeMatch![1]}
                </code>
            );
            remaining = remaining.slice(codeIdx + codeMatch![0].length);
        } else if (boldIdx !== -1) {
            if (boldIdx > 0) {
                parts.push(<span key={keyIdx++}>{remaining.slice(0, boldIdx)}</span>);
            }
            parts.push(
                <strong key={keyIdx++} className="font-semibold text-foreground">
                    {boldMatch![1]}
                </strong>
            );
            remaining = remaining.slice(boldIdx + boldMatch![0].length);
        } else {
            parts.push(<span key={keyIdx++}>{remaining}</span>);
            break;
        }
    }

    return parts;
}

export function MarkdownRenderer({ content, isStreaming }: MarkdownRendererProps) {
    if (!content) return null;

    // Split content by code blocks ```...```
    const segments: Array<{ type: "code" | "text"; language?: string; content: string }> = [];
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)(?:```|$)/g;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(content)) !== null) {
        if (match.index > lastIndex) {
            segments.push({
                type: "text",
                content: content.slice(lastIndex, match.index)
            });
        }
        segments.push({
            type: "code",
            language: match[1] || "text",
            content: match[2].replace(/\n$/, "")
        });
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
        segments.push({
            type: "text",
            content: content.slice(lastIndex)
        });
    }

    return (
        <div className="space-y-2 text-xs leading-[1.75] text-foreground selection:bg-foreground selection:text-background">
            {segments.map((segment, index) => {
                if (segment.type === "code") {
                    return (
                        <CodeBlock
                            key={`code-${index}`}
                            language={segment.language || "text"}
                            code={segment.content}
                        />
                    );
                }

                // Render normal paragraphs, lists, and headers
                const lines = segment.content.split("\n");
                const elements: React.ReactNode[] = [];
                let currentList: React.ReactNode[] = [];

                const flushList = () => {
                    if (currentList.length > 0) {
                        elements.push(
                            <ul
                                key={`list-${elements.length}`}
                                className="my-2 list-disc space-y-1 pl-4"
                            >
                                {currentList}
                            </ul>
                        );
                        currentList = [];
                    }
                };

                lines.forEach((line, lineIndex) => {
                    const trimmed = line.trim();

                    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                        const itemContent = trimmed.slice(2);
                        currentList.push(
                            <li key={`li-${lineIndex}`}>{renderFormattedLine(itemContent)}</li>
                        );
                    } else if (trimmed.startsWith("### ")) {
                        flushList();
                        elements.push(
                            <h4
                                key={`h4-${lineIndex}`}
                                className="mt-3 mb-1 font-mono text-xs font-bold text-foreground"
                            >
                                {renderFormattedLine(trimmed.slice(4))}
                            </h4>
                        );
                    } else if (trimmed.startsWith("## ")) {
                        flushList();
                        elements.push(
                            <h3
                                key={`h3-${lineIndex}`}
                                className="mt-3 mb-1 font-mono text-sm font-bold text-foreground"
                            >
                                {renderFormattedLine(trimmed.slice(3))}
                            </h3>
                        );
                    } else if (trimmed.startsWith("# ")) {
                        flushList();
                        elements.push(
                            <h2
                                key={`h2-${lineIndex}`}
                                className="mt-4 mb-2 font-mono text-base font-bold text-foreground"
                            >
                                {renderFormattedLine(trimmed.slice(2))}
                            </h2>
                        );
                    } else if (trimmed.startsWith("> ")) {
                        flushList();
                        elements.push(
                            <blockquote
                                key={`quote-${lineIndex}`}
                                className="my-2 border-l-2 border-border/80 pl-3 italic text-muted-foreground"
                            >
                                {renderFormattedLine(trimmed.slice(2))}
                            </blockquote>
                        );
                    } else if (trimmed.length > 0) {
                        flushList();
                        elements.push(
                            <p key={`p-${lineIndex}`} className="my-1 whitespace-pre-wrap">
                                {renderFormattedLine(line)}
                            </p>
                        );
                    } else {
                        flushList();
                    }
                });

                flushList();

                return <div key={`text-${index}`}>{elements}</div>;
            })}

            {isStreaming && (
                <span
                    className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-foreground align-middle"
                    aria-label="Generating"
                />
            )}
        </div>
    );
}
