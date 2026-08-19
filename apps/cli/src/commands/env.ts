import { getAdapter, getAllAdapters } from "../adapters/index.js";
import { defaultStore } from "../lib/configStore.js";
import { detectShell, formatShellExport, type ShellType } from "../lib/platform.js";
import { formatError, pc } from "../lib/ui.js";

export interface EnvCommandOptions {
    url?: string;
    key?: string;
    model?: string;
    opusModel?: string;
    sonnetModel?: string;
    haikuModel?: string;
    fish?: boolean;
    shell?: string;
}

export async function envCommand(toolId?: string, options: EnvCommandOptions = {}): Promise<void> {
    const savedConfig = await defaultStore.loadConfig();
    const baseUrl = options.url || savedConfig.defaultBaseUrl || "http://localhost:3000/v1";
    const apiKey = options.key || savedConfig.defaultApiKey;
    const model = options.model || savedConfig.defaultModel;
    const opusModel = options.opusModel || savedConfig.defaultOpusModel;
    const sonnetModel = options.sonnetModel || savedConfig.defaultSonnetModel;
    const haikuModel = options.haikuModel || savedConfig.defaultHaikuModel;

    const context = {
        baseUrl,
        apiKey,
        model,
        opusModel,
        sonnetModel,
        haikuModel
    };

    let envVars: Record<string, string> = {};

    if (toolId) {
        const adapter = getAdapter(toolId);
        if (!adapter) {
            console.error(
                formatError(
                    `Tool '${pc.bold(toolId)}' not supported. Available: ${getAllAdapters()
                        .map((a) => a.id)
                        .join(", ")}`
                )
            );
            process.exitCode = 1;
            return;
        }
        envVars = adapter.getEnv(context);
    } else {
        envVars = {
            ANTHROPIC_BASE_URL: baseUrl,
            OPENAI_BASE_URL: baseUrl
        };
        if (apiKey) {
            envVars.ANTHROPIC_API_KEY = apiKey;
            envVars.OPENAI_API_KEY = apiKey;
        }
        if (model) {
            envVars.ANTHROPIC_MODEL = model;
            envVars.OPENCODE_MODEL = model;
        }
        if (opusModel) {
            envVars.ANTHROPIC_DEFAULT_OPUS_MODEL = opusModel;
        }
        if (sonnetModel) {
            envVars.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnetModel;
        }
        if (haikuModel) {
            envVars.ANTHROPIC_DEFAULT_HAIKU_MODEL = haikuModel;
        }
    }

    let targetShell: ShellType = detectShell();
    if (options.fish) {
        targetShell = "fish";
    } else if (options.shell) {
        const s = options.shell.toLowerCase();
        if (
            s === "fish" ||
            s === "powershell" ||
            s === "pwsh" ||
            s === "cmd" ||
            s === "zsh" ||
            s === "bash"
        ) {
            targetShell = (s === "pwsh" ? "powershell" : s) as ShellType;
        }
    }

    for (const [key, value] of Object.entries(envVars)) {
        console.log(formatShellExport(key, value, targetShell));
    }
}
