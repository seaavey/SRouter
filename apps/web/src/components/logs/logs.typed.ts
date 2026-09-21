import type { RequestLogEntry } from "@srouter/types";

export interface LogTableProps {
    logs: RequestLogEntry[];
    requireApiKey?: boolean;
    onSelect: (log: RequestLogEntry) => void;
    page?: number;
    pageSize?: number;
    pageCount?: number;
    totalRows?: number;
    onPageChange?: (page: number) => void;
}
