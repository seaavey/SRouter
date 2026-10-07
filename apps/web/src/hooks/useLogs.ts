import { useMemo, useState } from "react";
import type { RequestLog } from "@/generated/api";

export type LogStatusFilter = "all" | "success" | "error";

export function useLogs(logs: RequestLog[]) {
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<LogStatusFilter>("all");
    const [apiKeyFilter, setApiKeyFilter] = useState<string>("all");

    const filteredLogs = useMemo(
        () =>
            logs.filter((log) => {
                const query = searchQuery.toLowerCase().trim();
                const matchesQuery =
                    !query ||
                    (log.model ?? "").toLowerCase().includes(query) ||
                    (log.provider ?? "").toLowerCase().includes(query) ||
                    log.id.toLowerCase().includes(query) ||
                    (log.ip_address && log.ip_address.toLowerCase().includes(query)) ||
                    (log.resolved_model && log.resolved_model.toLowerCase().includes(query)) ||
                    (log.api_key_id && log.api_key_id.toLowerCase().includes(query));

                const isSuccess = log.status_code >= 200 && log.status_code < 300;
                if (statusFilter === "success" && !isSuccess) return false;
                if (statusFilter === "error" && isSuccess) return false;

                if (apiKeyFilter !== "all") {
                    if (apiKeyFilter === "none") {
                        if (log.api_key_id) return false;
                    } else if (log.api_key_id !== apiKeyFilter) {
                        return false;
                    }
                }

                return matchesQuery;
            }),
        [logs, searchQuery, statusFilter, apiKeyFilter]
    );

    return {
        searchQuery,
        setSearchQuery,
        statusFilter,
        setStatusFilter,
        apiKeyFilter,
        setApiKeyFilter,
        filteredLogs
    };
}
