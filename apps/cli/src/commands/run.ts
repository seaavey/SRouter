import { spawn } from "node:child_process";
import { getAdapter, getAllAdapters } from "../adapters/index.js";
import { defaultStore } from "../lib/configStore.js";
import { formatError, pc } from "../lib/ui.js";

export interface RunCommandOptions {
    url?: string;
    key?: string;
    model?: string;
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
    const baseUrl = options.url || savedConfig.defaultBaseUrl || "http://localhost:3000/v1";
    const apiKey = options.key || savedConfig.defaultApiKey;
    const model = options.model || savedConfig.defaultModel;

    const envToInject = adapter.getEnv({
        baseUrl,
        apiKey,
        model
    });

    const binaryName = toolId === "claude" ? "claude" : "opencode";

    const child = spawn(binaryName, toolArgs, {
        stdio: "inherit",
        env: {
            ...process.env,
            ...envToInject
        }
    });

    child.on("error", (err: any) => {
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
