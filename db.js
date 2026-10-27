// db.js - Inisialisasi Database SQLite menggunakan node:sqlite bawaan Node.js
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

let DB_PATH = path.join(__dirname, 'keset.db');

// Dukungan Serverless Vercel (karena root folder bersifat read-only)
if (process.env.VERCEL) {
  const tmpPath = path.join('/tmp', 'keset.db');
  if (!fs.existsSync(tmpPath) && fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, tmpPath);
  }
  DB_PATH = tmpPath;
}

const db = new DatabaseSync(DB_PATH);

// Aktifkan foreign key enforcement
db.exec('PRAGMA foreign_keys = ON;');

function initDatabase() {
  db.exec(`
    -- Master Satuan
    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL
    );

    -- Pengguna
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('OWNER','WAREHOUSE_ADMIN','CASHIER','FINANCE')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Master Barang & Bahan Baku
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('RAW_MATERIAL', 'FINISHED_GOOD')),
      unit_id INTEGER NOT NULL REFERENCES units(id),
      can_be_produced_with INTEGER NOT NULL DEFAULT 0,
      can_be_sold INTEGER NOT NULL DEFAULT 0,
      size_label TEXT,
      color TEXT,
      min_stock REAL NOT NULL DEFAULT 0,
      shrink_tolerance_pct REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Tingkat Harga Jual
    CREATE TABLE IF NOT EXISTS price_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS item_prices (
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      price_tier_id INTEGER NOT NULL REFERENCES price_tiers(id),
      price REAL NOT NULL CHECK(price >= 0),
      PRIMARY KEY (item_id, price_tier_id)
    );

    -- Mitra Usaha (Pemasok / Pelanggan)
    CREATE TABLE IF NOT EXISTS partners (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      is_supplier INTEGER NOT NULL DEFAULT 0,
      is_customer INTEGER NOT NULL DEFAULT 0,
      price_tier_id INTEGER REFERENCES price_tiers(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Pekerja Borongan
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Resep / BOM (Bill of Materials)
    CREATE TABLE IF NOT EXISTS boms (
      id TEXT PRIMARY KEY,
      finished_item_id TEXT NOT NULL REFERENCES items(id),
      version INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      UNIQUE (finished_item_id, version)
    );

    CREATE TABLE IF NOT EXISTS bom_lines (
      id TEXT PRIMARY KEY,
      bom_id TEXT NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
      material_id TEXT NOT NULL REFERENCES items(id),
      qty_per_unit REAL NOT NULL CHECK(qty_per_unit > 0),
      UNIQUE (bom_id, material_id)
    );

    -- Tarif Borongan
    CREATE TABLE IF NOT EXISTS piece_rates (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id),
      worker_id TEXT REFERENCES workers(id),
      rate_pass REAL NOT NULL CHECK(rate_pass >= 0),
      rate_rework REAL NOT NULL DEFAULT 0,
      valid_from TEXT NOT NULL DEFAULT (date('now'))
    );

    -- Akuntansi: Bagan Akun (Chart of Accounts)
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('ASSET','LIABILITY','EQUITY','REVENUE','COGS','EXPENSE')),
      parent_id INTEGER REFERENCES accounts(id),
      is_postable INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS cash_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS accounting_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      is_closed INTEGER NOT NULL DEFAULT 0,
      closed_by TEXT REFERENCES users(id),
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS journals (
      id TEXT PRIMARY KEY,
      journal_no TEXT UNIQUE NOT NULL,
      journal_date TEXT NOT NULL,
      description TEXT,
      source_table TEXT,
      source_id TEXT,
      status TEXT NOT NULL DEFAULT 'POSTED',
      reversal_of TEXT REFERENCES journals(id),
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS journal_lines (
      id TEXT PRIMARY KEY,
      journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      debit REAL NOT NULL DEFAULT 0 CHECK(debit >= 0),
      credit REAL NOT NULL DEFAULT 0 CHECK(credit >= 0),
      partner_id TEXT REFERENCES partners(id),
      worker_id TEXT REFERENCES workers(id),
      memo TEXT
    );

    -- Stok: Saldo Berjalan (RAW_WH, WORKER, FG_WH)
    CREATE TABLE IF NOT EXISTS stock_balances (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id),
      location TEXT NOT NULL CHECK(location IN ('RAW_WH', 'WORKER', 'FG_WH')),
      worker_id TEXT REFERENCES workers(id),
      qty REAL NOT NULL DEFAULT 0,
      avg_cost REAL NOT NULL DEFAULT 0
    );

    -- Mutasi Stok (Kartu Stok)
    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      movement_date TEXT NOT NULL,
      item_id TEXT NOT NULL REFERENCES items(id),
      location TEXT NOT NULL CHECK(location IN ('RAW_WH', 'WORKER', 'FG_WH')),
      worker_id TEXT REFERENCES workers(id),
      qty_in REAL NOT NULL DEFAULT 0 CHECK(qty_in >= 0),
      qty_out REAL NOT NULL DEFAULT 0 CHECK(qty_out >= 0),
      unit_cost REAL NOT NULL DEFAULT 0,
      movement_type TEXT NOT NULL,
      source_table TEXT NOT NULL,
      source_id TEXT NOT NULL,
      note TEXT,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Pembelian Bahan Baku
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      purchase_no TEXT UNIQUE NOT NULL,
      purchase_date TEXT NOT NULL,
      partner_id TEXT NOT NULL REFERENCES partners(id),
      total REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK(payment_status IN ('UNPAID','PARTIAL','PAID')),
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'POSTED',
      journal_id TEXT REFERENCES journals(id),
      note TEXT,
      created_by TEXT REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_lines (
      id TEXT PRIMARY KEY,
      purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES items(id),
      qty REAL NOT NULL CHECK(qty > 0),
      unit_price REAL NOT NULL CHECK(unit_price >= 0),
      line_total REAL NOT NULL
    );

    -- Penjualan (Keset & Bahan Baku)
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      sale_no TEXT UNIQUE NOT NULL,
      sale_date TEXT NOT NULL,
      partner_id TEXT REFERENCES partners(id),
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK(payment_status IN ('UNPAID','PARTIAL','PAID')),
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'POSTED',
      journal_id TEXT REFERENCES journals(id),
      note TEXT,
      created_by TEXT REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sale_lines (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES items(id),
      qty REAL NOT NULL CHECK(qty > 0),
      unit_price REAL NOT NULL CHECK(unit_price >= 0),
      line_total REAL NOT NULL,
      unit_cost REAL NOT NULL DEFAULT 0
    );

    -- Pembayaran Faktur (IN & OUT)
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      payment_no TEXT UNIQUE NOT NULL,
      payment_date TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
      partner_id TEXT NOT NULL REFERENCES partners(id),
      cash_account_id INTEGER NOT NULL REFERENCES cash_accounts(id),
      amount REAL NOT NULL CHECK(amount > 0),
      sale_id TEXT REFERENCES sales(id),
      purchase_id TEXT REFERENCES purchases(id),
      status TEXT NOT NULL DEFAULT 'POSTED',
      journal_id TEXT REFERENCES journals(id)
    );

    -- Kompensasi (Netting) Piutang vs Utang Mitra
    CREATE TABLE IF NOT EXISTS partner_nettings (
      id TEXT PRIMARY KEY,
      netting_no TEXT UNIQUE NOT NULL,
      netting_date TEXT NOT NULL,
      partner_id TEXT NOT NULL REFERENCES partners(id),
      amount REAL NOT NULL CHECK(amount > 0),
      status TEXT NOT NULL DEFAULT 'POSTED',
      journal_id TEXT REFERENCES journals(id)
    );

    CREATE TABLE IF NOT EXISTS partner_netting_lines (
      id TEXT PRIMARY KEY,
      netting_id TEXT NOT NULL REFERENCES partner_nettings(id) ON DELETE CASCADE,
      sale_id TEXT REFERENCES sales(id),
      purchase_id TEXT REFERENCES purchases(id),
      amount REAL NOT NULL CHECK(amount > 0)
    );

    -- Transaksi Kas/Bank (Operasional, Prive, Modal)
    CREATE TABLE IF NOT EXISTS cash_transactions (
      id TEXT PRIMARY KEY,
      trx_no TEXT UNIQUE NOT NULL,
      trx_date TEXT NOT NULL,
      cash_account_id INTEGER NOT NULL REFERENCES cash_accounts(id),
      direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
      counter_account_id INTEGER NOT NULL REFERENCES accounts(id),
      amount REAL NOT NULL CHECK(amount > 0),
      description TEXT,
      status TEXT NOT NULL DEFAULT 'POSTED',
      journal_id TEXT REFERENCES journals(id)
    );

    -- Kasbon Pekerja
    CREATE TABLE IF NOT EXISTS worker_advances (
      id TEXT PRIMARY KEY,
      advance_no TEXT UNIQUE NOT NULL,
      advance_date TEXT NOT NULL,
      worker_id TEXT NOT NULL REFERENCES workers(id),
      cash_account_id INTEGER NOT NULL REFERENCES cash_accounts(id),
      amount REAL NOT NULL CHECK(amount > 0),
      status TEXT NOT NULL DEFAULT 'POSTED',
      journal_id TEXT REFERENCES journals(id)
    );

    -- Produksi Borongan: Tiket Kerja (SPK)
    CREATE TABLE IF NOT EXISTS work_tickets (
      id TEXT PRIMARY KEY,
      ticket_no TEXT UNIQUE NOT NULL,
      worker_id TEXT NOT NULL REFERENCES workers(id),
      target_item_id TEXT NOT NULL REFERENCES items(id),
      target_qty REAL NOT NULL CHECK(target_qty > 0),
      issue_date TEXT NOT NULL,
      due_date TEXT,
      bom_id TEXT REFERENCES boms(id),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED','VOID')),
      closed_at TEXT,
      note TEXT,
      created_by TEXT REFERENCES users(id)
    );

    -- Penyerahan Bahan ke Pekerja
    CREATE TABLE IF NOT EXISTS work_ticket_issues (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES work_tickets(id),
      issue_date TEXT NOT NULL,
      material_id TEXT NOT NULL REFERENCES items(id),
      qty REAL NOT NULL CHECK(qty > 0),
      unit_cost REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'POSTED',
      journal_id TEXT REFERENCES journals(id)
    );

    -- Setoran Hasil Jadi & QC
    CREATE TABLE IF NOT EXISTS work_receipts (
      id TEXT PRIMARY KEY,
      receipt_no TEXT UNIQUE NOT NULL,
      ticket_id TEXT NOT NULL REFERENCES work_tickets(id),
      receipt_date TEXT NOT NULL,
      qty_pass REAL NOT NULL DEFAULT 0,
      qty_rework REAL NOT NULL DEFAULT 0,
      qty_reject REAL NOT NULL DEFAULT 0,
      rate_pass REAL NOT NULL,
      rate_rework REAL NOT NULL DEFAULT 0,
      wage_amount REAL NOT NULL,
      material_cost REAL NOT NULL,
      fg_unit_cost REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'POSTED',
      journal_id TEXT REFERENCES journals(id),
      qc_by TEXT REFERENCES users(id)
    );

    -- Pengembalian Sisa Bahan dari Pekerja
    CREATE TABLE IF NOT EXISTS work_ticket_returns (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES work_tickets(id),
      return_date TEXT NOT NULL,
      material_id TEXT NOT NULL REFERENCES items(id),
      qty REAL NOT NULL CHECK(qty > 0),
      unit_cost REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'POSTED',
      journal_id TEXT REFERENCES journals(id)
    );

    -- Selisih Bahan (Variances)
    CREATE TABLE IF NOT EXISTS material_variances (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES work_tickets(id),
      material_id TEXT NOT NULL REFERENCES items(id),
      issued_qty REAL NOT NULL,
      returned_qty REAL NOT NULL,
      standard_qty REAL NOT NULL,
      tolerance_qty REAL NOT NULL,
      variance_qty REAL NOT NULL,
      excess_qty REAL NOT NULL,
      unit_cost REAL NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
      approved_by TEXT REFERENCES users(id),
      approved_at TEXT,
      journal_id TEXT REFERENCES journals(id),
      note TEXT
    );

    -- Slip Upah Borongan
    CREATE TABLE IF NOT EXISTS wage_slips (
      id TEXT PRIMARY KEY,
      slip_no TEXT UNIQUE NOT NULL,
      worker_id TEXT NOT NULL REFERENCES workers(id),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      gross_wage REAL NOT NULL,
      advance_deduct REAL NOT NULL DEFAULT 0,
      net_paid REAL NOT NULL,
      cash_account_id INTEGER REFERENCES cash_accounts(id),
      paid_date TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      journal_id TEXT REFERENCES journals(id)
    );

    CREATE TABLE IF NOT EXISTS wage_slip_receipts (
      slip_id TEXT NOT NULL REFERENCES wage_slips(id) ON DELETE CASCADE,
      receipt_id TEXT NOT NULL REFERENCES work_receipts(id),
      PRIMARY KEY (slip_id, receipt_id),
      UNIQUE (receipt_id)
    );
  `);
}

