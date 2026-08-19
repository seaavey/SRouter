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
import { getSystemInfo } from "../lib/platform.js";
import { checkServerHealth, fetchAvailableModels } from "../lib/srouterClient.js";
import { pc, showHeader } from "../lib/ui.js";

export interface SetupWizardOptions {
    url?: string;
    key?: string;
    model?: string;
    opusModel?: string;
    sonnetModel?: string;
    haikuModel?: string;
}

export async function setupCommand(options: SetupWizardOptions = {}): Promise<void> {
    showHeader();
    const sysInfo = getSystemInfo();
    intro(
        `${pc.bold(pc.magenta("SRouter AI Coding Setup Wizard"))} ${pc.gray(`(${sysInfo.displayName})`)}`
    );

    const savedConfig = await defaultStore.loadConfig();
    let baseUrl =
        options.url ||
        process.env.SROUTER_BASE_URL ||
        savedConfig.defaultBaseUrl ||
        "http://localhost:3000/v1";
    let apiKey = options.key || process.env.SROUTER_API_KEY || savedConfig.defaultApiKey;
    let selectedModel = options.model || savedConfig.defaultModel;
    let opusModel = options.opusModel || savedConfig.defaultOpusModel;
    let sonnetModel = options.sonnetModel || savedConfig.defaultSonnetModel;
    let haikuModel = options.haikuModel || savedConfig.defaultHaikuModel;

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
        let label = adapter.name;
        let hint = "";

        if (st.linked) {
            label = `${adapter.name} [✔ CONFIGURED]`;
            const modelPart = st.currentModel ? `, Model: ${st.currentModel}` : "";
            hint = `Active on ${st.currentBaseUrl}${modelPart} (Select to update settings)`;
        } else if (st.installed) {
            label = `${adapter.name} [○ NOT CONFIGURED]`;
            hint = `${adapter.description} (Installed on system)`;
        } else {
            label = `${adapter.name} [✖ NOT INSTALLED]`;
            hint = `${adapter.description} (Executable not found in PATH)`;
        }

        return {
            value: adapter.id,
            label,
            hint
        };
    });

    const selectedTools = await multiselect({
        message:
            "Select AI coding tools to connect to SRouter (Use Space to select, Enter to confirm):",
        options: toolOptions,
        required: false
    });

    if (isCancel(selectedTools)) {
        cancel("Setup cancelled.");
        process.exitCode = 0;
        return;
    }

    const toolsToConfigure = Array.isArray(selectedTools) ? (selectedTools as string[]) : [];

    if (toolsToConfigure.length === 0) {
        await defaultStore.saveConfig({
            defaultBaseUrl: baseUrl,
            defaultApiKey: apiKey,
            lastSetupAt: Date.now()
        });

        note(
            `Base URL:    ${pc.cyan(baseUrl)}\n${apiKey ? `API Key:     ${pc.gray("••••••••" + apiKey.slice(-4))}\n` : ""}\n${pc.yellow("No tools selected for configuration.")}`,
            "Configuration Summary"
        );
        outro(
            pc.bold(
                pc.green(
                    "✔ Gateway settings saved. You can run 'srouter setup' or 'srouter link <tool>' at any time."
                )
            )
        );
        return;
    }

    // Step 4: Model Selection
    if (!selectedModel) {
        if (availableModels.length > 0) {
            const modelOptions = availableModels.map((m) => ({
                value: m,
                label: m
            }));
            const modelChoice = await select({
                message: "Select default model for tools:",
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

    // Step 4.1: Claude Code Specific Models (Opus, Sonnet, Haiku)
    if (
        toolsToConfigure.includes("claude") &&
        !options.opusModel &&
        !options.sonnetModel &&
        !options.haikuModel
    ) {
        const configTiersChoice = await select({
            message: "Configure Claude Code specific model tiers (Opus, Sonnet, Haiku)?",
            options: [
                {
                    value: "auto",
                    label: "Use general default model / skip",
                    hint: selectedModel || "Default Claude models"
                },
                {
                    value: "custom",
                    label: "Customize per tier (Opus, Sonnet, Haiku)"
                }
            ]
        });

        if (isCancel(configTiersChoice)) {
            cancel("Setup cancelled.");
            process.exitCode = 0;
            return;
        }

        if (configTiersChoice === "custom") {
            const pickTierModel = async (
                tierName: string,
                envVar: string,
                defaultVal?: string
            ): Promise<string | undefined> => {
                if (availableModels.length > 0) {
                    const choice = await select({
                        message: `Select model for ${tierName} (${envVar}):`,
                        options: [
                            { value: "__skip__", label: "Skip (Use default)" },
                            ...availableModels.map((m) => ({ value: m, label: m })),
                            { value: "__custom__", label: "Custom model name..." }
                        ]
                    });
                    if (isCancel(choice)) return undefined;
                    if (choice === "__skip__") return undefined;
                    if (choice === "__custom__") {
                        const customInput = await text({
                            message: `Enter custom model ID for ${tierName}:`,
                            placeholder: defaultVal || "claude-3-7-sonnet"
                        });
                        if (isCancel(customInput)) return undefined;
                        const val = typeof customInput === "string" ? customInput.trim() : "";
                        return val || undefined;
                    }
                    return choice as string;
                }

                const customInput = await text({
                    message: `Enter model ID for ${tierName} (${envVar}, optional):`,
                    placeholder: defaultVal || "claude-3-7-sonnet"
                });
                if (isCancel(customInput)) return undefined;
                const val = typeof customInput === "string" ? customInput.trim() : "";
                return val || undefined;
            };

            const pickedSonnet = await pickTierModel(
                "Sonnet",
                "ANTHROPIC_DEFAULT_SONNET_MODEL",
                selectedModel || "claude-3-7-sonnet"
            );
            if (pickedSonnet !== undefined) {
                sonnetModel = pickedSonnet;
            }

            const pickedOpus = await pickTierModel(
                "Opus",
                "ANTHROPIC_DEFAULT_OPUS_MODEL",
                "claude-3-opus-20240229"
            );
            if (pickedOpus !== undefined) {
                opusModel = pickedOpus;
            }

            const pickedHaiku = await pickTierModel(
                "Haiku",
                "ANTHROPIC_DEFAULT_HAIKU_MODEL",
                "claude-3-5-haiku-20241022"
            );
            if (pickedHaiku !== undefined) {
                haikuModel = pickedHaiku;
            }
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
            model: selectedModel,
            opusModel: toolId === "claude" ? opusModel : undefined,
            sonnetModel: toolId === "claude" ? sonnetModel : undefined,
            haikuModel: toolId === "claude" ? haikuModel : undefined
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
        defaultOpusModel: opusModel,
        defaultSonnetModel: sonnetModel,
        defaultHaikuModel: haikuModel,
        lastSetupAt: Date.now()
    });

    s.stop(pc.green("All configurations applied successfully!"));

    // Step 6: Summary Notes
    const summaryLines = [
        `OS / System: ${pc.cyan(sysInfo.displayName)}`,
        `Base URL:    ${pc.cyan(baseUrl)}`,
        ...(apiKey ? [`API Key:     ${pc.gray("••••••••" + apiKey.slice(-4))}`] : []),
        ...(selectedModel ? [`Model:       ${pc.cyan(selectedModel)}`] : []),
        ...(opusModel ? [`Opus:        ${pc.cyan(opusModel)}`] : []),
        ...(sonnetModel ? [`Sonnet:      ${pc.cyan(sonnetModel)}`] : []),
        ...(haikuModel ? [`Haiku:       ${pc.cyan(haikuModel)}`] : []),
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
