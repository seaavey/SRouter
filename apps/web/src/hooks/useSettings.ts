import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { APP_VERSION } from "@srouter/constants";
import { api } from "@/lib/api";

export interface AppSettings {
    // Appearance
    uiDensity: "compact" | "cozy";
    // Gateway & Proxy
    requestTimeoutSec: number;
    autoRetryOn429: boolean;
    maxRetries: number;
    retryDelayMs: number;
    tokenRefreshLeadMin: number;
    // Logging & Privacy
    loggingLevel: "full" | "metadata" | "disabled";
    logRetentionDays: number;
    recordTokenUsage: boolean;
    maskSensitiveHeaders: boolean;
}

export interface StorageStats {
    totalBytes: number;
    itemsCount: number;
    settingsBytes: number;
}

const DEFAULT_SETTINGS: AppSettings = {
    uiDensity: "compact",
    requestTimeoutSec: 120,
    autoRetryOn429: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    tokenRefreshLeadMin: 5,
    loggingLevel: "full",
    logRetentionDays: 30,
    recordTokenUsage: true,
    maskSensitiveHeaders: true
};

const STORAGE_KEY = "srouter_app_settings";

const SERVER_SETTING_KEYS: Partial<Record<keyof AppSettings, string>> = {
    requestTimeoutSec: "request_timeout_sec",
    autoRetryOn429: "auto_retry_on_429",
    maxRetries: "max_retries",
    retryDelayMs: "retry_delay_ms",
    tokenRefreshLeadMin: "token_refresh_lead_min",
    loggingLevel: "logging_level",
    logRetentionDays: "log_retention_days",
    recordTokenUsage: "record_token_usage",
    maskSensitiveHeaders: "mask_sensitive_headers"
};

export function useSettings() {
    const [settings, setSettings] = useState<AppSettings>(() => {
        if (typeof window === "undefined") return DEFAULT_SETTINGS;
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
        } catch {
            return DEFAULT_SETTINGS;
        }
    });

    useEffect(() => {
        void api
            .get<{ settings?: Record<string, string> }>("/v1/settings")
            .then((response) => {
                const server = response.settings ?? {};
                const keys = Object.values(SERVER_SETTING_KEYS).filter(
                    (key): key is string => key !== undefined
                );
                if (!keys.some((key) => key in server)) {
                    const migrated: Record<string, string> = {};
                    for (const [key, serverKey] of Object.entries(SERVER_SETTING_KEYS)) {
                        if (serverKey)
                            migrated[serverKey] = String(settings[key as keyof AppSettings]);
                    }
                    void api.patch("/v1/settings", { settings: migrated });
                    return;
                }
                const hydrated = { ...settings };
                for (const [key, serverKey] of Object.entries(SERVER_SETTING_KEYS)) {
                    const value = serverKey ? server[serverKey] : undefined;
                    if (value === undefined) continue;
                    const settingKey = key as keyof AppSettings;
                    const current = settings[settingKey];
                    hydrated[settingKey] = (
                        typeof current === "boolean"
                            ? value === "true"
                            : typeof current === "number"
                              ? Number(value)
                              : value
                    ) as never;
                }
                setSettings(hydrated);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(hydrated));
            })
            .catch(() => undefined);
    }, []);

    const updateSetting = useCallback(
        <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
            setSettings((prev) => {
                const updated = { ...prev, [key]: value };
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
                    const serverKey = SERVER_SETTING_KEYS[key];
                    if (serverKey) {
                        void api.patch("/v1/settings", {
                            settings: { [serverKey]: String(value) }
                        });
                    }
                } catch (e) {
                    console.error("Failed to save settings to localStorage", e);
                }
                return updated;
            });
        },
        []
    );

    const resetToDefaults = useCallback(() => {
        setSettings(DEFAULT_SETTINGS);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
            toast.success("Settings restored to default preferences");
        } catch (e) {
            console.error("Failed to reset settings", e);
            toast.error("Failed to reset settings");
        }
    }, []);

    const exportSettings = useCallback(() => {
        const payload = {
            version: APP_VERSION,
            exportedAt: new Date().toISOString(),
            settings
        };
        const dataStr =
            "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 4));
        const downloadAnchor = document.createElement("a");
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute(
            "download",
            `srouter-settings-${new Date().toISOString().slice(0, 10)}.json`
        );
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        toast.success("Settings configuration exported as JSON");
    }, [settings]);

    const importSettings = useCallback((jsonString: string): boolean => {
        try {
            const parsed = JSON.parse(jsonString);
            const importedSettings =
                parsed.settings && typeof parsed.settings === "object" ? parsed.settings : parsed;

            const validated: AppSettings = {
                ...DEFAULT_SETTINGS,
                ...importedSettings
            };

            setSettings(validated);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
            toast.success("Settings imported successfully");
            return true;
        } catch (err) {
            console.error("Failed to parse settings JSON", err);
            toast.error("Invalid configuration file. Please ensure it is valid JSON.");
            return false;
        }
    }, []);

    const getStorageStats = useCallback((): StorageStats => {
        if (typeof window === "undefined") {
            return { totalBytes: 0, itemsCount: 0, settingsBytes: 0 };
        }

        let totalBytes = 0;
        let settingsBytes = 0;
        const itemsCount = localStorage.length;

        for (let i = 0; i < itemsCount; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            const val = localStorage.getItem(key) || "";
            const byteSize = (key.length + val.length) * 2;
            totalBytes += byteSize;

            if (key === STORAGE_KEY) {
                settingsBytes += byteSize;
            }
        }

        return {
            totalBytes,
            itemsCount,
            settingsBytes
        };
    }, []);

    const clearStorage = useCallback(() => {
        if (typeof window === "undefined") return;
        let removed = 0;
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k !== STORAGE_KEY) {
                localStorage.removeItem(k);
                removed++;
            }
        }
        toast.success(`Cleared ${removed} cached items`);
    }, []);

    return {
        settings,
        updateSetting,
        resetToDefaults,
        exportSettings,
        importSettings,
        getStorageStats,
        clearStorage
    };
}
