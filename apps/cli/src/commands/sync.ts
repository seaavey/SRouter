import { getAllAdapters, getAdapter } from "../adapters/index.js";
import { defaultStore } from "../lib/store.js";
import { checkServerHealth, fetchAvailableModels } from "../lib/client.js";
import { formatError, formatSuccess, formatWarning, pc } from "../lib/ui.js";

export interface SyncCommandOptions {
    url?: string;
    key?: string;
}

export async function syncCommand(
    toolId?: string,
    options: SyncCommandOptions = {}
): Promise<void> {
    const savedConfig = await defaultStore.loadConfig();
    const base_url = options.url || savedConfig.default_base_url || "http://localhost:3000/v1";
    const api_key = options.key || savedConfig.default_api_key;

    const health = await checkServerHealth(base_url, api_key);
    if (!health.healthy) {
        console.error(
            formatError(
                `Cannot sync: SRouter Gateway is unreachable at ${pc.bold(base_url)} (${health.error || "offline"}).`
            )
        );
        process.exitCode = 1;
        return;
    }

    const available_models = await fetchAvailableModels(base_url, api_key);
    if (available_models.length === 0) {
        console.warn(
            formatWarning(`SRouter Gateway responded at ${base_url}, but returned 0 models.`)
        );
    }

    const adaptersToSync = toolId
        ? [getAdapter(toolId)].filter((a): a is NonNullable<typeof a> => Boolean(a))
        : getAllAdapters();

    if (toolId && adaptersToSync.length === 0) {
        console.error(formatError(`Tool '${pc.bold(toolId)}' not supported.`));
        process.exitCode = 1;
        return;
    }

    for (const adapter of adaptersToSync) {
        if (!adapter) continue;
        const status = await adapter.getStatus();
        if (!status.linked && !toolId) {
            // Skip unlinked tools if running global sync
            continue;
        }

        try {
            const result = await adapter.link({
                base_url,
                api_key,
                model: savedConfig.default_model || status.current_model,
                opus_model: savedConfig.default_opus_model,
                sonnet_model: savedConfig.default_sonnet_model,
                haiku_model: savedConfig.default_haiku_model,
                available_models
            });

            console.log(
                formatSuccess(
                    `Synced ${pc.bold(pc.cyan(available_models.length.toString()))} models to ${pc.bold(adapter.name)} (${pc.gray(result.modified_path)})`
                )
            );
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(formatError(`Failed to sync ${adapter.name}: ${msg}`));
        }
    }
}
