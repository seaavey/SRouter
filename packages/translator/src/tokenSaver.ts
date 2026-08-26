import type {
    ChatMessage,
    ChatCompletionRequest,
    TokenSaverSettings,
    TokenSaverPreviewResponse
} from "@srouter/types";

// ANSI escape sequence regex
const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

/**
 * Strips ANSI color and control characters from terminal/command outputs.
 */
export function stripAnsiCodes(text: string): string {
    return text.replace(ANSI_REGEX, "");
}

/**
 * Collapses multiple consecutive blank lines into at most one blank line,
 * and strips trailing whitespace from every line.
 */
export function cleanWhitespace(text: string): string {
    return text
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/**
 * Compresses raw git diff output by stripping index hashes, mode changes,
 * and redundant diff chunk headers while preserving the actual modifications.
 */
export function compressGitDiff(text: string): string {
    const lines = text.split("\n");
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;

        // Skip index hashes and file mode boilerplate
        if (
            line.startsWith("index ") ||
            line.startsWith("new file mode ") ||
            line.startsWith("deleted file mode ") ||
            line.startsWith("similarity index ") ||
            line.startsWith("old mode ") ||
            line.startsWith("new mode ")
        ) {
            continue;
        }

        // Simplify diff headers
        if (line.startsWith("diff --git a/") && line.includes(" b/")) {
            const parts = line.split(" b/");
            const file = parts[1] || line.replace("diff --git a/", "");
            result.push(`--- ${file}`);
            continue;
        }

        if (line.startsWith("--- a/") || line.startsWith("+++ b/")) {
            continue;
        }

        // Simplify chunk headers: @@ -10,6 +10,7 @@ export function... -> @@ L10 @@
        if (line.startsWith("@@ -")) {
            const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
            if (match) {
                const startLine = match[2];
                const context = (match[3] || "").trim();
                result.push(`@@ L${startLine}${context ? " " + context : ""} @@`);
                continue;
            }
        }

        result.push(line);
    }

    return result.join("\n");
}

/**
 * Compresses git status or git log output into dense summaries.
 */
export function compressGitStatusOrLog(text: string): string {
    // Git log compression: commit abcdef... \n Author: ... \n Date: ... \n\n message
    if (text.includes("commit ") && text.includes("Author:")) {
        const commitBlocks = text.split(/\n(?=commit [0-9a-f]{7,40})/);
        const compressedCommits = commitBlocks.map((block) => {
            const hashMatch = block.match(/commit ([0-9a-f]{7,40})/);
            const msgMatch = block.match(/\n\n\s*([^\n]+)/);
            const authorMatch = block.match(/Author:\s*([^<\n]+)/);
            if (hashMatch) {
                const shortHash = hashMatch[1]!.slice(0, 7);
                const msg = msgMatch ? msgMatch[1]!.trim() : "";
                const author = authorMatch ? ` (${authorMatch[1]!.trim()})` : "";
                return `[${shortHash}] ${msg}${author}`;
            }
            return block;
        });
        return compressedCommits.join("\n");
    }

    // Git status compression: collapse boilerplate guidelines
    if (text.includes("Changes not staged for commit:") || text.includes("Untracked files:")) {
        const lines = text.split("\n");
        const statusLines: string[] = [];
        let branch = "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("On branch ")) {
                branch = trimmed;
            } else if (trimmed.startsWith("modified:") || trimmed.startsWith("both modified:")) {
                statusLines.push(`M ${trimmed.replace(/^(both\s+)?modified:\s*/, "")}`);
            } else if (trimmed.startsWith("deleted:")) {
                statusLines.push(`D ${trimmed.replace(/^deleted:\s*/, "")}`);
            } else if (trimmed.startsWith("new file:")) {
                statusLines.push(`A ${trimmed.replace(/^new file:\s*/, "")}`);
            } else if (trimmed.startsWith("renamed:")) {
                statusLines.push(`R ${trimmed.replace(/^renamed:\s*/, "")}`);
            } else if (
                trimmed.length > 0 &&
                !trimmed.startsWith("(") &&
                !trimmed.startsWith("no changes") &&
                !trimmed.startsWith("Changes") &&
                !trimmed.startsWith("Untracked") &&
                !trimmed.startsWith("Your branch")
            ) {
                statusLines.push(`? ${trimmed}`);
            }
        }

        return [branch, ...statusLines].filter(Boolean).join("\n");
    }

    return text;
}

