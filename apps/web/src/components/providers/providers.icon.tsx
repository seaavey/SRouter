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
    atria: "/icons/providers/atria.svg",
    neosantara: "/icons/providers/neosantara.png",
    newapi: "/icons/providers/newapi.png",
    commandcode: "/icons/providers/commandcode.png",
    kiro: "/icons/providers/kiro.png",
    tokenrouter: "/icons/providers/tokenrouter.png",
    groq: "/icons/providers/groq.png",
    openrouter: "/icons/providers/openrouter.png",
    copilot: "/icons/providers/copilot.png",
    cursor: "/icons/providers/cursor.png",
    experientiallabs: "/icons/providers/experientiallabs.svg",
    explabs: "/icons/providers/experientiallabs.svg",
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
    baseUrl,
    fallbackLabel,
    className = "size-5"
}: {
    providerId: string;
    baseUrl?: string;
    fallbackLabel?: string;
    className?: string;
}) {
    const [failedSrc, setFailedSrc] = useState<string>();
    const id = providerId.toLowerCase().trim();

    if (
        id === "opencode" ||
        id === "opencode_zen" ||
        id === "opencode-zen" ||
        id === "zen" ||
        id.includes("opencode")
    ) {
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

    let src: string | undefined = ICON_MAPPING[id];

    if (!src) {
        for (const key of Object.keys(ICON_MAPPING)) {
            if (id.includes(key)) {
                src = ICON_MAPPING[key];
                break;
            }
        }
    }

    if (!src && baseUrl) {
        try {
            const Url = new URL("/favicon.ico", baseUrl);
            if (Url.protocol === "http:" || Url.protocol === "https:") {
                src = Url.toString();
            }
        } catch {
            src = undefined;
        }
    }

    const label = fallbackLabel?.trim() || providerId;

    if (!src || failedSrc === src) {
        const initial = label.charAt(0).toUpperCase() || "P";
        return (
            <div
                className={`${className} flex items-center justify-center rounded-[30%] bg-canvas-soft text-[11px] font-bold text-ink select-none shrink-0 font-mono group-data-highlighted/item:bg-accent group-data-highlighted/item:text-accent-foreground`}
                title={label}
            >
                {initial}
            </div>
        );
    }

    const themeAwareClass = src.endsWith(".svg") ? "dark:invert" : "";

    return (
        <img
            src={src}
            alt={label}
            referrerPolicy="no-referrer"
            className={`${className} rounded-[30%] object-contain shrink-0 ${themeAwareClass}`}
            onError={() => {
                setFailedSrc(src);
            }}
        />
    );
}
