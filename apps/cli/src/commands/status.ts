import { getAllAdapters } from "../adapters/index.js";
import { defaultStore } from "../lib/configStore.js";
import { checkServerHealth, fetchAvailableModels } from "../lib/srouterClient.js";
import {
    formatError,
    formatInfo,
    formatSuccess,
    formatWarning,
    pc,
    showHeader
} from "../lib/ui.js";

export interface StatusCommandOptions {
    url?: string;
    key?: string;
}

export async function statusCommand(options: StatusCommandOptions): Promise<void> {
    showHeader();

    const savedConfig = await defaultStore.loadConfig();
    const baseUrl = options.url || savedConfig.defaultBaseUrl || "http://localhost:3000/v1";
    const apiKey = options.key || savedConfig.defaultApiKey;

    console.log(pc.bold(pc.underline("Gateway Status:")));
    console.log(`  ${pc.gray("Target URL:")} ${pc.white(baseUrl)}`);

    const health = await checkServerHealth(baseUrl, apiKey);
    if (health.healthy) {
        console.log(
            `  ${pc.gray("Health:")}     ${pc.green("ONLINE")} ${pc.gray(`(${health.latencyMs}ms)`)}`
        );
        const models = await fetchAvailableModels(baseUrl, apiKey);
        console.log(`  ${pc.gray("Models:")}     ${pc.cyan(`${models.length} available`)}`);
        if (models.length > 0) {
            const preview = models.slice(0, 5).join(", ");
            const extra = models.length > 5 ? ` +${models.length - 5} more` : "";
            console.log(`            ${pc.gray(`[${preview}${extra}]`)}`);
        }
    } else {
        console.log(`  ${pc.gray("Health:")}     ${pc.red("OFFLINE / UNREACHABLE")}`);
        if (health.error) {
            console.log(`  ${pc.gray("Reason:")}     ${pc.yellow(health.error)}`);
        }
    }

    console.log("");
    console.log(pc.bold(pc.underline("Supported AI Coding Tools:")));

    const adapters = getAllAdapters();
    for (const adapter of adapters) {
        const status = await adapter.getStatus();
        const icon = status.linked ? pc.green("● LINKED") : pc.gray("○ UNLINKED");
        const installBadge = status.installed
            ? pc.green("[Installed]")
            : pc.yellow("[Not in PATH]");

        console.log(`\n  ${pc.bold(pc.cyan(adapter.name))} ${icon} ${installBadge}`);
        console.log(`  ${pc.gray("ID:")}          ${adapter.id}`);
        console.log(`  ${pc.gray("Config Path:")} ${status.configPath || "N/A"}`);
        if (status.linked) {
            console.log(`  ${pc.gray("Active URL:")}  ${pc.green(status.currentBaseUrl || "N/A")}`);
            if (status.currentModel) {
                console.log(`  ${pc.gray("Model:")}       ${pc.green(status.currentModel)}`);
            }
        }
    }

    console.log("");
}
