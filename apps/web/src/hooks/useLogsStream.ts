import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LogsStreamEvent } from "@srouter/types";
import { getGatewayBaseUrl } from "@/lib/api";

type UseLogsStreamOptions = {
    invalidateLogs?: boolean;
    onEvent?: (event: LogsStreamEvent) => void;
};

function IsLogsStreamEvent(value: unknown): value is LogsStreamEvent {
    if (typeof value !== "object" || value === null || !("type" in value)) return false;

    const type = value.type;
    return type === "connected" || type === "usage.updated" || type === "request.logged";
}

export function useLogsStream({ invalidateLogs = false, onEvent }: UseLogsStreamOptions = {}) {
    const queryClient = useQueryClient();
    const onEventRef = useRef(onEvent);

    onEventRef.current = onEvent;

    useEffect(() => {
        if (typeof window === "undefined" || typeof window.EventSource === "undefined") return;

        const source = new EventSource(`${getGatewayBaseUrl()}/logs/events`);

        source.onmessage = (message) => {
            try {
                const value: unknown = JSON.parse(message.data);
                if (!IsLogsStreamEvent(value)) return;

                if (value.type === "usage.updated") {
                    queryClient.setQueryData(["stats"], value.stats);
                    if (invalidateLogs) {
                        void queryClient.invalidateQueries({ queryKey: ["logs"] });
                    }
                }

                onEventRef.current?.(value);
            } catch {
                return;
            }
        };

        return () => source.close();
    }, [invalidateLogs, queryClient]);
}