/**
 * Compresses grep / ripgrep output into compact grouped entries.
 */
export function compressGrepOutput(text: string): string {
    const lines = text.split("\n");
    const fileGroups = new Map<string, string[]>();
    const unparsed: string[] = [];

    for (const line of lines) {
        // Matches: filepath.ts:123: line content or filepath.ts:123- line content
        const match = line.match(/^(\.?\/?[^:\n]+):(\d+)[:-](.*)$/);
        if (match) {
            const file = match[1]!.replace(/^\.\//, "");
            const lineNum = match[2]!;
            const content = match[3]!.trim();
            const group = fileGroups.get(file) || [];
            group.push(`L${lineNum}: ${content}`);
            fileGroups.set(file, group);
        } else if (line.trim()) {
            unparsed.push(line);
        }
    }

    if (fileGroups.size === 0) {
        return text;
    }

    const compressed: string[] = [];
    for (const [file, entries] of fileGroups) {
        compressed.push(`${file}:\n  ` + entries.join("\n  "));
    }

    if (unparsed.length > 0) {
        compressed.push(...unparsed);
    }

    return compressed.join("\n");
}

/**
 * Compresses file directory listings (e.g. `ls -la`, `tree`, `find`).
 */
export function compressFileListings(text: string): string {
    const lines = text.split("\n");
    const result: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("total ")) continue;

        // Matches ls -l: drwxr-xr-x 12 user staff 384 Aug 17 20:00 filename
        const lsMatch = trimmed.match(
            /^([drwxlsStT\-]{10})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+[A-Za-z]{3}\s+\d+\s+[\d:]+\s+(.+)$/
        );
        if (lsMatch) {
            const isDir = lsMatch[1]!.startsWith("d");
            const name = lsMatch[3]!;
            result.push(isDir ? `${name}/` : name);
            continue;
        }

        // Tree output: ├── file.ts -> file.ts
        if (trimmed.includes("── ") || trimmed.includes("─── ")) {
            const name = trimmed.replace(/^[\s│├└─┬|`-]+/, "").trim();
            if (name) result.push(name);
            continue;
        }

        result.push(trimmed);
    }

    return result.join("\n");
}

/**
 * Compresses generic execution logs by collapsing repetitive progress bars and noise.
 */
export function compressGenericLogs(text: string): string {
    const lines = text.split("\n");
    const result: string[] = [];
    let lastLine = "";
    let duplicateCount = 0;

    for (const line of lines) {
        // Strip timestamps like [2026-08-17T20:00:00.000Z] or 2026-08-17 20:00:00
        const strippedTimestamp = line
            .replace(/^\[?\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\]?\s*/, "")
            .replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "");

        if (strippedTimestamp === lastLine && strippedTimestamp.length > 0) {
            duplicateCount++;
            continue;
        }

        if (duplicateCount > 0) {
            result.push(
                `  ↳ [repeated ${duplicateCount} more time${duplicateCount > 1 ? "s" : ""}]`
            );
            duplicateCount = 0;
        }

        result.push(strippedTimestamp);
        lastLine = strippedTimestamp;
    }

    if (duplicateCount > 0) {
        result.push(`  ↳ [repeated ${duplicateCount} more time${duplicateCount > 1 ? "s" : ""}]`);
    }

    return result.join("\n");
}

/**
 * Detects tool output type and applies corresponding compression algorithms.
 */
export function compressSingleToolOutput(
    text: string,
    settings: TokenSaverSettings["compressToolOutput"]
): string {
    if (!settings.enabled || text.length < settings.minCharacterThreshold) {
        return text;
    }

    let processed = text;

    if (settings.stripAnsiAndWhitespace) {
        processed = stripAnsiCodes(processed);
    }

    // Git Diff detection
    if (
        settings.compressGit &&
        (processed.includes("diff --git") ||
            (processed.includes("--- ") && processed.includes("+++ ")))
    ) {
        processed = compressGitDiff(processed);
    }
    // Git Log or Git Status
    else if (
        settings.compressGit &&
        (processed.includes("commit ") ||
            processed.includes("Changes not staged for commit:") ||
            processed.includes("On branch "))
    ) {
        processed = compressGitStatusOrLog(processed);
    }
    // Grep / search result detection
    else if (
        settings.compressGrep &&
        /^[^\n:]+:\d+[:-]/m.test(processed) &&
        processed.split("\n").filter((l) => /^[^\n:]+:\d+[:-]/.test(l)).length >= 2
    ) {
        processed = compressGrepOutput(processed);
    }
    // File list detection
    else if (
        settings.compressFileLists &&
        (processed.includes("drwx") ||
            processed.includes("-rw-") ||
            processed.includes("├── ") ||
            processed.includes("└── "))
    ) {
        processed = compressFileListings(processed);
    }
    // General Logs
    else if (settings.compressLogs) {
        processed = compressGenericLogs(processed);
    }

    if (settings.stripAnsiAndWhitespace) {
        processed = cleanWhitespace(processed);
    }

    return processed;
}

/**
 * Builds system prompt enhancements for Lazy Senior Dev and Caveman (Terse Output).
 */
export function buildSystemPromptEnhancements(settings: TokenSaverSettings): string {
    if (!settings.enabled) return "";

    const parts: string[] = [];

    // 1. Lazy Senior Dev (ponytail)
    if (settings.lazySeniorDev.enabled) {
        if (settings.lazySeniorDev.mode === "strict") {
            parts.push(
                `[SYSTEM INSTRUCTION: STRICT MINIMALIST SENIOR DEV]\n` +
                    `- Strictly adhere to YAGNI (You Aren't Gonna Need It): Reject all premature abstractions, helper functions, and unnecessary layers.\n` +
                    `- Reuse stdlib & existing utilities: Use only built-in language standard libraries and code already present in the workspace. Never add new dependencies.\n` +
                    `- Surgical edits: Make minimal in-place edits. Delete dead code over adding wrappers. Never rewrite untouched functions or files.\n` +
                    (settings.lazySeniorDev.customInstructions
                        ? `- ${settings.lazySeniorDev.customInstructions}\n`
                        : "")
            );
        } else {
            parts.push(
                `[SYSTEM INSTRUCTION: LAZY SENIOR DEV]\n` +
                    `- YAGNI principle: Keep code minimal, direct, and free of speculative extensibility.\n` +
                    `- Reuse existing stdlib and project utilities rather than importing new packages.\n` +
                    `- Favor deletion/simplification over addition. Output only targeted, necessary code changes.\n` +
                    (settings.lazySeniorDev.customInstructions
                        ? `- ${settings.lazySeniorDev.customInstructions}\n`
                        : "")
            );
        }
    }

    // 2. Compress LLM Output (caveman)
    if (settings.compressLlmOutput.enabled) {
        if (settings.compressLlmOutput.mode === "ultra_terse") {
            parts.push(
                `[SYSTEM INSTRUCTION: ULTRA TERSE / CAVEMAN OUTPUT]\n` +
                    `- Zero conversational pleasantries, preambles, summaries, or pleasant sign-offs.\n` +
                    `- Telegraphic style: direct, concise, high information density.\n` +
                    `- Provide code and direct answers immediately with minimal prose (~80% fewer output tokens).\n` +
                    (settings.compressLlmOutput.customPrompt
                        ? `- ${settings.compressLlmOutput.customPrompt}\n`
                        : "")
            );
        } else {
            parts.push(
                `[SYSTEM INSTRUCTION: TERSE OUTPUT MODE]\n` +
                    `- Eliminate conversational fluff, redundant greetings, and conclusion summaries.\n` +
                    `- Go directly to the solution, explanation, and code changes with maximum clarity and density.\n` +
                    (settings.compressLlmOutput.customPrompt
                        ? `- ${settings.compressLlmOutput.customPrompt}\n`
                        : "")
            );
        }
    }

    return parts.join("\n\n");
}

/**
 * Simple, fast token estimation: ~4 chars per token for typical English/code text.
 */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / 4));
}

