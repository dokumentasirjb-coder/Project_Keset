# Sistem Operasional & Akuntansi Usaha Keset (SAK EMKM)

Aplikasi Web ERP & POS lengkap untuk **Usaha Manufaktur dan Perdagangan Keset** berbasis standar **SAK EMKM**.

## 🚀 Fitur Utama

1. **Dashboard KPI & Monitoring:**
   - Saldo Kas & Bank riil.
   - Nilai persediaan 3 lokasi: Gudang Bahan Baku (`RAW_WH`), Bahan di Pekerja / WIP (`WORKER`), dan Gudang Barang Jadi (`FG_WH`).
   - Total Piutang Usaha & Total Utang Usaha (Pemasok + Upah Borongan).
   - Indikator SPK/Tiket lewat batas tanggal (*overdue*).

2. **Produksi Borongan (SPK Tiket Kerja):**
   - **Serah Bahan ke Pekerja (WIP):** Memotong stok gudang bahan dan memindahkannya ke tangan pekerja (**Auto-Jurnal D1**).
   - **Setor Hasil Jadi & QC:** Menghitung jumlah lolos QC, rework, dan reject. Menghitung upah borongan dan mengkapitalisasi biaya bahan + upah ke HPP Barang Jadi (**Auto-Jurnal D2**).
   - **Retur Sisa Bahan:** Mengembalikan sisa bahan dari pekerja ke gudang (**Auto-Jurnal D3**).
   - **Tutup Tiket & Analisis Susut:** Menghitung toleransi susut wajar vs varian selisih bahan di atas toleransi (**Auto-Jurnal D4 & D5**).

3. **Penjualan (POS / Faktur):**
   - Penjualan Keset Jadi maupun penjualan Bahan Baku.
   - Pilihan bayar tunai / transfer lunas atau kredit (piutang).
   - Mendukung harga jual bertingkat (*Eceran, Grosir, Distributor*).
   - Otomatis mencatat pengakuan pendapatan dan HPP metode rata-rata bergerak (**Auto-Jurnal B1, B2, B3, B4**).
   - Pelunasan faktur piutang (**Auto-Jurnal B6**).
   - Netting / kompensasi piutang vs utang mitra yang sama (**Auto-Jurnal C1**).

4. **Pengadaan Bahan Baku:**
   - Pembelian bahan baku dari pemasok (tunai / kredit).
   - Otomatis menambah stok di gudang dan menghitung ulang biaya rata-rata bergerak (*moving average*) (**Auto-Jurnal A1 & A2**).
   - Pelunasan utang ke pemasok (**Auto-Jurnal A3**).

5. **Penggajian Borongan & Kasbon:**
   - Pencairan kasbon pekerja (**Auto-Jurnal E1**).
   - Penerbitan slip upah borongan per periode dengan pemotongan kasbon otomatis (**Auto-Jurnal E2**).

6. **Laporan Keuangan Standar SAK EMKM:**
   - **Laporan Laba Rugi** (Pendapatan Usaha, HPP Keset, Laba Kotor, Beban Operasional, Laba Bersih).
   - **Laporan Posisi Keuangan / Neraca** (Aset Lancar = Liabilitas + Ekuitas).
   - **Neraca Saldo (*Trial Balance*)** dengan verifikasi keseimbangan debit-kredit.
   - **Buku Jurnal Umum (*General Journal*)** lengkap dengan detail ayat jurnal.
   - **Kartu Stok & Saldo Inventaris per Lokasi**.

---

## 💻 Cara Menjalankan Aplikasi

Aplikasi dibangun menggunakan **Node.js** dan database lokal **SQLite** (bawaan `node:sqlite`), sehingga dapat langsung dijalankan tanpa perlu menginstal PostgreSQL atau Docker secara terpisah.

### 1. Jalankan Server
Buka terminal / PowerShell di folder ini, lalu jalankan:
```bash
npm start
```
*(atau `node server.js`)*

### 2. Buka di Browser
Akses alamat berikut di browser:
```text
http://localhost:3000
```

Database `keset.db` akan dibuat dan diisi secara otomatis dengan bagan akun SAK EMKM, master data contoh (Kain Perca, Benang Nilon, Keset Microfiber Cendol, Keset Anyam Tenun), pekerja borongan, mitra usaha, resep kebutuhan bahan (BOM), dan tarif upah borongan.