// Seeding Data Awal (Chart of Accounts sesuai dokumen 02_akun_dan_jurnal_otomatis.md dan Master Sampel)
function seedInitialData() {
  const countAcc = db.prepare('SELECT COUNT(*) as count FROM accounts').get().count;
  if (countAcc > 0) return; // Sudah terisi

  console.log('Menyemai data awal (COA SAK EMKM dan Master Data sampel)...');

  // 1. Chart of Accounts (COA)
  const coa = [
    // 1. ASET
    { code: '1-1000', name: 'ASET LANCAR', type: 'ASSET', postable: 0 },
    { code: '1-1100', name: 'Kas', type: 'ASSET', postable: 1 },
    { code: '1-1200', name: 'Bank BCA', type: 'ASSET', postable: 1 },
    { code: '1-1201', name: 'Bank BRI', type: 'ASSET', postable: 1 },
    { code: '1-1300', name: 'Piutang Usaha', type: 'ASSET', postable: 1 },
    { code: '1-1400', name: 'Piutang Karyawan (Kasbon)', type: 'ASSET', postable: 1 },
    { code: '1-1500', name: 'Persediaan Bahan Baku', type: 'ASSET', postable: 1 },
    { code: '1-1510', name: 'Persediaan Bahan di Pekerja (WIP)', type: 'ASSET', postable: 1 },
    { code: '1-1520', name: 'Persediaan Barang Jadi', type: 'ASSET', postable: 1 },
    { code: '1-1900', name: 'Uang Muka / Biaya Dibayar Dimuka', type: 'ASSET', postable: 1 },
    { code: '1-2000', name: 'Peralatan Usaha', type: 'ASSET', postable: 1 },
    { code: '1-2900', name: 'Akumulasi Penyusutan Peralatan', type: 'ASSET', postable: 1 },

    // 2. LIABILITAS
    { code: '2-1000', name: 'LIABILITAS JANGKA PENDEK', type: 'LIABILITY', postable: 0 },
    { code: '2-1100', name: 'Utang Usaha', type: 'LIABILITY', postable: 1 },
    { code: '2-1200', name: 'Utang Upah Borongan', type: 'LIABILITY', postable: 1 },
    { code: '2-1300', name: 'Utang Pajak (PPh Final)', type: 'LIABILITY', postable: 1 },

    // 3. EKUITAS
    { code: '3-0000', name: 'EKUITAS', type: 'EQUITY', postable: 0 },
    { code: '3-1000', name: 'Modal Pemilik', type: 'EQUITY', postable: 1 },
    { code: '3-2000', name: 'Prive', type: 'EQUITY', postable: 1 },
    { code: '3-3000', name: 'Laba Ditahan', type: 'EQUITY', postable: 1 },

    // 4. PENDAPATAN
    { code: '4-0000', name: 'PENDAPATAN', type: 'REVENUE', postable: 0 },
    { code: '4-1000', name: 'Penjualan Keset', type: 'REVENUE', postable: 1 },
    { code: '4-2000', name: 'Penjualan Bahan Baku', type: 'REVENUE', postable: 1 },
    { code: '4-3000', name: 'Retur Penjualan', type: 'REVENUE', postable: 1 },
    { code: '4-4000', name: 'Diskon Penjualan', type: 'REVENUE', postable: 1 },
    { code: '4-9000', name: 'Pendapatan Lain-lain', type: 'REVENUE', postable: 1 },

    // 5. BEBAN PRODUKSI & HPP
    { code: '5-0000', name: 'HARGA POKOK PENJUALAN', type: 'COGS', postable: 0 },
    { code: '5-1000', name: 'HPP Keset', type: 'COGS', postable: 1 },
    { code: '5-2000', name: 'HPP Bahan Baku', type: 'COGS', postable: 1 },
    { code: '5-3000', name: 'Upah Borongan', type: 'COGS', postable: 1 },
    { code: '5-4000', name: 'Beban Selisih Bahan', type: 'COGS', postable: 1 },
    { code: '5-5000', name: 'Selisih Persediaan (Opname)', type: 'COGS', postable: 1 },

    // 6. BEBAN OPERASIONAL
    { code: '6-0000', name: 'BEBAN OPERASIONAL', type: 'EXPENSE', postable: 0 },
    { code: '6-1000', name: 'Beban Transportasi & Angkut', type: 'EXPENSE', postable: 1 },
    { code: '6-1100', name: 'Beban Listrik dan Air', type: 'EXPENSE', postable: 1 },
    { code: '6-1200', name: 'Beban Sewa Gudang', type: 'EXPENSE', postable: 1 },
    { code: '6-1300', name: 'Beban Administrasi dan Umum', type: 'EXPENSE', postable: 1 },
    { code: '6-1400', name: 'Beban Penyusutan Peralatan', type: 'EXPENSE', postable: 1 },
    { code: '6-1500', name: 'Beban Lain-lain', type: 'EXPENSE', postable: 1 },
    { code: '6-2000', name: 'Beban Pajak Penghasilan Final', type: 'EXPENSE', postable: 1 }
  ];

  const insertAcc = db.prepare(`
    INSERT INTO accounts (code, name, type, is_postable)
    VALUES (?, ?, ?, ?)
  `);
  for (const a of coa) {
    insertAcc.run(a.code, a.name, a.type, a.postable);
  }

  // 2. Rekening Kas & Bank
  const accKas = db.prepare("SELECT id FROM accounts WHERE code = '1-1100'").get().id;
  const accBca = db.prepare("SELECT id FROM accounts WHERE code = '1-1200'").get().id;
  const accBri = db.prepare("SELECT id FROM accounts WHERE code = '1-1201'").get().id;

  db.prepare("INSERT INTO cash_accounts (name, account_id) VALUES (?, ?)").run('Kas Tunai Utama', accKas);
  db.prepare("INSERT INTO cash_accounts (name, account_id) VALUES (?, ?)").run('Bank BCA Operasional', accBca);
  db.prepare("INSERT INTO cash_accounts (name, account_id) VALUES (?, ?)").run('Bank BRI Cadangan', accBri);

  // 3. Satuan
  const units = [
    { code: 'pcs', name: 'Pcs / Lembar' },
    { code: 'kg', name: 'Kilogram' },
    { code: 'roll', name: 'Roll' },
    { code: 'meter', name: 'Meter' }
  ];
  for (const u of units) {
    db.prepare("INSERT INTO units (code, name) VALUES (?, ?)").run(u.code, u.name);
  }

  const uPcs = db.prepare("SELECT id FROM units WHERE code = 'pcs'").get().id;
  const uKg = db.prepare("SELECT id FROM units WHERE code = 'kg'").get().id;
  const uMeter = db.prepare("SELECT id FROM units WHERE code = 'meter'").get().id;

  // 4. Price Tiers
  db.prepare("INSERT INTO price_tiers (name) VALUES (?)").run('Eceran / Toko');
  db.prepare("INSERT INTO price_tiers (name) VALUES (?)").run('Grosir / Reseller');
  db.prepare("INSERT INTO price_tiers (name) VALUES (?)").run('Distributor');

  // 5. Default User
  const ownerId = 'usr-owner-001';
  db.prepare(`
    INSERT INTO users (id, name, email, role)
    VALUES (?, ?, ?, ?)
  `).run(ownerId, 'H. Abdullah (Pemilik)', 'owner@kesetjaya.com', 'OWNER');

  db.prepare(`
    INSERT INTO users (id, name, email, role)
    VALUES (?, ?, ?, ?)
  `).run('usr-admin-002', 'Budi Santoso (Admin Gudang)', 'gudang@kesetjaya.com', 'WAREHOUSE_ADMIN');

  // 6. Master Bahan Baku & Barang Jadi Keset
  const items = [
    // Bahan Baku
    {
      id: 'item-raw-001',
      sku: 'BB-PERCA-KATUN',
      name: 'Kain Perca Katun Aneka Warna',
      type: 'RAW_MATERIAL',
      unit_id: uKg,
      can_be_produced_with: 1,
      can_be_sold: 1,
      min_stock: 50,
      shrink_tolerance_pct: 5.0
    },
    {
      id: 'item-raw-002',
      sku: 'BB-BENANG-NILON',
      name: 'Benang Nilon Rajut Tebal',
      type: 'RAW_MATERIAL',
      unit_id: uMeter,
      can_be_produced_with: 1,
      can_be_sold: 0,
      min_stock: 100,
      shrink_tolerance_pct: 2.0
    },
    {
      id: 'item-raw-003',
      sku: 'BB-ALAS-ANTISLIP',
      name: 'Kain Kanvas Alas Anti Selip',
      type: 'RAW_MATERIAL',
      unit_id: uMeter,
      can_be_produced_with: 1,
      can_be_sold: 0,
      min_stock: 30,
      shrink_tolerance_pct: 3.0
    },

    // Barang Jadi Keset
    {
      id: 'item-fg-001',
      sku: 'KST-CENDOL-4060',
      name: 'Keset Kaki Microfiber Cendol 40x60',
      type: 'FINISHED_GOOD',
      unit_id: uPcs,
      size_label: '40x60 cm',
      color: 'Warna-warni',
      min_stock: 20
    },
    {
      id: 'item-fg-002',
      sku: 'KST-ANYAM-4570',
      name: 'Keset Anyam Tenun Perca Super 45x70',
      type: 'FINISHED_GOOD',
      unit_id: uPcs,
      size_label: '45x70 cm',
      color: 'Kombinasi Gelap',
      min_stock: 15
    }
  ];

  for (const it of items) {
    db.prepare(`
      INSERT INTO items (id, sku, name, type, unit_id, can_be_produced_with, can_be_sold, size_label, color, min_stock, shrink_tolerance_pct)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      it.id,
      it.sku,
      it.name,
      it.type,
      it.unit_id,
      it.can_be_produced_with || 0,
      it.can_be_sold || 0,
      it.size_label || null,
      it.color || null,
      it.min_stock || 0,
      it.shrink_tolerance_pct || 0
    );
  }

  // Harga Jual Barang Jadi
  const tierEceran = 1;
  const tierGrosir = 2;
  const tierDistributor = 3;

  // KST-CENDOL-4060
  db.prepare("INSERT INTO item_prices VALUES (?, ?, ?)").run('item-fg-001', tierEceran, 25000);
  db.prepare("INSERT INTO item_prices VALUES (?, ?, ?)").run('item-fg-001', tierGrosir, 20000);
  db.prepare("INSERT INTO item_prices VALUES (?, ?, ?)").run('item-fg-001', tierDistributor, 17500);

  // KST-ANYAM-4570
  db.prepare("INSERT INTO item_prices VALUES (?, ?, ?)").run('item-fg-002', tierEceran, 30000);
  db.prepare("INSERT INTO item_prices VALUES (?, ?, ?)").run('item-fg-002', tierGrosir, 24000);
  db.prepare("INSERT INTO item_prices VALUES (?, ?, ?)").run('item-fg-002', tierDistributor, 21000);

  // Harga Jual Bahan Baku (Bila dijual ke mitra)
  db.prepare("INSERT INTO item_prices VALUES (?, ?, ?)").run('item-raw-001', tierEceran, 12000);
  db.prepare("INSERT INTO item_prices VALUES (?, ?, ?)").run('item-raw-001', tierGrosir, 10000);

  // 7. Mitra (Supplier & Customer)
  const partners = [
    {
      id: 'part-001',
      name: 'CV Berkah Tekstil Maju',
      phone: '0812-3456-7890',
      address: 'Sentra Kain Majalaya Bandung',
      is_supplier: 1,
      is_customer: 0
    },
    {
      id: 'part-002',
      name: 'Toko Perlengkapan Rumah Indah',
      phone: '0819-8765-4321',
      address: 'Pasar Baru Jakarta',
      is_supplier: 0,
      is_customer: 1,
      price_tier_id: tierGrosir
    },
    {
      id: 'part-003',
      name: 'UD Mitra Kerajinan Mandiri (Vendor & Pembeli)',
      phone: '0857-1122-3344',
      address: 'Kawasan Industri Rumahan Sukoharjo',
      is_supplier: 1,
      is_customer: 1,
      price_tier_id: tierDistributor
    }
  ];
  for (const p of partners) {
    db.prepare(`
      INSERT INTO partners (id, name, phone, address, is_supplier, is_customer, price_tier_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(p.id, p.name, p.phone, p.address, p.is_supplier, p.is_customer, p.price_tier_id || null);
  }

  // 8. Pekerja Borongan
  const workers = [
    { id: 'wrk-001', name: 'Pak Suratman (Penganyam)', phone: '0878-1234-0001', address: 'Dusun Jetis RT 02/03' },
    { id: 'wrk-002', name: 'Ibu Warsiti (Penjahit Tepi)', phone: '0878-1234-0002', address: 'Dusun Krajan RT 01/01' },
    { id: 'wrk-003', name: 'Pak Marjuki (Spesialis Cendol)', phone: '0878-1234-0003', address: 'Dusun Kauman RT 04/02' }
  ];
  for (const w of workers) {
    db.prepare(`
      INSERT INTO workers (id, name, phone, address)
      VALUES (?, ?, ?, ?)
    `).run(w.id, w.name, w.phone, w.address);
  }

  // 9. BOM (Resep Kebutuhan Bahan Per 1 Pcs Keset)
  // Resep untuk KST-CENDOL-4060: 0.4 kg Perca, 15 m Benang, 0.6 m Alas Antiselip
  const bomCendolId = 'bom-cendol-01';
  db.prepare(`
    INSERT INTO boms (id, finished_item_id, version, is_active)
    VALUES (?, ?, ?, ?)
  `).run(bomCendolId, 'item-fg-001', 1, 1);

  db.prepare("INSERT INTO bom_lines VALUES (?, ?, ?, ?)").run('bom-line-01', bomCendolId, 'item-raw-001', 0.40);
  db.prepare("INSERT INTO bom_lines VALUES (?, ?, ?, ?)").run('bom-line-02', bomCendolId, 'item-raw-002', 15.0);
  db.prepare("INSERT INTO bom_lines VALUES (?, ?, ?, ?)").run('bom-line-03', bomCendolId, 'item-raw-003', 0.60);

  // Resep untuk KST-ANYAM-4570: 0.6 kg Perca, 20 m Benang
  const bomAnyamId = 'bom-anyam-01';
  db.prepare(`
    INSERT INTO boms (id, finished_item_id, version, is_active)
    VALUES (?, ?, ?, ?)
  `).run(bomAnyamId, 'item-fg-002', 1, 1);

  db.prepare("INSERT INTO bom_lines VALUES (?, ?, ?, ?)").run('bom-line-04', bomAnyamId, 'item-raw-001', 0.60);
  db.prepare("INSERT INTO bom_lines VALUES (?, ?, ?, ?)").run('bom-line-05', bomAnyamId, 'item-raw-002', 20.0);

  // 10. Tarif Borongan
  // Keset Cendol: Rp 4.500 / pcs lolos QC, Rp 1.000 rework
  db.prepare(`
    INSERT INTO piece_rates (id, item_id, worker_id, rate_pass, rate_rework)
    VALUES (?, ?, NULL, ?, ?)
  `).run('rate-001', 'item-fg-001', 4500, 1000);

  // Keset Anyam: Rp 5.500 / pcs lolos QC, Rp 1.200 rework
  db.prepare(`
    INSERT INTO piece_rates (id, item_id, worker_id, rate_pass, rate_rework)
    VALUES (?, ?, NULL, ?, ?)
  `).run('rate-002', 'item-fg-002', 5500, 1200);

  // 11. Modal Awal & Stok Awal
  // Setor Modal Awal Rp 25.000.000 (Kas: Rp 10.000.000, Bank BCA: Rp 15.000.000)
  const jModalId = 'jnl-init-modal';
  db.prepare(`
    INSERT INTO journals (id, journal_no, journal_date, description, status)
    VALUES (?, ?, date('now'), ?, 'POSTED')
  `).run(jModalId, 'JRN-MODAL-001', 'Setoran Modal Pemilik Usaha Keset Awal');

  // Dr Kas 10jt, Dr Bank BCA 15jt, Cr Modal 25jt
  const accModal = db.prepare("SELECT id FROM accounts WHERE code = '3-1000'").get().id;
  db.prepare("INSERT INTO journal_lines (id, journal_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?, ?)")
    .run('jl-mod-1', jModalId, accKas, 10000000, 0, 'Setor kas tunai');
  db.prepare("INSERT INTO journal_lines (id, journal_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?, ?)")
    .run('jl-mod-2', jModalId, accBca, 15000000, 0, 'Setor rekening BCA');
  db.prepare("INSERT INTO journal_lines (id, journal_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?, ?)")
    .run('jl-mod-3', jModalId, accModal, 0, 25000000, 'Modal Awal Usaha');

  // Stok Awal Bahan Baku di RAW_WH
  // Kain Perca: 150 kg @ Rp 7.500 = Rp 1.125.000
  // Benang Nilon: 2000 meter @ Rp 250 = Rp 500.000
  // Kain Antiselip: 100 meter @ Rp 4.000 = Rp 400.000
  // Total Stok = Rp 2.025.000
  const stockInitial = [
    { item_id: 'item-raw-001', qty: 150, cost: 7500 },
    { item_id: 'item-raw-002', qty: 2000, cost: 250 },
    { item_id: 'item-raw-003', qty: 100, cost: 4000 }
  ];

  for (const st of stockInitial) {
    db.prepare(`
      INSERT INTO stock_balances (id, item_id, location, worker_id, qty, avg_cost)
      VALUES (?, ?, 'RAW_WH', NULL, ?, ?)
    `).run('sb-' + st.item_id, st.item_id, st.qty, st.cost);

    db.prepare(`
      INSERT INTO stock_movements (id, movement_date, item_id, location, qty_in, qty_out, unit_cost, movement_type, source_table, source_id, note)
      VALUES (?, date('now'), ?, 'RAW_WH', ?, 0, ?, 'PURCHASE', 'init', 'init', 'Saldo Awal Persediaan')
    `).run('sm-' + st.item_id, st.item_id, st.qty, st.cost);
  }

  // Jurnal Stok Awal
  const accRawInv = db.prepare("SELECT id FROM accounts WHERE code = '1-1500'").get().id;
  const jStokId = 'jnl-init-stock';
  db.prepare(`
    INSERT INTO journals (id, journal_no, journal_date, description, status)
    VALUES (?, ?, date('now'), ?, 'POSTED')
  `).run(jStokId, 'JRN-STOCK-001', 'Pembelian Bahan Baku Stok Awal');

  db.prepare("INSERT INTO journal_lines (id, journal_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?, ?)")
    .run('jl-stk-1', jStokId, accRawInv, 2025000, 0, 'Persediaan Bahan Baku Awal');
  db.prepare("INSERT INTO journal_lines (id, journal_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?, ?)")
    .run('jl-stk-2', jStokId, accKas, 0, 2025000, 'Pembelian Tunai Bahan Baku');

  // Stok Awal Barang Jadi di FG_WH (50 pcs Cendol @ Rp 9.500)
  db.prepare(`
    INSERT INTO stock_balances (id, item_id, location, worker_id, qty, avg_cost)
    VALUES (?, ?, 'FG_WH', NULL, ?, ?)
  `).run('sb-fg-001', 'item-fg-001', 50, 9500);

  db.prepare(`
    INSERT INTO stock_movements (id, movement_date, item_id, location, qty_in, qty_out, unit_cost, movement_type, source_table, source_id, note)
    VALUES (?, date('now'), ?, 'FG_WH', 50, 0, 9500, 'RECEIPT_FG', 'init', 'init', 'Stok Awal Barang Jadi')
  `).run('sm-fg-001', 'item-fg-001');

  const accFgInv = db.prepare("SELECT id FROM accounts WHERE code = '1-1520'").get().id;
  const jFgId = 'jnl-init-fg';
  db.prepare(`
    INSERT INTO journals (id, journal_no, journal_date, description, status)
    VALUES (?, ?, date('now'), ?, 'POSTED')
  `).run(jFgId, 'JRN-STOCK-002', 'Persediaan Awal Barang Jadi Keset');

  db.prepare("INSERT INTO journal_lines (id, journal_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?, ?)")
    .run('jl-fg-1', jFgId, accFgInv, 475000, 0, 'Persediaan Keset Cendol Siap Jual');
  db.prepare("INSERT INTO journal_lines (id, journal_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?, ?)")
    .run('jl-fg-2', jFgId, accKas, 0, 475000, 'Kas pengadaan barang jadi awal');

  console.log('Seeding selesai!');
}

// Inisialisasi
initDatabase();
seedInitialData();

module.exports = { db };

