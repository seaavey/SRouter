import {
    intro,
    outro,
    spinner,
    text,
    select,
    multiselect,
    isCancel,
    cancel,
    note
} from "@clack/prompts";
import { getAllAdapters } from "../adapters/index.js";
import { defaultStore } from "../lib/configStore.js";
import { checkServerHealth, fetchAvailableModels } from "../lib/srouterClient.js";
import { pc, showHeader } from "../lib/ui.js";

export interface SetupWizardOptions {
    url?: string;
    key?: string;
    model?: string;
}

export async function setupCommand(options: SetupWizardOptions = {}): Promise<void> {
    showHeader();
    intro(pc.bold(pc.magenta("SRouter AI Coding Setup Wizard")));

    const savedConfig = await defaultStore.loadConfig();
    let baseUrl =
        options.url ||
        process.env.SROUTER_BASE_URL ||
        savedConfig.defaultBaseUrl ||
        "http://localhost:3000/v1";
    let apiKey = options.key || process.env.SROUTER_API_KEY || savedConfig.defaultApiKey;
    let selectedModel = options.model || savedConfig.defaultModel;

    // Step 1: Detect SRouter Server
    const s = spinner();
    s.start(`Checking SRouter gateway connectivity at ${pc.cyan(baseUrl)}...`);

    let health = await checkServerHealth(baseUrl, apiKey);
    let availableModels: string[] = [];

    if (health.healthy) {
        s.stop(
            pc.green(
                `SRouter is ONLINE (${health.latencyMs}ms, ${health.modelsCount} models found)`
            )
        );
        availableModels = await fetchAvailableModels(baseUrl, apiKey);
    } else {
        s.stop(pc.yellow(`Could not reach SRouter at ${baseUrl} (${health.error || "offline"})`));

        const urlInput = await text({
            message: "Enter SRouter Gateway Base URL:",
            initialValue: baseUrl,
            validate(value) {
                const val = typeof value === "string" ? value.trim() : "";
                if (!val) return "Base URL cannot be empty";
                if (!val.startsWith("http://") && !val.startsWith("https://")) {
                    return "URL must start with http:// or https://";
                }
            }
        });

        if (isCancel(urlInput)) {
            cancel("Setup cancelled.");
            process.exitCode = 0;
            return;
        }

        const urlStr = typeof urlInput === "string" ? urlInput.trim() : baseUrl;
        if (urlStr) {
            baseUrl = urlStr;
        }

        s.start(`Connecting to ${pc.cyan(baseUrl)}...`);
        health = await checkServerHealth(baseUrl, apiKey);
        if (health.healthy) {
            s.stop(pc.green(`Connected to SRouter (${health.modelsCount} models found)`));
            availableModels = await fetchAvailableModels(baseUrl, apiKey);
        } else {
            s.stop(pc.yellow(`Proceeding with offline / unverified endpoint: ${baseUrl}`));
        }
    }

    // Step 2: Prompt for API Key if not set
    if (!apiKey) {
        const keyInput = await text({
            message:
                "Enter SRouter API Key (press Enter to skip if running in local auth-free mode):",
            placeholder: "sk-..."
        });

        if (isCancel(keyInput)) {
            cancel("Setup cancelled.");
            process.exitCode = 0;
            return;
        }

        const keyStr = typeof keyInput === "string" ? keyInput.trim() : "";
        if (keyStr) {
            apiKey = keyStr;
            if (availableModels.length === 0) {
                availableModels = await fetchAvailableModels(baseUrl, apiKey);
            }
        }
    }

    // Step 3: Tool Selection Checklist (Multi-select)
    const adapters = getAllAdapters();
    const adapterStatuses = await Promise.all(adapters.map((a) => a.getStatus()));

    const toolOptions = adapters.map((adapter, idx) => {
        const st = adapterStatuses[idx];
        const statusHint = st.linked
            ? "currently linked"
            : st.installed
              ? "installed"
              : "not in PATH";
        return {
            value: adapter.id,
            label: adapter.name,
            hint: `${adapter.description} (${statusHint})`
        };
    });

    const selectedTools = await multiselect({
        message: "Pilih tool AI coding yang ingin dihubungkan ke SRouter:",
        options: toolOptions,
        required: true,
        initialValues: adapters.map((a) => a.id)
    });

    if (isCancel(selectedTools)) {
        cancel("Setup cancelled.");
        process.exitCode = 0;
        return;
    }

    const toolsToConfigure = Array.isArray(selectedTools) ? (selectedTools as string[]) : [];

    // Step 4: Model Selection
    if (!selectedModel) {
        if (availableModels.length > 0) {
            const modelOptions = availableModels.map((m) => ({
                value: m,
                label: m
            }));
            const modelChoice = await select({
                message: "Pilih default model untuk tool:",
                options: [...modelOptions, { value: "__custom__", label: "Custom model name..." }]
            });

            if (isCancel(modelChoice)) {
                cancel("Setup cancelled.");
                process.exitCode = 0;
                return;
            }

            if (modelChoice === "__custom__") {
                const customModelInput = await text({
                    message: "Enter custom model ID:",
                    placeholder: "claude-3-7-sonnet"
                });
                if (isCancel(customModelInput)) {
                    cancel("Setup cancelled.");
                    process.exitCode = 0;
                    return;
                }
                const customModelStr =
                    typeof customModelInput === "string" ? customModelInput.trim() : "";
                selectedModel = customModelStr || undefined;
            } else {
                selectedModel = modelChoice as string;
            }
        } else {
            const modelInput = await text({
                message: "Enter default model ID for tools (optional, press Enter for default):",
                placeholder: "claude-3-7-sonnet"
            });
            if (isCancel(modelInput)) {
                cancel("Setup cancelled.");
                process.exitCode = 0;
                return;
            }
            const modelStr = typeof modelInput === "string" ? modelInput.trim() : "";
            selectedModel = modelStr || undefined;
        }
    }

    // Step 5: Execute Linking
    s.start("Applying SRouter configurations...");
    const linkResults: { name: string; path: string; backup?: string }[] = [];

    for (const toolId of toolsToConfigure) {
        const adapter = adapters.find((a) => a.id === toolId);
        if (!adapter) continue;

        const result = await adapter.link({
            baseUrl,
            apiKey,
            model: selectedModel
        });

        linkResults.push({
            name: adapter.name,
            path: result.modifiedPath,
            backup: result.backupPath
        });
    }

    await defaultStore.saveConfig({
        defaultBaseUrl: baseUrl,
        defaultApiKey: apiKey,
        defaultModel: selectedModel,
        lastSetupAt: Date.now()
    });

    s.stop(pc.green("All configurations applied successfully!"));

    // Step 6: Summary Notes
    const summaryLines = [
        `Base URL: ${pc.cyan(baseUrl)}`,
        ...(apiKey ? [`API Key:  ${pc.gray("••••••••" + apiKey.slice(-4))}`] : []),
        ...(selectedModel ? [`Model:    ${pc.cyan(selectedModel)}`] : []),
        "",
        pc.bold("Configured Tools:")
    ];

    for (const r of linkResults) {
        summaryLines.push(`  ✔ ${pc.bold(r.name)} -> ${pc.gray(r.path)}`);
        if (r.backup) {
            summaryLines.push(`    ${pc.gray("Backup:")} ${pc.gray(r.backup)}`);
        }
    }

    note(summaryLines.join("\n"), "Configuration Summary");

    outro(
        pc.bold(pc.green("✔ SRouter is connected! You can now use your AI coding tools directly."))
    );
}
