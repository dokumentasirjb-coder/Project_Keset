# Daftar Akun dan Jurnal Otomatis: Usaha Keset

Acuan: SAK EMKM. Metode persediaan: rata-rata bergerak. Semua jurnal dibuat otomatis oleh sistem dari transaksi; pengguna tidak mengisi jurnal manual (kecuali jurnal penyesuaian oleh pemilik/keuangan).

## 1. Daftar akun (chart of accounts)

| Kode | Nama akun | Tipe | Catatan |
|---|---|---|---|
| **1** | **ASET** | judul | |
| 1-1100 | Kas | Aset | |
| 1-1200 | Bank | Aset | satu akun per rekening (lihat `cash_accounts`) |
| 1-1300 | Piutang Usaha | Aset | sub-ledger per mitra |
| 1-1400 | Piutang Karyawan (Kasbon) | Aset | sub-ledger per pekerja |
| 1-1500 | Persediaan Bahan Baku | Aset | lokasi RAW_WH |
| 1-1510 | Persediaan Bahan di Pekerja (WIP) | Aset | lokasi WORKER |
| 1-1520 | Persediaan Barang Jadi | Aset | lokasi FG_WH |
| 1-1900 | Uang Muka / Biaya Dibayar Dimuka | Aset | opsional |
| 1-2000 | Peralatan | Aset | opsional |
| 1-2900 | Akumulasi Penyusutan Peralatan | Aset | kontra aset, opsional |
| **2** | **LIABILITAS** | judul | |
| 2-1100 | Utang Usaha | Liabilitas | sub-ledger per mitra |
| 2-1200 | Utang Upah Borongan | Liabilitas | sub-ledger per pekerja |
| 2-1300 | Utang Pajak (PPh Final) | Liabilitas | opsional |
| **3** | **EKUITAS** | judul | |
| 3-1000 | Modal Pemilik | Ekuitas | |
| 3-2000 | Prive | Ekuitas | |
| 3-3000 | Laba Ditahan | Ekuitas | |
| **4** | **PENDAPATAN** | judul | |
| 4-1000 | Penjualan Keset | Pendapatan | |
| 4-2000 | Penjualan Bahan Baku | Pendapatan | |
| 4-3000 | Retur Penjualan | Pendapatan (kontra) | saldo debit |
| 4-4000 | Diskon Penjualan | Pendapatan (kontra) | saldo debit |
| 4-9000 | Pendapatan Lain-lain | Pendapatan | |
| **5** | **HARGA POKOK DAN BEBAN PRODUKSI** | judul | |
| 5-1000 | HPP Keset | HPP | |
| 5-2000 | HPP Bahan Baku | HPP | |
| 5-3000 | Upah Borongan | HPP | tenaga kerja langsung; dikapitalisasi ke Barang Jadi |
| 5-4000 | Beban Selisih Bahan | HPP/Beban | selisih di atas toleransi |
| 5-5000 | Selisih Persediaan (Opname) | HPP/Beban | |
| **6** | **BEBAN OPERASIONAL** | judul | |
| 6-1000 | Beban Transportasi | Beban | |
| 6-1100 | Beban Listrik dan Air | Beban | |
| 6-1200 | Beban Sewa Gudang | Beban | |
| 6-1300 | Beban Administrasi dan Umum | Beban | |
| 6-1400 | Beban Penyusutan | Beban | opsional |
| 6-1500 | Beban Lain-lain | Beban | |
| 6-2000 | Beban Pajak Penghasilan Final | Beban | opsional |

Catatan: karena produksi di rumah pekerja dan overhead kecil, biaya gudang/transport diperlakukan sebagai **beban operasional**, tidak dialokasikan ke HPP (penyederhanaan yang wajar untuk EMKM; bisa ditinjau bila overhead membesar).

## 2. Tabel jurnal otomatis

Notasi: **Dr** = debit, **Cr** = kredit. `biaya` = biaya rata-rata bergerak saat transaksi.

### A. Pembelian dan pembayaran

| # | Kejadian | Tabel sumber | Jurnal |
|---|---|---|---|
| A1 | Beli bahan baku **tunai** | `purchases` | Dr 1-1500 Persediaan Bahan Baku; Cr 1-1100/1200 Kas/Bank |
| A2 | Beli bahan baku **kredit** | `purchases` | Dr 1-1500 Persediaan Bahan Baku; Cr 2-1100 Utang Usaha (mitra) |
| A3 | Bayar utang pemasok | `payments` (OUT) | Dr 2-1100 Utang Usaha (mitra); Cr 1-1100/1200 Kas/Bank |
| A4 | Beli sebagian tunai (uang muka/DP) | `purchases` | Dr 1-1500; Cr Kas/Bank (sebesar bayar) dan Cr 2-1100 (sisa) |

Efek stok: RAW_WH bertambah; biaya rata-rata dihitung ulang = (nilai lama + nilai baru) / (qty lama + qty baru).

