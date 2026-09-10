import { z } from "zod";

export interface CompressToolOutputSettings {
    compressGit: boolean;
    compressGrep: boolean;
    compressFileLists: boolean;
    compressLogs: boolean;
    stripAnsiAndWhitespace: boolean;
    minCharacterThreshold: number;
}

export interface LazySeniorDevSettings {
    mode: "balanced" | "strict";
    customInstructions?: string;
}

export interface CompressLlmOutputSettings {
    mode: "terse" | "ultra_terse";
    stripPleasantries: boolean;
    customPrompt?: string;
}

export interface TokenSaverSettings {
    compressToolOutput: CompressToolOutputSettings;
    lazySeniorDev: LazySeniorDevSettings;
    compressLlmOutput: CompressLlmOutputSettings;
}

export const DEFAULT_TOKEN_SAVER_SETTINGS: TokenSaverSettings = {
    compressToolOutput: {
        compressGit: true,
        compressGrep: true,
        compressFileLists: true,
        compressLogs: true,
        stripAnsiAndWhitespace: true,
        minCharacterThreshold: 50
    },
    lazySeniorDev: { mode: "balanced" },
    compressLlmOutput: { mode: "terse", stripPleasantries: true }
};

export const CompressToolOutputSchema = z.object({
    compressGit: z.boolean(),
    compressGrep: z.boolean(),
    compressFileLists: z.boolean(),
    compressLogs: z.boolean(),
    stripAnsiAndWhitespace: z.boolean(),
    minCharacterThreshold: z.number().min(0).default(50)
});

export const LazySeniorDevSchema = z.object({
    mode: z.enum(["balanced", "strict"]),
    customInstructions: z.string().optional()
});

export const CompressLlmOutputSchema = z.object({
    mode: z.enum(["terse", "ultra_terse"]),
    stripPleasantries: z.boolean(),
    customPrompt: z.string().optional()
});

export const TokenSaverSettingsSchema = z.object({
    compressToolOutput: CompressToolOutputSchema,
    lazySeniorDev: LazySeniorDevSchema,
    compressLlmOutput: CompressLlmOutputSchema
});
