import type { JSX } from "react";

const ICON_MAPPING: Record<string, string> = {
    openai_codex: "/providers/codex.png",
    openai: "/providers/openai.png",
    chatgpt: "/providers/openai.png",
    anthropic: "/providers/anthropic.png",
    claude: "/providers/claude.png",
    antigravity: "/providers/antigravity.png",
    groq: "/providers/groq.png",
    openrouter: "/providers/openrouter.png",
    copilot: "/providers/copilot.png",
    cursor: "/providers/cursor.png",
    qoder: "/providers/qoder.png",
    kilocode: "/providers/kilocode.png",
    kilo: "/providers/kilocode.png",
    cline: "/providers/cline.png",
    clinepass: "/providers/clinepass.png",
    codebuddy: "/providers/codebuddy-intl.png",
    "codebuddy-cn": "/providers/codebuddy-cn.png",
    kimi: "/providers/kimi.png",
    grok: "/providers/grok-web.png",
    xai: "/providers/xai.png",
    gemini: "/providers/gemini.png",
    huggingface: "/providers/huggingface.png",
    ollama: "/providers/ollama.png",
    deepseek: "/providers/deepseek.png",
    mistral: "/providers/mistral.png",
    cohere: "/providers/cohere.png",
    replicate: "/providers/replicate.png",
    together: "/providers/together.png",
    siliconflow: "/providers/siliconflow.png",
};

export function ProviderIcon({
    providerId,
    className = "size-5",
}: {
    providerId: string;
    className?: string;
}): JSX.Element {
    const id = providerId.toLowerCase().trim();

    // 1. Direct key match
    let src: string | undefined = ICON_MAPPING[id];

    // 2. Partial substring match
    if (!src) {
        for (const key of Object.keys(ICON_MAPPING)) {
            if (id.includes(key)) {
                src = ICON_MAPPING[key];
                break;
            }
        }
    }

    // 3. Fallback to `/providers/${id}.png`
    if (!src) {
        src = `/providers/${id.replace(/[^a-z0-9_-]/g, "")}.png`;
    }

    return (
        <img
            src={src}
            alt={providerId}
            className={`${className} rounded object-contain shrink-0`}
            onError={(e) => {
                // Fallback to github raw URL if local file missing
                const img = e.target as HTMLImageElement;
                if (!img.dataset.fallbackTried) {
                    img.dataset.fallbackTried = "true";
                    img.src = `https://raw.githubusercontent.com/decolua/9router/master/public/providers/${id}.png`;
                }
            }}
        />
    );
}
