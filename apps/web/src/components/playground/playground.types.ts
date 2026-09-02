export interface PlaygroundMessage {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    createdAt?: number;
    error?: boolean;
    durationMs?: number;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cachedTokens?: number;
    };
    followUps?: string[];
    isGeneratingFollowUps?: boolean;
}

export interface PlaygroundModel {
    id: string;
    owned_by?: string;
    created?: number;
}

export interface PlaygroundSession {
    id: string; // e.g. "chat_8f9a2b1c"
    title: string;
    model: string;
    messages: PlaygroundMessage[];
    createdAt: number;
    updatedAt: number;
}

export interface StarterPrompt {
    id: string;
    category: string;
    title: string;
    prompt: string;
    iconName?: string;
}

export type ExportLanguage = "curl" | "typescript" | "python" | "fetch";
