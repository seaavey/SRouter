# SRouter

LLM gateway self-hosted yang berbicara dua bahasa API sekaligus: OpenAI dan Anthropic. Jalankan di mesinmu sendiri, sambungkan akun provider yang sudah kamu bayar, lalu arahkan semua tool ke satu endpoint, bukan satu API key per provider.

[English](README.md) · **Bahasa Indonesia**

## Yang bisa dilakukan

- Satu endpoint untuk klien bergaya OpenAI (`/v1/chat/completions`) dan bergaya Anthropic (`/v1/messages`). Streaming dan tool call lewat apa adanya sebagai SSE.
- Provider yang didukung: OpenCode Zen (free tier), Qoder, Cline, Grok Web, OpenAI Codex, CodeBuddy (global dan CN), Google Antigravity, dan Claude Code. Masing-masing punya driver sendiri: alur OAuth, refresh token, dan terjemahan protokol.
- Id model memakai format `provider/model`, jadi `antigravity/gemini-3.7-flash-high` dirutekan lewat driver Antigravity. Id polos juga bisa selama hanya satu provider yang mengiklankan model itu.
- Endpoint custom yang kompatibel OpenAI bisa didaftarkan dan diverifikasi lewat API.
- API key gateway (`sr-live-...`) terpisah dari kredensial provider. Tiap key punya rate-limit, kuota token, limit kredit, dan flag aktif sendiri; yang disimpan hanya hash sha256 plus prefix tampilan, bukan secret-nya.
- Setiap request dicatat ke SQLite: provider, model, jumlah token, latensi, status, dan estimasi biaya. Isi prompt dan completion tidak pernah disimpan.
- Dashboard React ada di `client/` untuk sesi admin: login dan setup pertama sudah jalan, layar lainnya masih dibangun (lihat [Kondisi saat ini](#kondisi-saat-ini)).

## Menjalankannya

Butuh toolchain Rust (edition 2024, artinya 1.85 ke atas; `server/rust-toolchain.toml` sudah mem-pin channel-nya).

```bash
git clone https://github.com/seaavey/SRouter.git
cd SRouter
cargo run --manifest-path server/Cargo.toml
```

Server mendengarkan di `http://127.0.0.1:3000`, menyimpan database SQLite di `~/.srouter/srouter.db`, dan menulis log ke stdout. `server/.env.example` memuat semua environment variable yang dibaca server; yang perlu kamu tahu di hari pertama:

| Variable                 | Default                 | Fungsi                                                                                       |
| ------------------------ | ----------------------- | -------------------------------------------------------------------------------------------- |
| `PORT`                   | `3000`                  | Listener HTTP                                                                                |
| `DATABASE_PATH`          | `~/.srouter/srouter.db` | File SQLite                                                                                  |
| `SROUTER_ADMIN_PASSWORD` | tidak diisi             | Membuat akun admin saat boot, dan mereset password-nya setiap boot selama variabel ini diisi |
| `WEB_DIST_PATH`          | tidak diisi             | Hasil build dashboard yang akan disajikan di `/`                                             |

Tiga hal yang sering bikin kaget di run pertama:

- `dotenvy` membaca `.env` relatif ke current working directory, jadi jalankan server dengan cwd `server/` atau export sendiri variabelnya.
- `WEB_DIST_PATH` menunjuk ke hasil build yang kamu buat sendiri, bukan pencarian otomatis. Build dashboard dengan `bun run build` di `client/` lalu set `WEB_DIST_PATH=client/dist`, atau biarkan kosong maka `GET /` menjawab objek info API. Path-nya juga dihitung relatif ke working directory.
- PostgreSQL ditolak saat boot dengan sengaja. SQLite satu-satunya backend.

Binary release menjalankan program yang sama:

```bash
cargo build --release --manifest-path server/Cargo.toml
cd server && ./target/release/srouter-server    # cwd server/ supaya .env terbaca
```

## Menyambungkan client

OpenAI SDK, diarahkan ke gateway:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:3000/v1",
    api_key="sr-live-key-kamu",
)

response = client.chat.completions.create(
    model="antigravity/gemini-3.7-flash-high",
    messages=[{"role": "user", "content": "Halo!"}],
    stream=True,
)
```

Anthropic SDK, gateway yang sama, bentuk Anthropic:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "http://127.0.0.1:3000/v1",
  apiKey: "sr-live-key-kamu",
});

const message = await client.messages.create({
  model: "claude/claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Halo dari SRouter!" }],
});
```

curl juga bisa:

```bash
curl -N http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sr-live-key-kamu" \
  -d '{
    "model": "opencode_zen/big-pickle",
    "messages": [{"role": "user", "content": "Halo!"}],
    "stream": true
  }'
```

Request dari loopback boleh tanpa key sampai kamu menyalakan setting `require_api_key`. Apa pun yang datang lewat jaringan wajib membawa key, di `Authorization: Bearer <key>` atau `x-api-key: <key>`. Header klien yang didukung termasuk `anthropic-version`.

## Auth dan akses

- **API key gateway** dibuat lewat `POST /v1/keys` (perlu sesi admin) dan hanya dikembalikan sekali. Yang tersimpan cuma hash dan prefix, jadi key yang hilang diganti, bukan dipulihkan.
- **Sesi admin** berupa cookie `HttpOnly`, `SameSite=Lax` selama tujuh hari, dan server memeriksa `Origin` pada setiap mutasi. Masuk lewat `/login` di dashboard, atau `POST /v1/admin/login`. Admin pertama dibuat lewat `POST /v1/admin/setup` (hanya menerima koneksi loopback), atau dengan mengisi `SROUTER_ADMIN_PASSWORD` sebelum boot pertama.
- **Kredensial provider** tersimpan di tabel `providers` dalam file SQLite yang sama, dalam bentuk polos. Perlakukan file itu seperti `.env`: hanya boleh dibaca user service, jangan masuk backup bersama, dan hati-hati saat memindahkan export.

## API

| Method                        | Path                                                                                                                     | Guard                       | Fungsi                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------- |
| `GET`                         | `/v1`, `/health`                                                                                                         | none                        | Info API dan health check                                                          |
| `POST`                        | `/v1/chat/completions`, `/v1/chat`, `/v1/chat/completion`                                                                | API key + rate limit        | Chat kompatibel OpenAI, streaming atau tidak                                       |
| `POST`                        | `/v1/messages`, `/v1/messages/count_tokens`                                                                              | API key + rate limit        | Messages kompatibel Anthropic dan hitung token                                     |
| `POST`                        | `/v1/images/generations`                                                                                                 | API key + rate limit        | Generasi gambar                                                                    |
| `GET`                         | `/v1/models`, `/v1/models/{id}`, `/v1/providers`, `/v1/providers/catalog`, `/v1/logs`, `/v1/quota`, `/v1/models/pricing` | API key                     | Permukaan baca: katalog, koneksi provider, log dan statistik request, kuota, harga |
| `GET`                         | `/v1/settings`                                                                                                           | API key                     | `require_api_key` dan kawan-kawan                                                  |
| `POST` `PUT` `PATCH` `DELETE` | `/v1/models...`                                                                                                          | Sesi admin                  | Penulisan model                                                                    |
| `POST` `PATCH` `DELETE`       | `/v1/providers...`                                                                                                       | Sesi admin                  | Endpoint custom, penyuntingan provider, bobot round-robin                          |
| `GET` `POST`                  | `/v1/auth/<provider>/...`                                                                                                | Sesi admin; callback publik | Login OAuth dan callback                                                           |
| `PATCH` `POST`                | `/v1/settings`                                                                                                           | Sesi admin                  | Penulisan settings                                                                 |
| `GET` `POST` `PATCH` `DELETE` | `/v1/keys...`                                                                                                            | Sesi admin                  | API key gateway beserta kuotanya                                                   |
| `GET` `POST`                  | `/v1/admin/{status,setup,login,logout,change-password}`, `/v1/admin/database/{export,import}`                            | Per handler                 | Sesi admin dan transfer database                                                   |

Sudut-sudut yang tidak didaftarkan di sini (alias kompatibilitas `/v1/v1/...`, halaman callback yang dipasang di root) plus tabel guard per mount ada di `skills/srouter-server/references/http-layer.md`. Error dikembalikan dalam envelope OpenAI: `{"error": {"message", "type", "code", "param"}}`. Kegagalan provider di tengah stream datang sebagai SSE error event, bukan koneksi yang putus.

## Dashboard

`client/` adalah aplikasi Bun + Vite + React 19. Saat ini baru ada dua layar: `/login` (masuk dan setup pertama) dan `/` (placeholder di balik session gate), keduanya bersandar pada `/v1/admin/status`.

```bash
cd client
bun install
bun run dev        # http://localhost:5173, mem-proxy /v1 ke server
bun run build      # file statis untuk WEB_DIST_PATH
bun run typecheck
bun run lint
```

Di sisi client belum ada test runner; `typecheck`, `lint`, dan `build` adalah pemeriksaannya.

## Development

```bash
cargo run --manifest-path server/Cargo.toml                              # jalankan
cargo test --manifest-path server/Cargo.toml --test chat_completions     # satu suite
cargo test --manifest-path server/Cargo.toml --locked                    # semuanya
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features --locked -- -D warnings
```

Server-nya satu crate, tanpa workspace dan tanpa DI container. `server/tests/` memuat suite integrasi, dan setiap suite membuat database SQLite sementara sendiri plus upstream palsu, jadi test tidak pernah menyentuh data aslimu atau menghubungi provider sungguhan. Tidak ada CI: jalankan sendiri suite-nya sebelum push.

Tipe wire dibagi ke client lewat TypeScript yang di-generate. Setelah mengubah tipe Rust:

```bash
cargo run --manifest-path server/Cargo.toml --bin export_ts   # menulis ulang kedua salinan yang di-commit
```

`server/bindings.ts` dan `client/src/generated/typed.ts` adalah file hasil generate. Commit keduanya; ada test yang gagal kalau salah satunya berbeda dari hasil render yang baru.

Untuk bahan yang lebih dalam: `CONTRIBUTING.md` membahas build dan konvensi commit, `SECURITY.md` menjelaskan di mana kredensial berada dan apa yang dihitung sebagai kerentanan, dan `skills/srouter-server/` mendokumentasikan arsitektur crate ini.

## Kondisi saat ini

Repositori ini dipangkas menjadi crate server dan dashboard pada Oktober 2026. Yang dihapus: `apps/api` Node yang jadi sumber port server Rust, tujuh package workspace `packages/*`, CLI, dan situs dokumentasi. Kode lamanya masih bisa dibaca di branch `backup/pre-packages-removal` dan `backup/pre-apps-api-removal`.

Yang ada sekarang adalah server plus dashboard yang masih awal. Belum ada Dockerfile, belum ada workflow CI, dan belum ada release bertag untuk versi crate saat ini (tag terakhir, v0.1.8, milik era Node).

## Lisensi

[MIT](LICENSE)
