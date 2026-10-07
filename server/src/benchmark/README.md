# SRouter k6 Benchmark Suite

Kumpulan skrip uji performa dan beban (load testing & benchmarking) untuk SRouter Gateway menggunakan [Grafana k6](https://k6.io/).

---

## 📁 Struktur Folder

```
src/benchmark/
├── README.md        # Panduan penggunaan dan referensi skrip
├── config.js        # Konfigurasi target URL, endpoint, API key, headers, dan thresholds
├── helpers.js       # Generator random prompt, parser SSE, dan custom metrics k6
├── smoke.js         # Uji konektivitas dasar (1 VU, verifikasi semua rute 200 OK)
├── health.js        # Uji throughput tinggi untuk GET /health (baseline latency Axum)
├── catalog.js       # Uji beban endpoint katalog (/v1/models & /v1/pricing/models)
├── chat.js          # Uji endpoint LLM POST /v1/chat (stream & non-stream dengan random output)
├── stress.js        # Uji stress bertahap (hingga 300 VU) untuk mencari breaking point
├── soak.js          # Uji ketahanan jangka panjang (endurance / soak test)
└── index.js         # Runner gabungan multi-skenario dengan summary report
```

---

## 🚀 Persiapan & Instalasi k6

Jika `k6` belum terinstal di sistem:

### Linux (Arch Linux):

```bash
sudo pacman -S k6
```

### Linux (Ubuntu / Debian):

```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D34EE73F
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

### macOS:

```bash
brew install k6
```

### Docker (Tanpa Instalasi Lokal):

```bash
docker run --rm -i --net=host -v $PWD:/app grafana/k6 run /app/src/benchmark/chat.js
```

---

## 🧪 Cara Menjalankan Benchmark

Pastikan server SRouter sudah berjalan (misal port 3000):

### 1. Uji `/v1/chat` (Stream + Non-Stream + Random Output)

Skrip `chat.js` secara default mengarah ke endpoint `/v1/chat` dan mengacak output menggunakan variasi prompt dinamis (20+ topik acak, template pertanyaan kreatif, random nonce, random temperature 0.7-1.0, serta max_tokens 30-75):

```bash
# Mode Default: Mixed (50% stream SSE dan 50% non-stream JSON)
k6 run -e API_KEY="sk-srouter-test-key" src/benchmark/chat.js

# Menampilkan cuplikan teks respons model acak secara langsung:
k6 run -e API_KEY="sk-srouter-test-key" -e SHOW_OUTPUT=true src/benchmark/chat.js

# Khusus Streaming SSE saja:
k6 run -e API_KEY="sk-srouter-test-key" -e STREAM_MODE=stream src/benchmark/chat.js

# Khusus Non-Streaming JSON saja:
k6 run -e API_KEY="sk-srouter-test-key" -e STREAM_MODE=non-stream src/benchmark/chat.js

# Menggunakan model tertentu (misal zen/big-pickle atau nemotron-3-ultra-free):
k6 run -e API_KEY="sk-srouter-test-key" -e MODEL="zen/big-pickle" src/benchmark/chat.js
```

### 2. Smoke Test (Verifikasi Awal)

Memastikan seluruh endpoint merespons dengan status 200 OK dan format JSON valid:

```bash
k6 run src/benchmark/smoke.js
```

### 3. Gateway Baseline Throughput (`/health`)

Mengukur performa murni gateway Rust/Axum tanpa overhead database:

```bash
k6 run src/benchmark/health.js
```

### 4. Catalog Read Benchmark

Menguji rute pembacaan katalog model dan daftar harga (`/v1/models` & `/v1/pricing/models`):

```bash
k6 run -e API_KEY="sk-srouter-test-key" src/benchmark/catalog.js
```

### 5. Stress Test

Mendorong beban konkurensi bertahap dari 50 hingga 300 Virtual Users (VU):

```bash
k6 run src/benchmark/stress.js
```

### 6. Soak Test (Uji Ketahanan & Deteksi Memory Leak)

Menjalankan 30 VU konstan selama durasi tertentu:

```bash
# Durasi default 2 menit:
k6 run src/benchmark/soak.js

# Kustomisasi durasi (misal 30 menit):
k6 run -e SOAK_DURATION=30m src/benchmark/soak.js
```

### 7. Full Benchmark Suite (Multi-Skenario)

Menjalankan skenario terintegrasi dan menghasilkan laporan ringkasan:

```bash
k6 run src/benchmark/index.js
```

Laporan ringkasan JSON akan otomatis disimpan ke `summary.json`.

---

## ⚙️ Variabel Lingkungan (Environment Variables)

Semua skrip mendukung konfigurasi melalui flag `-e KEY=VALUE`:

| Variabel        | Default                 | Deskripsi                                                         |
| :-------------- | :---------------------- | :---------------------------------------------------------------- |
| `BASE_URL`      | `http://localhost:3000` | Alamat target gateway SRouter                                     |
| `CHAT_ENDPOINT` | `/v1/chat`              | Endpoint rute chat (`/v1/chat` atau `/v1/chat/completions`)       |
| `STREAM_MODE`   | `mixed`                 | Mode pengujian chat: `mixed` (50/50), `stream`, atau `non-stream` |
| `SHOW_OUTPUT`   | `false`                 | Set `true` untuk mencetak respons teks acak ke konsol             |
| `API_KEY`       | `sk-srouter-test-key`   | API Key untuk autentikasi endpoint terlindungi                    |
| `MODEL`         | `zen/big-pickle`        | ID model LLM untuk pengujian chat                                 |
| `TIMEOUT`       | `30s`                   | Batas waktu tunggu per request                                    |
| `SOAK_DURATION` | `2m`                    | Durasi uji endurance pada `soak.js`                               |
