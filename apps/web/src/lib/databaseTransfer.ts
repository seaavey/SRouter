export interface DatabaseImportResult {
    ok: true;
    backup_path: string;
    restart_required: boolean;
}

export class DatabaseTransferError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

async function responseError(response: Response): Promise<DatabaseTransferError> {
    let message = response.statusText;
    try {
        const body = (await response.json()) as { error?: { message?: string } | string };
        message = typeof body.error === "string" ? body.error : (body.error?.message ?? message);
    } catch {
        // Keep the HTTP status text when the server does not return the standard error envelope.
    }
    return new DatabaseTransferError(response.status, message);
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
