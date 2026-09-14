import { spawn } from "node:child_process";
import { getAdapter, getAllAdapters } from "../adapters/index.js";
import { defaultStore } from "../lib/store.js";
import { formatError, pc } from "../lib/ui.js";

export interface RunCommandOptions {
    url?: string;
    key?: string;
    model?: string;
    opus_model?: string;
    sonnet_model?: string;
    haiku_model?: string;
}

export async function runCommand(
    toolId: string,
    toolArgs: string[],
    options: RunCommandOptions = {}
): Promise<void> {
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

    const savedConfig = await defaultStore.loadConfig();
    const base_url = options.url || savedConfig.default_base_url || "http://localhost:3000/v1";
    const api_key = options.key || savedConfig.default_api_key;
    const model = options.model || savedConfig.default_model;
    const opus_model = options.opus_model || savedConfig.default_opus_model;
    const sonnet_model = options.sonnet_model || savedConfig.default_sonnet_model;
    const haiku_model = options.haiku_model || savedConfig.default_haiku_model;

    const envToInject = adapter.getEnv({
        base_url,
        api_key,
        model,
        opus_model,
        sonnet_model,
        haiku_model
    });

    const binaryName = toolId === "claude" ? "claude" : "opencode";

    const child = spawn(binaryName, toolArgs, {
        stdio: "inherit",
        env: {
            ...process.env,
            ...envToInject
        }
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") {
            console.error(
                formatError(
                    `Executable '${pc.bold(binaryName)}' not found in your PATH. Please install ${adapter.name} first.`
                )
            );
        } else {
            console.error(formatError(`Failed to run ${binaryName}: ${err.message}`));
        }
        process.exitCode = 1;
    });

    child.on("exit", (code) => {
        if (code !== null && code !== 0) {
            process.exitCode = code;
        }
    });
}
