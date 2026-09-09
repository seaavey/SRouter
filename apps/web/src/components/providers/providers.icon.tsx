import { useState } from "react";

const ICON_MAPPING: Record<string, string> = {
    bai: "/icons/providers/bai.svg",
    "b.ai": "/icons/providers/bai.svg",
    alibaba: "/icons/providers/alibaba.svg",
    alibabacloud: "/icons/providers/alibaba.svg",
    "arcee-ai": "/icons/providers/arcee.svg",
    bytedance: "/icons/providers/bytedance.svg",
    "bytedance-seed": "/icons/providers/bytedance.svg",
    openai_codex: "/icons/providers/codex.png",
    gpt: "/icons/providers/openai.png",
    chatgpt: "/icons/providers/openai.png",
    anthropic: "/icons/providers/anthropic.svg",
    claude: "/icons/providers/claude.png",
    antigravity: "/icons/providers/antigravity.png",
    neosantara: "/icons/providers/neosantara.png",
    gorouter: "/icons/providers/newapi.png",
    newapi: "/icons/providers/newapi.png",
    bluesminds: "/icons/providers/bluesminds.png",
    commandcode: "/icons/providers/commandcode.png",
    kiro: "/icons/providers/kiro.png",
    seekai: "/icons/providers/newapi.png",
    tabitoken: "/icons/providers/newapi.png",
    tokenrouter: "/icons/providers/tokenrouter.png",
    groq: "/icons/providers/groq.png",
    openrouter: "/icons/providers/openrouter.png",
    copilot: "/icons/providers/copilot.png",
    cursor: "/icons/providers/cursor.png",
    qoder: "/icons/providers/qoder.png",
    kilocode: "/icons/providers/kilocode.png",
    kilo: "/icons/providers/kilocode.png",
    cline: "/icons/providers/cline.png",
    clinepass: "/icons/providers/clinepass.png",
    codebuddy: "/icons/providers/codebuddy.png",
    "codebuddy-cn": "/icons/providers/codebuddy-cn.png",
    "codebuddy-intl": "/icons/providers/codebuddy-intl.png",
    kimi: "/icons/providers/kimi.png",
    grok: "/icons/providers/grok-web.png",
    gemini: "/icons/providers/gemini.png",
    google: "/icons/providers/google.svg",
    ibm: "/icons/providers/ibm.svg",
    meituan: "/icons/providers/meituan.svg",
    meta: "/icons/providers/meta.svg",
    microsoft: "/icons/providers/microsoft.svg",
    minimax: "/icons/providers/minimax.svg",
    huggingface: "/icons/providers/huggingface.png",
    ollama: "/icons/providers/ollama.png",
    deepseek: "/icons/providers/deepseek.svg",
    qwen: "/icons/providers/qwen.svg",
    openai: "/icons/providers/openai.svg",
    mistral: "/icons/providers/mistral.svg",
    cohere: "/icons/providers/cohere.png",
    replicate: "/icons/providers/replicate.png",
    together: "/icons/providers/together.png",
    moonshotai: "/icons/providers/moonshotai.svg",
    nvidia: "/icons/providers/nvidia.svg",
    perplexity: "/icons/providers/perplexity.svg",
    stepfun: "/icons/providers/stepfun.svg",
    tencent: "/icons/providers/tencent.svg",
    upstage: "/icons/providers/upstage.svg",
    xiaomi: "/icons/providers/xiaomi.svg",
    xai: "/icons/providers/xai.svg",
    zhipuai: "/icons/providers/zhipu.svg",
    siliconflow: "/icons/providers/siliconflow.png",
    opencode: "/icons/providers/opencode.png",
    opencode_zen: "/icons/providers/opencode.png",
    "opencode-zen": "/icons/providers/opencode.png",
    zen: "/icons/providers/opencode.png"
};

export function ProviderIcon({
    providerId,
    className = "size-5"
}: {
    providerId: string;
    className?: string;
}) {
    const [hasError, setHasError] = useState(false);
    const id = providerId.toLowerCase().trim();

    if (id === "opencode" || id === "opencode_zen" || id === "opencode-zen" || id === "zen" || id.includes("opencode")) {
        return (
            <svg
                fill="currentColor"
                fillRule="evenodd"
                viewBox="0 0 24 24"
                className={`${className} shrink-0 text-foreground`}
                xmlns="http://www.w3.org/2000/svg"
            >
                <title>OpenCode Zen</title>
                <path d="M16 6H8v12h8V6zm4 16H4V2h16v20z" />
            </svg>
        );
    }

    if (hasError) {
        const initial = providerId.trim().charAt(0).toUpperCase() || "P";
        return (
            <div
                className={`${className} flex items-center justify-center rounded-md bg-secondary text-[10.5px] font-bold text-foreground select-none shrink-0 font-mono group-data-highlighted/item:bg-accent group-data-highlighted/item:text-accent-foreground`}
                title={providerId}
            >
                {initial}
            </div>
        );
    }

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

    if (!src) {
        const initial = providerId.trim().charAt(0).toUpperCase() || "P";
        return (
            <div
                className={`${className} flex items-center justify-center rounded-md bg-secondary text-[10.5px] font-bold text-foreground select-none shrink-0 font-mono group-data-highlighted/item:bg-accent group-data-highlighted/item:text-accent-foreground`}
                title={providerId}
            >
                {initial}
            </div>
        );
    }

    const themeAwareClass = src.endsWith(".svg") ? "dark:invert" : "";

    return (
        <img
            src={src}
            alt={providerId}
            className={`${className} rounded object-contain shrink-0 ${themeAwareClass}`}
            onError={() => {
                setHasError(true);
            }}
        />
    );
}
