import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type {
    TokenSaverPreviewRequest,
    TokenSaverPreviewResponse,
    TokenSaverSettings
} from "@srouter/types";

export const DEFAULT_TOKEN_SAVER_SETTINGS: TokenSaverSettings = {
    enabled: true,
    compressToolOutput: {
        enabled: true,
        compressGit: true,
        compressGrep: true,
        compressFileLists: true,
        compressLogs: true,
        stripAnsiAndWhitespace: true,
        minCharacterThreshold: 50
    },
    lazySeniorDev: {
        enabled: true,
        mode: "balanced"
    },
    compressLlmOutput: {
        enabled: true,
        mode: "terse",
        stripPleasantries: true
    }
};

export function useTokenSaver() {
    const [settings, setSettings] = useState<TokenSaverSettings>(DEFAULT_TOKEN_SAVER_SETTINGS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [simulating, setSimulating] = useState(false);

    const fetchSettings = useCallback(async () => {
        try {
            const res = await api.get<{ settings: TokenSaverSettings }>("/v1/settings/token-saver");
            if (res.settings) {
                setSettings(res.settings);
            }
        } catch (err) {
            console.error("Failed to fetch token saver settings:", err);
            toast.error("Failed to load Token Saver settings");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchSettings();
    }, [fetchSettings]);

    const updateSettings = useCallback(async (partial: Partial<TokenSaverSettings>) => {
        setSaving(true);
        try {
            const res = await api.patch<{ settings: TokenSaverSettings; message?: string }>(
                "/v1/settings/token-saver",
                partial
            );
            if (res.settings) {
                setSettings(res.settings);
                toast.success("Token Saver settings updated");
                return res.settings;
            }
            return null;
        } catch (err) {
            const msg =
                err instanceof Error ? err.message : "Failed to update Token Saver settings";
            toast.error(msg);
            return null;
        } finally {
            setSaving(false);
        }
    }, []);

    const simulate = useCallback(
        async (req: TokenSaverPreviewRequest): Promise<TokenSaverPreviewResponse | null> => {
            setSimulating(true);
            try {
                const res = await api.post<TokenSaverPreviewResponse>(
                    "/v1/settings/token-saver/test",
                    {
                        ...req,
                        settings: req.settings ?? settings
                    }
                );
                return res;
            } catch (err) {
                const msg =
                    err instanceof Error ? err.message : "Failed to run Token Saver simulation";
                toast.error(msg);
                return null;
            } finally {
                setSimulating(false);
            }
        },
        [settings]
    );

    const resetDefaults = useCallback(async () => {
        return updateSettings(DEFAULT_TOKEN_SAVER_SETTINGS);
    }, [updateSettings]);

    return {
        settings,
        loading,
        saving,
        simulating,
        updateSettings,
        simulate,
        resetDefaults,
        refetch: fetchSettings
    };
}
