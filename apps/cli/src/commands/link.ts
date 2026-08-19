import { getAdapter, getAllAdapters } from "../adapters/index.js";
import { defaultStore } from "../lib/configStore.js";
import { formatError, formatSuccess, pc } from "../lib/ui.js";

export interface LinkCommandOptions {
    url?: string;
    key?: string;
    model?: string;
    dryRun?: boolean;
}

export async function linkCommand(toolId: string, options: LinkCommandOptions): Promise<void> {
    const adapter = getAdapter(toolId);
    if (!adapter) {
        console.error(
            formatError(
                `Tool '${pc.bold(toolId)}' not supported. Available tools: ${getAllAdapters()
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

    try {
        const result = await adapter.link({
            baseUrl,
            apiKey,
            model,
            dryRun: options.dryRun
        });

        console.log(
            formatSuccess(
                `Successfully configured ${pc.bold(pc.cyan(adapter.name))} with SRouter proxy!`
            )
        );
        console.log(`  ${pc.gray("Target Config:")} ${pc.white(result.modifiedPath)}`);
        console.log(`  ${pc.gray("Proxy URL:")}     ${pc.white(baseUrl)}`);
        if (model) {
            console.log(`  ${pc.gray("Model:")}         ${pc.white(model)}`);
        }
        if (result.backupPath) {
            console.log(`  ${pc.gray("Backup Saved:")}  ${pc.white(result.backupPath)}`);
        }
    } catch (err: any) {
        console.error(formatError(`Failed to link ${adapter.name}: ${err.message}`));
        process.exitCode = 1;
    }
}
