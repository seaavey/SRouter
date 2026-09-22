export function authProviderIdOf(providerId: string): string {
    return providerId === "codebuddy-cn" ? "codebuddy-cn" : providerId.split("_")[0].split("-")[0];
}

export function splitTokenLines(rawText: string): string[] {
    return rawText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}
