import { useMemo, useState } from "react";
import type { RequestLogEntry } from "@/lib/types";

export type LogStatusFilter = "all" | "success" | "error";

export function useLogs(logs: RequestLogEntry[]) {
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<LogStatusFilter>("all");

    const filteredLogs = useMemo(
        () =>
            logs.filter((log) => {
                const matchesQuery =
                    log.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    log.providerId.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    log.id.toLowerCase().includes(searchQuery.toLowerCase());

                const isSuccess = log.statusCode >= 200 && log.statusCode < 300;
                if (statusFilter === "success" && !isSuccess) return false;
                if (statusFilter === "error" && isSuccess) return false;

                return matchesQuery;
            }),
        [logs, searchQuery, statusFilter],
    );

    return { searchQuery, setSearchQuery, statusFilter, setStatusFilter, filteredLogs };
}
