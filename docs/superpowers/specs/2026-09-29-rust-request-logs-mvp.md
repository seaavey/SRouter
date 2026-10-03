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
- Bentuk model response dan record persistence `RequestLog` sesuai fields berikut. JSON response memakai nama field snake_case; optional fields serialisasi sebagai `null`.

```rust
use uuid::Uuid;

pub struct RequestLog {
    pub id: Uuid,
    pub request_id: Uuid,
    pub user_id: Option<Uuid>,
    pub api_key_id: Option<Uuid>,

    pub method: String,
    pub path: String,
    pub status_code: i16,

    pub ip_address: Option<String>,
    pub user_agent: Option<String>,

    pub provider: Option<String>,
    pub model: Option<String>,

    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub total_tokens: Option<i64>,

    pub latency_ms: i64,

    pub error_code: Option<String>,
    pub error_message: Option<String>,
}
```

- `request_id` dibuat sekali per inbound request dan dipakai semua log row/event yang berasal dari request itu. `id` unik per record. UUID disimpan sebagai canonical text di SQLite; Rust butuh `uuid` dependency dengan v4 dan serde support. `user_id` tetap `None` sampai API menyediakan user identity.
- Schema migration wajib mempertahankan history yang sudah ada; implementasi harus menangani row lama yang tidak punya `request_id`, method/path, user ID, maupun UUID ID. Catat strategi mapping legacy sebelum migration dibuat; jangan drop tabel/history atau menyamarkan nilai hilang.
- Tambahkan routes:
    - `GET /v1/logs`: kembalikan `{object: "list", data: [...]}`. Tanpa `page`, kembalikan log terbaru; `limit` default `50`. Jika `page` ada, sertakan `pagination` dengan `page`, `limit`, `total`, dan `total_pages`. Dukung `status=all|success|error` pada mode paginasi.
    - `GET /v1/logs/:id`: kembalikan satu object `RequestLog`; ID UUID yang tidak ditemukan menghasilkan `404`.
    - `GET /v1/logs/events`: buka SSE stream dengan headers `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, dan `X-Accel-Buffering: no` sesuai protokol HTTP yang berlaku.
- SSE mempertahankan framing Node: event awal `data: {"type":"connected"}\n\n`; log baru memicu `usage.updated` berisi statistik terbaru dan `request.logged` berisi object `RequestLog`; heartbeat berupa `: ping\n\n` tiap 25 detik. Batasi maksimal 16 stream aktif; koneksi berikutnya mendapat `429`. Lepaskan slot dan subscriber ketika client membatalkan atau koneksi terputus.
- Publikasikan event setelah log berhasil tersimpan. Jangan kirim event untuk insert yang gagal.
- Reuse satu query/mapper log untuk daftar, detail, dan payload event agar bentuk JSON konsisten. Gunakan SQLx; ubah schema `request_logs` melalui migration backward-safe untuk mendukung model baru. Tidak perlu tabel baru.
- SQLite jadi target persistence MVP. Untuk backend PostgreSQL yang belum mendukung request-log repository, endpoint harus gagal secara eksplisit; jangan menjawab sukses dengan data kosong.
- Response log mengikuti object `RequestLog` di atas (bukan bentuk camelCase Node lama atau `costBreakdown`). Error dan SSE envelope tetap kompatibel dengan perilaku Node.
- Implementasi streaming tidak boleh mengumpulkan seluruh response SSE di memori.

## Testing Decisions

- Tambahkan integration tests Rust pada satu test file `server/tests/logs.rs`, memakai `support::TestDatabase` dan temporary SQLite saja.
- Verifikasi perilaku HTTP, bukan nama handler atau detail internal: API-key auth, daftar terbaru, paginasi/filter, detail dan `404`, event awal, event sesudah log tersimpan, heartbeat, limit stream, headers, serta cleanup saat client disconnect.
- Gunakan seeded synthetic logs dengan timestamp deterministik dan UUID fixtures untuk membuktikan urutan, filter, metadata paginasi, dan JSON snake_case `RequestLog`.
- Bandingkan response JSON dan SSE event dengan kontrak di `docs/api-v1-contract.md` dan perilaku `apps/api`; jangan baca source atau data `packages/*`.
- Jalankan test file fokus dan `cargo fmt --check`; jangan jalankan full suite di mesin dev resource-constrained.

## Out of Scope

- `GET /v1/logs/stats` dan `GET /v1/logs/analytics` sebagai endpoint mandiri.
- Quota/pricing dashboard, export log, retention/cleanup, advanced filtering, dan perubahan UI.
- Perubahan route atau kontrak `apps/api`.
- Pricing/cost enrichment pada log response.

## Acceptance Criteria

- Tiga route terpasang di `/v1` dengan API-key auth.
- Daftar log, detail log, dan SSE berperilaku sesuai kontrak di atas.
- Log yang tersimpan menghasilkan event; insert gagal tidak menghasilkan event.
- JSON list, detail, dan SSE `request.logged` memakai `RequestLog` shape dan UUID fields.
- Schema migration mempertahankan log lama; mapping nilai yang tidak tersedia terdokumentasi dan teruji.
- Batas SSE dan cleanup koneksi teruji.
- SQLite tests memakai database sementara; PostgreSQL unsupported state terlihat sebagai error, bukan response sukses kosong.
- Focused tests dan format check lulus.
