export interface PlaygroundMessage {
    role: "user" | "assistant";
    content: string;
}

export interface PlaygroundModel {
    id: string;
    owned_by?: string;
}
