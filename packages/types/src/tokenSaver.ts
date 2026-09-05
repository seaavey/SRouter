import { z } from "zod";

export const CompressToolOutputSchema = z.object({
    enabled: z.boolean(),
    compressGit: z.boolean(),
    compressGrep: z.boolean(),
    compressFileLists: z.boolean(),
    compressLogs: z.boolean(),
    stripAnsiAndWhitespace: z.boolean(),
    minCharacterThreshold: z.number().min(0).default(50)
});

export type CompressToolOutputSettings = z.infer<typeof CompressToolOutputSchema>;

export const LazySeniorDevSchema = z.object({
    enabled: z.boolean(),
    mode: z.enum(["balanced", "strict"]),
    customInstructions: z.string().optional()
});

export type LazySeniorDevSettings = z.infer<typeof LazySeniorDevSchema>;

export const CompressLlmOutputSchema = z.object({
    enabled: z.boolean(),
    mode: z.enum(["terse", "ultra_terse"]),
    stripPleasantries: z.boolean(),
    customPrompt: z.string().optional()
});

export type CompressLlmOutputSettings = z.infer<typeof CompressLlmOutputSchema>;

export const TokenSaverSettingsSchema = z.object({
    enabled: z.boolean(),
    compressToolOutput: CompressToolOutputSchema,
    lazySeniorDev: LazySeniorDevSchema,
    compressLlmOutput: CompressLlmOutputSchema
});

export type TokenSaverSettings = z.infer<typeof TokenSaverSettingsSchema>;

export interface TokenSaverPreviewRequest {
    type: "tool_output" | "prompt";
    text: string;
    settings?: Partial<TokenSaverSettings>;
}

export interface TokenSaverPreviewResponse {
    originalText: string;
    transformedText: string;
    originalTokensEstimate: number;
    transformedTokensEstimate: number;
    tokensSavedEstimate: number;
    percentageSaved: number;
}
