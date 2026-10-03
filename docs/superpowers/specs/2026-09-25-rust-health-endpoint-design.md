# Desain Endpoint Health Rust

**Status:** Disetujui
**Tanggal:** 2026-09-25

## Tujuan

Tambahkan endpoint health yang dapat dipanggil pada server Rust mandiri di `server/`. Endpoint mengikuti kontrak API yang sudah dibekukan di `docs/api-v1-contract.md`.

## Perilaku

- Server utama mendengarkan pada `0.0.0.0:$PORT`; nilai default `PORT` tetap `3000` dari `APIConfig`.
- `GET /health` mengembalikan status HTTP `200` dan JSON `{"status":"ok"}`.
- Endpoint bersifat statis. Pemeriksaan database, provider, dan dependency runtime lainnya berada di luar cakupan.
- Slice ini tidak menambahkan listener OAuth, middleware global, atau route API lain.

## Desain

- Gunakan Axum untuk router HTTP dan Tokio untuk runtime asynchronous, sesuai arsitektur migrasi Rust yang disepakati.
- Tambahkan komposisi router sederhana di `server/src/app.rs` dan pasang route health di sana.
- Ubah `server/src/main.rs` menjadi entry point asynchronous: baca `APIConfig`, bind listener utama, lalu jalankan router dengan Axum.
- Uji router langsung tanpa membuka port tetap. Tes memeriksa status, content type JSON, dan body endpoint.

## Verifikasi

- `cargo test --manifest-path server/Cargo.toml --test http_runtime`
- `cargo check --manifest-path server/Cargo.toml --all-targets`
- `cargo fmt --manifest-path server/Cargo.toml -- --check`
- `git diff --check`

## Non-goals

- Listener OAuth dan callback provider.
- Health check yang membaca database atau memanggil provider.
- Middleware, `/v1`, static web serving, dan route lain yang termasuk tahap runtime HTTP berikutnya.
