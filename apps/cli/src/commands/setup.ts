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
import { defaultStore } from "../lib/store.js";
import { getSystemInfo } from "../lib/platform.js";
import { checkServerHealth, fetchAvailableModels } from "../lib/client.js";
import { pc, showHeader } from "../lib/ui.js";

export interface SetupWizardOptions {
    url?: string;
    key?: string;
    model?: string;
    opus_model?: string;
    sonnet_model?: string;
    haiku_model?: string;
}

export async function setupCommand(options: SetupWizardOptions = {}): Promise<void> {
    showHeader();
    const sysInfo = getSystemInfo();
    intro(
        `${pc.bold(pc.magenta("SRouter AI Coding Setup Wizard"))} ${pc.gray(`(${sysInfo.display_name})`)}`
    );

    const savedConfig = await defaultStore.loadConfig();
    let base_url =
        options.url ||
        process.env.SROUTER_BASE_URL ||
        savedConfig.default_base_url ||
        "http://localhost:3000/v1";
    let api_key = options.key || process.env.SROUTER_API_KEY || savedConfig.default_api_key;
    let selectedModel = options.model;
    let opus_model = options.opus_model;
    let sonnet_model = options.sonnet_model;
    let haiku_model = options.haiku_model;

    // Step 1: Detect SRouter Server
    const s = spinner();
    s.start(`Checking SRouter gateway connectivity at ${pc.cyan(base_url)}...`);

    let health = await checkServerHealth(base_url, api_key);
    let available_models: string[] = [];

    if (health.healthy) {
        s.stop(
            pc.green(
                `SRouter is ONLINE (${health.latency_ms}ms, ${health.models_count} models found)`
            )
        );
        available_models = await fetchAvailableModels(base_url, api_key);
    } else {
        s.stop(pc.yellow(`Could not reach SRouter at ${base_url} (${health.error || "offline"})`));

        const urlInput = await text({
            message: "Enter SRouter Gateway Base URL:",
            initialValue: base_url,
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

        const urlStr = typeof urlInput === "string" ? urlInput.trim() : base_url;
        if (urlStr) {
            base_url = urlStr;
        }

        s.start(`Connecting to ${pc.cyan(base_url)}...`);
        health = await checkServerHealth(base_url, api_key);
        if (health.healthy) {
            s.stop(pc.green(`Connected to SRouter (${health.models_count} models found)`));
            available_models = await fetchAvailableModels(base_url, api_key);
        } else {
            s.stop(pc.yellow(`Proceeding with offline / unverified endpoint: ${base_url}`));
        }
    }

    // Step 2: Prompt for API Key if not set
    if (!api_key) {
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
            api_key = keyStr;
            if (available_models.length === 0) {
                available_models = await fetchAvailableModels(base_url, api_key);
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
            const modelPart = st.current_model ? `, Model: ${st.current_model}` : "";
            hint = `Active on ${st.current_base_url}${modelPart} (Select to update settings)`;
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
            default_base_url: base_url,
            default_api_key: api_key,
            last_setup_at: Date.now()
        });

        note(
            `Base URL:    ${pc.cyan(base_url)}\n${api_key ? `API Key:     ${pc.gray("••••••••" + api_key.slice(-4))}\n` : ""}\n${pc.yellow("No tools selected for configuration.")}`,
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
        const currentDefault = savedConfig.default_model || "claude-3-7-sonnet";

        if (available_models.length > 0) {
            const defaultHint = `(${currentDefault}) - all ${available_models.length} models are automatically registered in OpenCode`;
            const modelChoice = await select({
                message: "Select default model for tools:",
                options: [
                    {
                        value: "__skip__",
                        label: `Use default / Skip ${pc.gray(defaultHint)}`
                    },
                    {
                        value: "__popular__",
                        label: "Choose from popular models (Claude 3.7, GPT-4o, Gemini 2.5, DeepSeek R1)..."
                    },
                    {
                        value: "__custom__",
                        label: "Enter model ID manually..."
                    },
                    {
                        value: "__browse__",
                        label: `Browse full model list (${available_models.length} models)...`
                    }
                ]
            });

            if (isCancel(modelChoice)) {
                cancel("Setup cancelled.");
                process.exitCode = 0;
                return;
            }

            if (modelChoice === "__skip__") {
                selectedModel = currentDefault;
            } else if (modelChoice === "__popular__") {
                const popularChoice = await select({
                    message: "Choose a popular model:",
                    options: [
                        { value: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet (Recommended)" },
                        { value: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
                        { value: "gpt-4o", label: "GPT-4o (OpenAI)" },
                        { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Google)" },
                        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Fast)" },
                        { value: "deepseek-r1", label: "DeepSeek R1 (Reasoning)" },
                        { value: "combo/flagship", label: "Combo: Flagship Cascade" },
                        { value: "__custom__", label: "Other / Custom ID..." }
                    ]
                });
                if (isCancel(popularChoice)) {
                    cancel("Setup cancelled.");
                    process.exitCode = 0;
                    return;
                }
                if (popularChoice === "__custom__") {
                    const customModelInput = await text({
                        message: "Enter custom model ID:",
                        placeholder: currentDefault
                    });
                    if (isCancel(customModelInput)) {
                        cancel("Setup cancelled.");
                        process.exitCode = 0;
                        return;
                    }
                    const customModelStr =
                        typeof customModelInput === "string" ? customModelInput.trim() : "";
                    selectedModel = customModelStr || currentDefault;
                } else {
                    selectedModel = popularChoice as string;
                }
            } else if (modelChoice === "__custom__") {
                const customModelInput = await text({
                    message: "Enter custom model ID:",
                    placeholder: currentDefault
                });
                if (isCancel(customModelInput)) {
                    cancel("Setup cancelled.");
                    process.exitCode = 0;
                    return;
                }
                const customModelStr =
                    typeof customModelInput === "string" ? customModelInput.trim() : "";
                selectedModel = customModelStr || currentDefault;
            } else if (modelChoice === "__browse__") {
                const modelOptions = available_models.map((m) => ({
                    value: m,
                    label: m
                }));
                const browseChoice = await select({
                    message: `Select from ${available_models.length} available models:`,
                    options: [
                        ...modelOptions,
                        { value: "__custom__", label: "Custom model name..." }
                    ]
                });
                if (isCancel(browseChoice)) {
                    cancel("Setup cancelled.");
                    process.exitCode = 0;
                    return;
                }
                if (browseChoice === "__custom__") {
                    const customModelInput = await text({
                        message: "Enter custom model ID:",
                        placeholder: currentDefault
                    });
                    if (isCancel(customModelInput)) {
                        cancel("Setup cancelled.");
                        process.exitCode = 0;
                        return;
                    }
                    const customModelStr =
                        typeof customModelInput === "string" ? customModelInput.trim() : "";
                    selectedModel = customModelStr || currentDefault;
                } else {
                    selectedModel = browseChoice as string;
                }
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
        !options.opus_model &&
        !options.sonnet_model &&
        !options.haiku_model
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
                if (available_models.length > 0) {
                    const choice = await select({
                        message: `Select model for ${tierName} (${envVar}):`,
                        options: [
                            { value: "__skip__", label: "Skip (Use default)" },
                            ...available_models.map((m) => ({ value: m, label: m })),
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
                sonnet_model = pickedSonnet;
            }

            const pickedOpus = await pickTierModel(
                "Opus",
                "ANTHROPIC_DEFAULT_OPUS_MODEL",
                "claude-3-opus-20240229"
            );
            if (pickedOpus !== undefined) {
                opus_model = pickedOpus;
            }

            const pickedHaiku = await pickTierModel(
                "Haiku",
                "ANTHROPIC_DEFAULT_HAIKU_MODEL",
                "claude-3-5-haiku-20241022"
            );
            if (pickedHaiku !== undefined) {
                haiku_model = pickedHaiku;
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
            base_url,
            api_key,
            model: selectedModel,
            opus_model: toolId === "claude" ? opus_model : undefined,
            sonnet_model: toolId === "claude" ? sonnet_model : undefined,
            haiku_model: toolId === "claude" ? haiku_model : undefined,
            available_models
        });

        linkResults.push({
            name: adapter.name,
            path: result.modified_path,
            backup: result.backup_path
        });
    }

    await defaultStore.saveConfig({
        default_base_url: base_url,
        default_api_key: api_key,
        default_model: selectedModel,
        default_opus_model: opus_model,
        default_sonnet_model: sonnet_model,
        default_haiku_model: haiku_model,
        last_setup_at: Date.now()
    });

    s.stop(pc.green("All configurations applied successfully!"));

    // Step 6: Summary Notes
    const summaryLines = [
        `OS / System: ${pc.cyan(sysInfo.display_name)}`,
        `Base URL:    ${pc.cyan(base_url)}`,
        ...(api_key ? [`API Key:     ${pc.gray("••••••••" + api_key.slice(-4))}`] : []),
        ...(selectedModel ? [`Model:       ${pc.cyan(selectedModel)}`] : []),
        ...(opus_model ? [`Opus:        ${pc.cyan(opus_model)}`] : []),
        ...(sonnet_model ? [`Sonnet:      ${pc.cyan(sonnet_model)}`] : []),
        ...(haiku_model ? [`Haiku:       ${pc.cyan(haiku_model)}`] : []),
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