### B. Penjualan

| # | Kejadian | Tabel sumber | Jurnal |
|---|---|---|---|
| B1 | Jual **keset** tunai | `sales` | (1) Dr Kas/Bank; Cr 4-1000 Penjualan Keset. (2) Dr 5-1000 HPP Keset; Cr 1-1520 Persediaan Barang Jadi (qty x biaya) |
| B2 | Jual keset **kredit** | `sales` | (1) Dr 1-1300 Piutang Usaha (mitra); Cr 4-1000. (2) HPP seperti B1 |
| B3 | Jual **bahan baku** tunai | `sales` | (1) Dr Kas/Bank; Cr 4-2000 Penjualan Bahan Baku. (2) Dr 5-2000 HPP Bahan Baku; Cr 1-1500 Persediaan Bahan Baku |
| B4 | Jual bahan baku kredit | `sales` | (1) Dr 1-1300; Cr 4-2000. (2) HPP seperti B3 |
| B5 | Diskon pada faktur | `sales.discount` | Dr 4-4000 Diskon Penjualan (atau langsung netto pada pendapatan, pilih satu kebijakan) |
| B6 | Terima pembayaran piutang | `payments` (IN) | Dr Kas/Bank; Cr 1-1300 Piutang Usaha (mitra) |
| B7 | Retur penjualan keset | `sale_returns` | (1) Dr 4-3000 Retur Penjualan; Cr Kas atau 1-1300. (2) Dr 1-1520 Persediaan Barang Jadi; Cr 5-1000 HPP Keset (sebesar HPP asli di `sale_lines.unit_cost`) |

Satu faktur dapat memuat keset dan bahan baku sekaligus; sistem memecah jurnal per jenis barang (`items.type`).

### C. Kompensasi dengan mitra

| # | Kejadian | Tabel sumber | Jurnal |
|---|---|---|---|
| C1 | Netting piutang (jual bahan ke mitra) vs utang (beli dari mitra) | `partner_nettings` | Dr 2-1100 Utang Usaha (mitra); Cr 1-1300 Piutang Usaha (mitra) sebesar nilai kompensasi |

Tidak ada kas bergerak; `paid_amount` pada faktur penjualan dan pembelian terkait diperbarui via `partner_netting_lines`.

### D. Produksi borongan

| # | Kejadian | Tabel sumber | Jurnal |
|---|---|---|---|
| D1 | Serah bahan ke pekerja | `work_ticket_issues` | Dr 1-1510 Bahan di Pekerja; Cr 1-1500 Persediaan Bahan Baku (qty x biaya gudang) |
| D2 | Setor hasil jadi lolos QC | `work_receipts` | Dr 1-1520 Persediaan Barang Jadi (material_cost + wage_amount); Cr 1-1510 Bahan di Pekerja (material_cost); Cr 2-1200 Utang Upah Borongan (wage_amount) |
| D3 | Kembalikan sisa bahan | `work_ticket_returns` | Dr 1-1500 Persediaan Bahan Baku; Cr 1-1510 Bahan di Pekerja |
| D4 | Tutup tiket, selisih **di bawah toleransi** | `material_variances` | Tidak ada jurnal terpisah. Susut wajar dikapitalisasi ke HPP (lihat catatan 3.2) |
| D5 | Tutup tiket, selisih **di atas toleransi**, setelah disetujui | `material_variances` | Dr 5-4000 Beban Selisih Bahan; Cr 1-1510 Bahan di Pekerja (excess_qty x biaya) |
| D6 | Reject tak bisa diperbaiki | `work_receipts.qty_reject` | Tidak ada jurnal khusus. Bahan reject termasuk "terpakai" (standar BOM), sehingga ikut susut wajar atau selisih (D4/D5) |

### E. Upah dan kasbon

| # | Kejadian | Tabel sumber | Jurnal |
|---|---|---|---|
| E1 | Beri kasbon | `worker_advances` | Dr 1-1400 Piutang Karyawan (pekerja); Cr Kas/Bank |
| E2 | Bayar slip upah (netto) | `wage_slips` | Dr 2-1200 Utang Upah Borongan (gross); Cr Kas/Bank (net_paid); Cr 1-1400 Piutang Karyawan (potongan kasbon) |

### F. Kas, beban, ekuitas, dan penyesuaian

