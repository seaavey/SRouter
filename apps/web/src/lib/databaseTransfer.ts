import { responseError } from "./apiError";

export interface DatabaseImportResult {
    ok: true;
    backup_path: string;
    restart_required: boolean;
}

export async function exportDatabase(): Promise<Blob> {
    const response = await fetch("/v1/admin/database/export", {
        credentials: "include"
    });
    if (!response.ok) throw await responseError(response);
    return response.blob();
}

export async function importDatabase(file: File): Promise<DatabaseImportResult> {
    const formData = new FormData();
    formData.set("database", file);
    const response = await fetch("/v1/admin/database/import", {
        method: "POST",
        credentials: "include",
        body: formData
    });
    if (!response.ok) throw await responseError(response);
    return response.json() as Promise<DatabaseImportResult>;
}

export function downloadDatabaseBlob(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `srouter-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
    document.body.append(link);
    link.click();
    link.remove();
    queueMicrotask(() => URL.revokeObjectURL(url));
}
