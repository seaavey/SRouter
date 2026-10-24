import { request, requestBlob } from "./client"
import type { DatabaseImportResponse } from "./types"

/**
 * The server's documented upload cap, mirrored so an oversized file is refused
 * before 25 MiB leaves the machine. The server stays the authority: this is a
 * courtesy check, not the enforcement.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/**
 * `GET /v1/admin/database/export`. The snapshot is binary, so it bypasses the
 * JSON path, and the browser saves it under the name the server chose.
 */
export async function exportDatabase(): Promise<void> {
  const { blob, filename } = await requestBlob("/v1/admin/database/export")
  const url = URL.createObjectURL(blob)
  // A detached anchor is not clickable in every browser, so it joins the
  // document for the one click and leaves right after.
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename ?? "srouter-backup.db.gz"
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoking in the same tick can cancel the download before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * `POST /v1/admin/database/import`. One file part named `database`, matching the
 * server's multipart contract. The answer replaces the database and clears the
 * session cookie, so the caller signs in again afterwards.
 */
export function importDatabase(file: File) {
  const form = new FormData()
  form.append("database", file, file.name)

  return request<DatabaseImportResponse>("/v1/admin/database/import", {
    method: "POST",
    form,
  })
}
