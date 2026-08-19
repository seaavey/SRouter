import { getAdapter, getAllAdapters } from "../adapters/index.ts";
import { defaultStore } from "../lib/configStore.ts";
import { formatError, pc } from "../lib/ui.ts";

export interface EnvCommandOptions {
    url?: string;
    key?: string;
    model?: string;
    fish?: boolean;
}

export async function envCommand(toolId?: string, options: EnvCommandOptions = {}): Promise<void> {
    const savedConfig = await defaultStore.loadConfig();
    const baseUrl = options.url || savedConfig.defaultBaseUrl || "http://localhost:3000/v1";
    const apiKey = options.key || savedConfig.defaultApiKey;
    const model = options.model || savedConfig.defaultModel;

    const context = {
        baseUrl,
        apiKey,
        model
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
        // Collect combined env vars across all adapters
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
    }

    const isFish = Boolean(options.fish || process.env.SHELL?.includes("fish"));

    for (const [key, value] of Object.entries(envVars)) {
        if (isFish) {
            console.log(`set -gx ${key} "${value}";`);
        } else {
            console.log(`export ${key}="${value}"`);
        }
    }
}
