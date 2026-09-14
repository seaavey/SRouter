import { getAdapter, getAllAdapters } from "../adapters/index.js";
import { defaultStore } from "../lib/store.js";
import { formatError, formatSuccess, pc } from "../lib/ui.js";

export interface LinkCommandOptions {
    url?: string;
    key?: string;
    model?: string;
    opus_model?: string;
    sonnet_model?: string;
    haiku_model?: string;
    dry_run?: boolean;
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
    const base_url = options.url || savedConfig.default_base_url || "http://localhost:3000/v1";
    const api_key = options.key || savedConfig.default_api_key;
    const model = options.model || savedConfig.default_model;
    const opus_model = options.opus_model || savedConfig.default_opus_model;
    const sonnet_model = options.sonnet_model || savedConfig.default_sonnet_model;
    const haiku_model = options.haiku_model || savedConfig.default_haiku_model;

    try {
        const result = await adapter.link({
            base_url,
            api_key,
            model,
            opus_model,
            sonnet_model,
            haiku_model,
            dry_run: options.dry_run
        });

        console.log(
            formatSuccess(
                `Successfully configured ${pc.bold(pc.cyan(adapter.name))} with SRouter proxy!`
            )
        );
        console.log(`  ${pc.gray("Target Config:")} ${pc.white(result.modified_path)}`);
        console.log(`  ${pc.gray("Proxy URL:")}     ${pc.white(base_url)}`);
        if (model) {
            console.log(`  ${pc.gray("Model:")}         ${pc.white(model)}`);
        }
        if (opus_model) {
            console.log(`  ${pc.gray("Opus Model:")}    ${pc.white(opus_model)}`);
        }
        if (sonnet_model) {
            console.log(`  ${pc.gray("Sonnet Model:")}  ${pc.white(sonnet_model)}`);
        }
        if (haiku_model) {
            console.log(`  ${pc.gray("Haiku Model:")}   ${pc.white(haiku_model)}`);
        }
        if (result.backup_path) {
            console.log(`  ${pc.gray("Backup Saved:")}  ${pc.white(result.backup_path)}`);
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(formatError(`Failed to link ${adapter.name}: ${msg}`));
        process.exitCode = 1;
    }
}
