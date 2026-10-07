import type { RequestLog } from "@/generated/api";

export interface LogTableProps {
    logs: RequestLog[];
    requireApiKey?: boolean;
    onSelect: (log: RequestLog) => void;
    page?: number;
    pageSize?: number;
    pageCount?: number;
    totalRows?: number;
    onPageChange?: (page: number) => void;
}