| # | Kejadian | Tabel sumber | Jurnal |
|---|---|---|---|
| F1 | Bayar beban operasional | `cash_transactions` (OUT) | Dr 6-xxxx Beban terkait; Cr Kas/Bank |
| F2 | Setor modal | `cash_transactions` (IN) | Dr Kas/Bank; Cr 3-1000 Modal |
| F3 | Prive | `cash_transactions` (OUT) | Dr 3-2000 Prive; Cr Kas/Bank |
| F4 | Opname, stok **kurang** | `stock_opnames` | Dr 5-5000 Selisih Persediaan; Cr akun persediaan sesuai lokasi |
| F5 | Opname, stok **lebih** | `stock_opnames` | Dr akun persediaan sesuai lokasi; Cr 5-5000 Selisih Persediaan |
| F6 | PPh final 0,5% omzet (opsional) | akhir bulan | Dr 6-2000 Beban Pajak Final; Cr 2-1300 Utang Pajak |
| F7 | **Pembatalan transaksi** | semua dokumen | Buat jurnal balik (Dr/Cr ditukar), `journals.reversal_of` menunjuk jurnal asal, status dokumen menjadi `VOID`. Stok dikembalikan dengan movement berlawanan |

## 3. Aturan penting

### 3.1 Perhitungan biaya
- **Biaya rata-rata bahan** dihitung saat pembelian (per lokasi RAW_WH).
- Saat bahan diserahkan ke pekerja (D1), biaya terbawa ke lokasi WORKER. Jika pekerja menerima bahan yang sama dari dua penyerahan berbeda harga, biaya rata-rata di lokasi WORKER dihitung ulang.
- **Biaya barang jadi per unit** = (biaya bahan standar + upah borongan) / unit lolos QC.
  - Biaya bahan standar = `qty_pass x qty_per_unit (BOM) x biaya rata-rata WORKER`.
- HPP saat jual = `qty x avg_cost` barang jadi di FG_WH.

### 3.2 Susut wajar vs selisih
Saat tiket ditutup, per bahan dihitung:

```
standar     = qty BOM x (unit lolos + reject)
selisih     = diserahkan - dikembalikan - standar
toleransi   = standar x shrink_tolerance_pct
excess      = max(0, selisih - toleransi)
```

- **Bagian di bawah toleransi** tetap berada di WIP saat tiket ditutup. Sistem mengalokasikannya ke barang jadi (menambah biaya bahan pada D2) agar saldo WIP pekerja menjadi nol dan HPP mencerminkan biaya produksi normal.
- **`excess`** menjadi `material_variances` berstatus `PENDING`. Setelah disetujui pemilik atau admin gudang, jurnal D5 dibuat.
- Jika `selisih` negatif (pakai lebih sedikit dari standar), tampilkan sebagai peringatan untuk dicek (ukuran BOM mungkin terlalu besar).

### 3.3 Kontrol
- Jurnal harus seimbang (dijaga trigger `trg_journal_balanced`) dan tidak bisa ditulis ke periode yang sudah ditutup.
- Jurnal dan dokumen yang sudah diposting tidak dihapus; hanya dibatalkan (F7).
- Stok tidak boleh minus kecuali diaktifkan khusus oleh pemilik.
- Setiap persetujuan selisih dan pembatalan dicatat di `audit_log`.

## 4. Pemetaan laporan keuangan (SAK EMKM)

| Laporan | Sumber |
|---|---|
| **Laba Rugi** | Pendapatan (4-xxxx) dikurangi retur dan diskon, dikurangi HPP Keset dan HPP Bahan Baku (5-1000, 5-2000), laba kotor **per lini usaha**; dikurangi Beban Selisih Bahan dan Beban Operasional (5-4000, 5-5000, 6-xxxx) |
| **Laporan Posisi Keuangan** | Aset (kas, bank, piutang, tiga jenis persediaan), liabilitas (utang usaha, utang upah), ekuitas (modal, prive, laba ditahan, laba periode berjalan) |
| **Laporan Arus Kas** | Dari mutasi akun Kas/Bank, diklasifikasi operasi/investasi/pendanaan lewat `cash_transactions.counter_account_id` dan jenis dokumen |
| **Laporan Perubahan Ekuitas** | Modal awal, setor modal, prive, laba/rugi periode |
| **Laporan HPP** | Persediaan awal + pembelian bahan + upah borongan, dikurangi persediaan akhir |
| **Laporan pendukung** | Umur piutang/utang, nilai persediaan per lokasi, saldo bahan per pekerja (`v_worker_material_balance`), tiket terlambat (`v_overdue_tickets`), selisih per pekerja, saldo bersih mitra (`v_partner_net_balance`) |

## 5. Hak akses yang disarankan

| Fitur | Pemilik | Admin Gudang | Kasir | Keuangan |
|---|---|---|---|---|
| Master data | Ya | Bahan/stok | Lihat | Lihat |
| Pembelian bahan | Ya | Ya | Tidak | Lihat |
| Serah/setor/QC borongan | Ya | Ya | Tidak | Lihat |
| Persetujuan selisih | **Ya** | Ya | Tidak | Tidak |
| Penjualan | Ya | Tidak | Ya | Lihat |
| Kas, upah, kasbon | Ya | Tidak | Tidak | Ya |
| Laporan laba rugi dan neraca | **Ya** | Tidak | Tidak | Ya |
| Batalkan transaksi / tutup periode | **Ya** | Tidak | Tidak | Tidak |
