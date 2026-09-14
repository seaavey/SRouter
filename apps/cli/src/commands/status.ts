import { getAllAdapters } from "../adapters/index.js";
import { defaultStore } from "../lib/store.js";
import { getSystemInfo } from "../lib/platform.js";
import { checkServerHealth, fetchAvailableModels } from "../lib/client.js";
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

    const sysInfo = getSystemInfo();
    console.log(pc.bold(pc.underline("System Environment:")));
    console.log(`  ${pc.gray("OS:")}          ${pc.white(sysInfo.display_name)}`);
    console.log(`  ${pc.gray("Platform:")}    ${pc.white(sysInfo.platform)} (${sysInfo.arch})`);
    console.log(`  ${pc.gray("Shell:")}       ${pc.white(sysInfo.detected_shell)}`);
    console.log(`  ${pc.gray("Home Dir:")}    ${pc.white(sysInfo.home_dir)}`);
    console.log("");

    const savedConfig = await defaultStore.loadConfig();
    const baseUrl = options.url || savedConfig.default_base_url || "http://localhost:3000/v1";
    const apiKey = options.key || savedConfig.default_api_key;

    console.log(pc.bold(pc.underline("Gateway Status:")));
    console.log(`  ${pc.gray("Target URL:")} ${pc.white(baseUrl)}`);

    const health = await checkServerHealth(baseUrl, apiKey);
    if (health.healthy) {
        console.log(
            `  ${pc.gray("Health:")}     ${pc.green("ONLINE")} ${pc.gray(`(${health.latency_ms}ms)`)}`
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
        const icon = status.linked
            ? pc.green("● CONFIGURED (LINKED)")
            : pc.gray("○ NOT CONFIGURED (UNLINKED)");
        const installBadge = status.installed
            ? pc.green("[Installed]")
            : pc.yellow("[Not in PATH]");

        console.log(`\n  ${pc.bold(pc.cyan(adapter.name))} ${icon} ${installBadge}`);
        console.log(`  ${pc.gray("ID:")}          ${adapter.id}`);
        console.log(`  ${pc.gray("Config Path:")} ${status.config_path || "N/A"}`);
        if (status.linked) {
            console.log(
                `  ${pc.gray("Active URL:")}  ${pc.green(status.current_base_url || "N/A")}`
            );
            if (status.current_model) {
                console.log(`  ${pc.gray("Model:")}       ${pc.green(status.current_model)}`);
            }
            if (status.current_opus_model) {
                console.log(`  ${pc.gray("Opus Model:")}  ${pc.green(status.current_opus_model)}`);
            }
            if (status.current_sonnet_model) {
                console.log(
                    `  ${pc.gray("Sonnet Model:")}${pc.green(status.current_sonnet_model)}`
                );
            }
            if (status.current_haiku_model) {
                console.log(`  ${pc.gray("Haiku Model:")} ${pc.green(status.current_haiku_model)}`);
            }
        } else {
            console.log(
                `  ${pc.gray("Status:")}      ${pc.yellow("Not connected to SRouter proxy")}`
            );
        }
    }

    console.log("");
}
