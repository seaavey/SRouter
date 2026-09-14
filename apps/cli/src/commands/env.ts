import { getAdapter, getAllAdapters } from "../adapters/index.js";
import { defaultStore } from "../lib/store.js";
import { detectShell, formatShellExport, type ShellType } from "../lib/platform.js";
import { formatError, pc } from "../lib/ui.js";

export interface EnvCommandOptions {
    url?: string;
    key?: string;
    model?: string;
    opus_model?: string;
    sonnet_model?: string;
    haiku_model?: string;
    fish?: boolean;
    shell?: string;
}

export async function envCommand(toolId?: string, options: EnvCommandOptions = {}): Promise<void> {
    const savedConfig = await defaultStore.loadConfig();
    const base_url = options.url || savedConfig.default_base_url || "http://localhost:3000/v1";
    const api_key = options.key || savedConfig.default_api_key;
    const model = options.model || savedConfig.default_model;
    const opus_model = options.opus_model || savedConfig.default_opus_model;
    const sonnet_model = options.sonnet_model || savedConfig.default_sonnet_model;
    const haiku_model = options.haiku_model || savedConfig.default_haiku_model;

    const context = {
        base_url,
        api_key,
        model,
        opus_model,
        sonnet_model,
        haiku_model
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
            ANTHROPIC_BASE_URL: base_url,
            OPENAI_BASE_URL: base_url
        };
        if (api_key) {
            envVars.ANTHROPIC_API_KEY = api_key;
            envVars.OPENAI_API_KEY = api_key;
        }
        if (model) {
            envVars.ANTHROPIC_MODEL = model;
            envVars.OPENCODE_MODEL = model;
        }
        if (opus_model) {
            envVars.ANTHROPIC_DEFAULT_OPUS_MODEL = opus_model;
        }
        if (sonnet_model) {
            envVars.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet_model;
        }
        if (haiku_model) {
            envVars.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku_model;
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