export interface AppliedTokenSaverResult {
    request: ChatCompletionRequest;
    originalInputTokens: number;
    optimizedInputTokens: number;
    tokensSaved: number;
    percentageSaved: number;
}

/**
 * Applies all enabled Token Saver optimizations to an incoming ChatCompletionRequest.
 */
export function applyTokenSaver(
    request: ChatCompletionRequest,
    settings: TokenSaverSettings
): AppliedTokenSaverResult {
    if (!settings.enabled) {
        const tokens = request.messages.reduce((acc, m) => {
            const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            return acc + estimateTokens(content);
        }, 0);
        return {
            request,
            originalInputTokens: tokens,
            optimizedInputTokens: tokens,
            tokensSaved: 0,
            percentageSaved: 0
        };
    }

    let originalTotalLength = 0;
    let optimizedTotalLength = 0;

    // 1. Compress Tool & Terminal Output inside messages
    const optimizedMessages: ChatMessage[] = request.messages.map((msg) => {
        const rawContent = typeof msg.content === "string" ? msg.content : "";
        originalTotalLength += rawContent.length;

        if (
            settings.compressToolOutput.enabled &&
            rawContent.length >= settings.compressToolOutput.minCharacterThreshold &&
            (msg.role === "tool" ||
                msg.role === "user" ||
                (msg.role === "assistant" && rawContent.includes("```")))
        ) {
            const compressed = compressSingleToolOutput(rawContent, settings.compressToolOutput);
            optimizedTotalLength += compressed.length;
            return {
                ...msg,
                content: compressed
            };
        }

        optimizedTotalLength += rawContent.length;
        return msg;
    });

    // 2. Inject Prompt Enhancements (Lazy Senior Dev & Caveman)
    const promptEnhancement = buildSystemPromptEnhancements(settings);
    if (promptEnhancement) {
        const systemMsgIndex = optimizedMessages.findIndex((m) => m.role === "system");
        if (systemMsgIndex >= 0) {
            const existing = optimizedMessages[systemMsgIndex]!;
            const existingContent = typeof existing.content === "string" ? existing.content : "";
            optimizedMessages[systemMsgIndex] = {
                ...existing,
                content: `${existingContent}\n\n${promptEnhancement}`.trim()
            };
        } else {
            optimizedMessages.unshift({
                role: "system",
                content: promptEnhancement
            });
        }
    }

    const originalInputTokens = Math.max(1, Math.ceil(originalTotalLength / 4));
    const optimizedInputTokens = Math.max(1, Math.ceil(optimizedTotalLength / 4));
    const tokensSaved = Math.max(0, originalInputTokens - optimizedInputTokens);
    const percentageSaved =
        originalInputTokens > 0
            ? Math.min(99, Math.round((tokensSaved / originalInputTokens) * 100))
            : 0;

    return {
        request: {
            ...request,
            messages: optimizedMessages
        },
        originalInputTokens,
        optimizedInputTokens,
        tokensSaved,
        percentageSaved
    };
}

/**
 * Preview / Simulator utility for UI and test endpoints.
 */
export function PreviewTokenSaver(
    type: "tool_output" | "prompt",
    text: string,
    settings: TokenSaverSettings
): TokenSaverPreviewResponse {
    const originalTokensEstimate = estimateTokens(text);
    let transformedText = text;

    if (type === "tool_output") {
        transformedText = compressSingleToolOutput(text, settings.compressToolOutput);
    } else {
        const enhancements = buildSystemPromptEnhancements(settings);
        transformedText = enhancements ? `${text}\n\n${enhancements}`.trim() : text;
    }

    const transformedTokensEstimate = estimateTokens(transformedText);
    const tokensSavedEstimate = Math.max(0, originalTokensEstimate - transformedTokensEstimate);
    const percentageSaved =
        originalTokensEstimate > 0
            ? Math.round((tokensSavedEstimate / originalTokensEstimate) * 100)
            : 0;

    return {
        originalText: text,
        transformedText,
        originalTokensEstimate,
        transformedTokensEstimate,
        tokensSavedEstimate,
        percentageSaved
    };
}
