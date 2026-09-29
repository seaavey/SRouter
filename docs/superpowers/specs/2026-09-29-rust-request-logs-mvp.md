# Spec: Rust Request Logs MVP

## Problem Statement

Rust server sudah mencatat sebagian request ke `request_logs`, tetapi belum menyediakan endpoint untuk membaca log atau menerima event log secara live. Saat migrasi dari `apps/api`, operator belum bisa memantau request lewat Rust.

## Solution

Tambahkan tiga endpoint dasar di Rust: daftar log, detail satu log, dan SSE events. Pertahankan kontrak Node yang sudah tercatat; statistik dan analytics endpoint terpisah bukan bagian MVP.

## User Stories

1. Sebagai operator, saya ingin melihat request terbaru agar bisa memantau aktivitas server.
2. Sebagai operator, saya ingin membuka satu log berdasarkan ID agar bisa memeriksa detail request.
3. Sebagai dashboard, saya ingin menerima log baru melalui SSE tanpa polling.
4. Sebagai operator, saya ingin endpoint log tetap terlindungi oleh autentikasi API key seperti API Node.

## Implementation Decisions

- Implementasi berada di `server/`; `apps/api/` tetap menjadi oracle dan tidak diubah.
- Semua endpoint memerlukan middleware API-key auth yang sama dengan Node logs routes.
- Tambahkan routes:
  - `GET /v1/logs`: kembalikan `{object: "list", data: [...]}`. Tanpa `page`, kembalikan log terbaru; `limit` default `50`. Jika `page` ada, sertakan `pagination` dengan `page`, `limit`, `total`, dan `total_pages`. Dukung `status=all|success|error` pada mode paginasi.
  - `GET /v1/logs/:id`: kembalikan satu log dalam bentuk Node-compatible, termasuk enrichment `costBreakdown`; ID yang tidak ditemukan menghasilkan `404`.
  - `GET /v1/logs/events`: buka SSE stream dengan headers `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, dan `X-Accel-Buffering: no` sesuai protokol HTTP yang berlaku.
- SSE mempertahankan framing Node: event awal `data: {"type":"connected"}\n\n`; log baru memicu `usage.updated` berisi statistik terbaru dan `request.logged` berisi log terbaru; heartbeat berupa `: ping\n\n` tiap 25 detik. Batasi maksimal 16 stream aktif; koneksi berikutnya mendapat `429`. Lepaskan slot dan subscriber ketika client membatalkan atau koneksi terputus.
- Publikasikan event setelah log berhasil tersimpan. Jangan kirim event untuk insert yang gagal.
- Reuse satu query/mapper log untuk daftar, detail, dan payload event agar bentuk JSON konsisten. Gunakan SQLx dan schema `request_logs` v2 yang sudah ada; jangan tambah tabel atau dependency.
- SQLite jadi target persistence MVP. Untuk backend PostgreSQL yang belum mendukung request-log repository, endpoint harus gagal secara eksplisit; jangan menjawab sukses dengan data kosong.
- Kembalikan bentuk JSON dan error kompatibel Node. Jangan keluarkan `apiKeyId` ketika setting `require_api_key` tidak aktif, sesuai perilaku enrichment Node.
- Implementasi streaming tidak boleh mengumpulkan seluruh response SSE di memori.

## Testing Decisions

- Tambahkan integration tests Rust pada satu test file `server/tests/logs.rs`, memakai `support::TestDatabase` dan temporary SQLite saja.
- Verifikasi perilaku HTTP, bukan nama handler atau detail internal: API-key auth, daftar terbaru, paginasi/filter, detail dan `404`, event awal, event sesudah log tersimpan, heartbeat, limit stream, headers, serta cleanup saat client disconnect.
- Gunakan seeded synthetic logs dengan timestamp deterministik untuk membuktikan urutan, filter, dan metadata paginasi.
- Bandingkan response JSON dan SSE event dengan kontrak di `docs/api-v1-contract.md` dan perilaku `apps/api`; jangan baca source atau data `packages/*`.
- Jalankan test file fokus dan `cargo fmt --check`; jangan jalankan full suite di mesin dev resource-constrained.

## Out of Scope

- `GET /v1/logs/stats` dan `GET /v1/logs/analytics` sebagai endpoint mandiri.
- Quota/pricing dashboard, export log, retention/cleanup, advanced filtering, dan perubahan UI.
- Perubahan route atau kontrak `apps/api`.
- Perombakan format log atau schema database.

## Acceptance Criteria

- Tiga route terpasang di `/v1` dengan API-key auth.
- Daftar log, detail log, dan SSE berperilaku sesuai kontrak di atas.
- Log yang tersimpan menghasilkan event; insert gagal tidak menghasilkan event.
- Batas SSE dan cleanup koneksi teruji.
- SQLite tests memakai database sementara; PostgreSQL unsupported state terlihat sebagai error, bukan response sukses kosong.
- Focused tests dan format check lulus.
