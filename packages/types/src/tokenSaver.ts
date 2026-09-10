import { z } from "zod";

export interface CompressToolOutputSettings {
    enabled: boolean;
    compressGit: boolean;
    compressGrep: boolean;
    compressFileLists: boolean;
    compressLogs: boolean;
    stripAnsiAndWhitespace: boolean;
    minCharacterThreshold: number;
}

export interface LazySeniorDevSettings {
    enabled: boolean;
    mode: "balanced" | "strict";
    customInstructions?: string;
}

export interface CompressLlmOutputSettings {
    enabled: boolean;
    mode: "terse" | "ultra_terse";
    stripPleasantries: boolean;
    customPrompt?: string;
}

export interface TokenSaverSettings {
    enabled: boolean;
    compressToolOutput: CompressToolOutputSettings;
    lazySeniorDev: LazySeniorDevSettings;
    compressLlmOutput: CompressLlmOutputSettings;
}

export const CompressToolOutputSchema = z.object({
    enabled: z.boolean(),
    compressGit: z.boolean(),
    compressGrep: z.boolean(),
    compressFileLists: z.boolean(),
    compressLogs: z.boolean(),
    stripAnsiAndWhitespace: z.boolean(),
    minCharacterThreshold: z.number().min(0).default(50)
});

export const LazySeniorDevSchema = z.object({
    enabled: z.boolean(),
    mode: z.enum(["balanced", "strict"]),
    customInstructions: z.string().optional()
});

export const CompressLlmOutputSchema = z.object({
    enabled: z.boolean(),
    mode: z.enum(["terse", "ultra_terse"]),
    stripPleasantries: z.boolean(),
    customPrompt: z.string().optional()
});

export const TokenSaverSettingsSchema = z.object({
    enabled: z.boolean(),
    compressToolOutput: CompressToolOutputSchema,
    lazySeniorDev: LazySeniorDevSchema,
    compressLlmOutput: CompressLlmOutputSchema
});

export const TokenSaverSettingsRequestSchema = z.object({
    enabled: z.boolean().optional(),
    compress_tool_output: z
        .object({
            enabled: z.boolean().optional(),
            compress_git: z.boolean().optional(),
            compress_grep: z.boolean().optional(),
            compress_file_lists: z.boolean().optional(),
            compress_logs: z.boolean().optional(),
            strip_ansi_and_whitespace: z.boolean().optional(),
            min_character_threshold: z.number().min(0).optional()
        })
        .optional(),
    lazy_senior_dev: z
        .object({
            enabled: z.boolean().optional(),
            mode: z.enum(["balanced", "strict"]).optional(),
            custom_instructions: z.string().optional()
        })
        .optional(),
    compress_llm_output: z
        .object({
            enabled: z.boolean().optional(),
            mode: z.enum(["terse", "ultra_terse"]).optional(),
            strip_pleasantries: z.boolean().optional(),
            custom_prompt: z.string().optional()
        })
        .optional()
});

export const TokenSaverPreviewRequestPayloadSchema = z.object({
    type: z.enum(["tool_output", "prompt"]),
    text: z.string().min(1),
    settings: TokenSaverSettingsRequestSchema.optional()
});

export interface TokenSaverPreviewRequest {
    type: "tool_output" | "prompt";
    text: string;
    settings?: Partial<TokenSaverSettings>;
}

export interface TokenSaverSettingsRequest {
    enabled?: boolean;
    compress_tool_output?: Partial<{
        enabled: boolean;
        compress_git: boolean;
        compress_grep: boolean;
        compress_file_lists: boolean;
        compress_logs: boolean;
        strip_ansi_and_whitespace: boolean;
        min_character_threshold: number;
    }>;
    lazy_senior_dev?: Partial<{
        enabled: boolean;
        mode: "balanced" | "strict";
        custom_instructions: string;
    }>;
    compress_llm_output?: Partial<{
        enabled: boolean;
        mode: "terse" | "ultra_terse";
        strip_pleasantries: boolean;
        custom_prompt: string;
    }>;
}

export interface TokenSaverPreviewRequestPayload {
    type: "tool_output" | "prompt";
    text: string;
    settings?: TokenSaverSettingsRequest;
}

export interface TokenSaverPreviewResponse {
    originalText: string;
    transformedText: string;
    originalTokensEstimate: number;
    transformedTokensEstimate: number;
    tokensSavedEstimate: number;
    percentageSaved: number;
}
