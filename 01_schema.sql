-- =====================================================================
-- SKEMA DATABASE: Aplikasi Usaha Keset (internal, satu perusahaan)
-- Target: PostgreSQL (Supabase). Untuk SQLite lokal di aplikasi,
-- ganti tipe: numeric -> REAL/INTEGER (simpan rupiah dalam sen/bulat),
-- uuid -> TEXT, timestamptz -> TEXT (ISO 8601), dan hapus trigger.
-- Konvensi: uang numeric(18,2), kuantitas numeric(18,4), biaya/unit numeric(18,4)
-- Prinsip: transaksi tidak dihapus, hanya dibatalkan dengan jurnal balik.
-- =====================================================================

-- ---------- 0. ENUM ----------
CREATE TYPE item_type        AS ENUM ('RAW_MATERIAL', 'FINISHED_GOOD');
CREATE TYPE stock_location   AS ENUM ('RAW_WH', 'WORKER', 'FG_WH');
CREATE TYPE doc_status       AS ENUM ('DRAFT', 'POSTED', 'VOID');
CREATE TYPE payment_status   AS ENUM ('UNPAID', 'PARTIAL', 'PAID');
CREATE TYPE account_type     AS ENUM ('ASSET','LIABILITY','EQUITY','REVENUE','COGS','EXPENSE');
CREATE TYPE variance_reason  AS ENUM ('DAMAGED','LOST','MEASURE_ERROR','OVERUSE','OTHER');
CREATE TYPE variance_status  AS ENUM ('PENDING','APPROVED','REJECTED');
CREATE TYPE user_role        AS ENUM ('OWNER','WAREHOUSE_ADMIN','CASHIER','FINANCE');

-- ---------- 1. PENGGUNA & AUDIT ----------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text UNIQUE NOT NULL,
  role          user_role NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id),
  action      text NOT NULL,              -- CREATE / UPDATE / VOID / APPROVE / LOGIN
  table_name  text NOT NULL,
  record_id   text NOT NULL,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- 2. MASTER DATA ----------
CREATE TABLE units (
  id    serial PRIMARY KEY,
  code  text UNIQUE NOT NULL,             -- kg, pcs, meter, roll
  name  text NOT NULL
);

CREATE TABLE items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                text UNIQUE NOT NULL,
  name               text NOT NULL,
  type               item_type NOT NULL,
  unit_id            int NOT NULL REFERENCES units(id),
  -- peran ganda bahan baku
  can_be_produced_with boolean NOT NULL DEFAULT false,   -- dipakai produksi
  can_be_sold          boolean NOT NULL DEFAULT false,   -- dijual langsung
  -- atribut keset (barang jadi)
  size_label         text,                -- mis. 40x60
  color              text,
  min_stock          numeric(18,4) NOT NULL DEFAULT 0,
  -- toleransi susut wajar (persen dari kebutuhan standar), dipakai untuk bahan
  shrink_tolerance_pct numeric(6,3) NOT NULL DEFAULT 0,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (type = 'FINISHED_GOOD' OR can_be_produced_with OR can_be_sold)
);

-- Harga jual bertingkat (harga umum, reseller, karyawan, dst.)
CREATE TABLE price_tiers (
  id    serial PRIMARY KEY,
  name  text UNIQUE NOT NULL
);
CREATE TABLE item_prices (
  item_id        uuid NOT NULL REFERENCES items(id),
  price_tier_id  int  NOT NULL REFERENCES price_tiers(id),
  price          numeric(18,2) NOT NULL CHECK (price >= 0),
  PRIMARY KEY (item_id, price_tier_id)
);

-- Mitra: satu data bisa menjadi pemasok, pelanggan, atau keduanya
CREATE TABLE partners (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  phone          text,
  address        text,
  is_supplier    boolean NOT NULL DEFAULT false,
  is_customer    boolean NOT NULL DEFAULT false,
  price_tier_id  int REFERENCES price_tiers(id),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (is_supplier OR is_customer)
);

-- Pekerja borongan
CREATE TABLE workers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  phone       text,
  address     text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Resep / BOM: kebutuhan bahan standar per 1 unit barang jadi
CREATE TABLE boms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finished_item_id uuid NOT NULL REFERENCES items(id),
  version         int NOT NULL DEFAULT 1,
  is_active       boolean NOT NULL DEFAULT true,
  UNIQUE (finished_item_id, version)
);
CREATE TABLE bom_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id        uuid NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  material_id   uuid NOT NULL REFERENCES items(id),
  qty_per_unit  numeric(18,4) NOT NULL CHECK (qty_per_unit > 0),
  UNIQUE (bom_id, material_id)
);

-- Tarif borongan per produk (bisa khusus pekerja; worker_id NULL = tarif umum)
CREATE TABLE piece_rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES items(id),
  worker_id     uuid REFERENCES workers(id),
  rate_pass     numeric(18,2) NOT NULL CHECK (rate_pass >= 0),   -- per unit lolos QC
  rate_rework   numeric(18,2) NOT NULL DEFAULT 0,                -- per unit perbaikan/reject (kebijakan)
  valid_from    date NOT NULL DEFAULT current_date
);
CREATE INDEX ON piece_rates (item_id, worker_id, valid_from DESC);

-- ---------- 3. AKUNTANSI (dibuat lebih dulu karena dirujuk modul lain) ----------
CREATE TABLE accounts (
  id          serial PRIMARY KEY,
  code        text UNIQUE NOT NULL,
  name        text NOT NULL,
  type        account_type NOT NULL,
  parent_id   int REFERENCES accounts(id),
  is_postable boolean NOT NULL DEFAULT true,   -- false = akun induk/judul
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE accounting_periods (
  id          serial PRIMARY KEY,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  is_closed   boolean NOT NULL DEFAULT false,
  closed_by   uuid REFERENCES users(id),
  closed_at   timestamptz,
  CHECK (end_date >= start_date),
  UNIQUE (start_date, end_date)
);

CREATE TABLE journals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_no    text UNIQUE NOT NULL,
  journal_date  date NOT NULL,
  description   text,
  source_table  text,                 -- mis. 'sales', 'purchases', 'work_receipts'
  source_id     uuid,
  status        doc_status NOT NULL DEFAULT 'POSTED',
  reversal_of   uuid REFERENCES journals(id),   -- jurnal balik
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON journals (journal_date);
CREATE INDEX ON journals (source_table, source_id);

CREATE TABLE journal_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id  uuid NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  account_id  int  NOT NULL REFERENCES accounts(id),
  debit       numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit      numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  partner_id  uuid REFERENCES partners(id),   -- sub-ledger utang/piutang
  worker_id   uuid REFERENCES workers(id),    -- sub-ledger upah/kasbon
  memo        text,
  CHECK ((debit = 0) <> (credit = 0))         -- satu sisi saja per baris
);
CREATE INDEX ON journal_lines (account_id);
CREATE INDEX ON journal_lines (journal_id);

-- Pengendali: jurnal wajib seimbang, tidak boleh jatuh di periode tertutup
CREATE OR REPLACE FUNCTION check_journal_balanced() RETURNS trigger AS $$
DECLARE d numeric; c numeric; jd date;
BEGIN
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0)
    INTO d, c FROM journal_lines WHERE journal_id = NEW.journal_id;
  IF d <> c OR d = 0 THEN
    RAISE EXCEPTION 'Jurnal % tidak seimbang (debit %, kredit %)', NEW.journal_id, d, c;
  END IF;
  SELECT journal_date INTO jd FROM journals WHERE id = NEW.journal_id;
  IF EXISTS (SELECT 1 FROM accounting_periods
             WHERE is_closed AND jd BETWEEN start_date AND end_date) THEN
    RAISE EXCEPTION 'Periode untuk tanggal % sudah ditutup', jd;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_journal_balanced
  AFTER INSERT OR UPDATE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_balanced();

-- Jurnal yang sudah diposting tidak boleh diubah/dihapus (hanya di-reverse)
CREATE OR REPLACE FUNCTION block_posted_journal_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Jurnal tidak boleh dihapus. Gunakan jurnal balik.';
  END IF;
  IF OLD.status = 'POSTED' AND NEW.status NOT IN ('POSTED','VOID') THEN
    RAISE EXCEPTION 'Jurnal terposting tidak boleh diubah.';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journals_immutable
  BEFORE UPDATE OR DELETE ON journals
  FOR EACH ROW EXECUTE FUNCTION block_posted_journal_change();

-- ---------- 4. STOK ----------
-- Saldo berjalan per barang + lokasi (+ pekerja jika lokasi WORKER), metode rata-rata bergerak
CREATE TABLE stock_balances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL REFERENCES items(id),
  location    stock_location NOT NULL,
  worker_id   uuid REFERENCES workers(id),
  qty         numeric(18,4) NOT NULL DEFAULT 0,
  avg_cost    numeric(18,4) NOT NULL DEFAULT 0,
  CHECK ((location = 'WORKER') = (worker_id IS NOT NULL))
);
CREATE UNIQUE INDEX uq_stock_balance
  ON stock_balances (item_id, location, COALESCE(worker_id, '00000000-0000-0000-0000-000000000000'));

-- Kartu stok: setiap pergerakan = satu baris (qty_in atau qty_out)
CREATE TABLE stock_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_date date NOT NULL,
  item_id       uuid NOT NULL REFERENCES items(id),
  location      stock_location NOT NULL,
  worker_id     uuid REFERENCES workers(id),
  qty_in        numeric(18,4) NOT NULL DEFAULT 0 CHECK (qty_in  >= 0),
  qty_out       numeric(18,4) NOT NULL DEFAULT 0 CHECK (qty_out >= 0),
  unit_cost     numeric(18,4) NOT NULL DEFAULT 0,
  movement_type text NOT NULL,        -- PURCHASE, SALE, ISSUE_TO_WORKER, RECEIPT_FG, RETURN_FROM_WORKER, VARIANCE, ADJUSTMENT, SALE_RETURN
  source_table  text NOT NULL,
  source_id     uuid NOT NULL,
  note          text,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((qty_in = 0) <> (qty_out = 0)),
  CHECK ((location = 'WORKER') = (worker_id IS NOT NULL))
);
CREATE INDEX ON stock_movements (item_id, movement_date);
CREATE INDEX ON stock_movements (worker_id, item_id);

-- Stok opname
CREATE TABLE stock_opnames (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opname_no     text UNIQUE NOT NULL,
  opname_date   date NOT NULL,
  location      stock_location NOT NULL,
  worker_id     uuid REFERENCES workers(id),
  status        doc_status NOT NULL DEFAULT 'DRAFT',
  journal_id    uuid REFERENCES journals(id),
  created_by    uuid REFERENCES users(id)
);
CREATE TABLE stock_opname_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opname_id   uuid NOT NULL REFERENCES stock_opnames(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES items(id),
  system_qty  numeric(18,4) NOT NULL,
  counted_qty numeric(18,4) NOT NULL,
  unit_cost   numeric(18,4) NOT NULL DEFAULT 0
);

-- ---------- 5. PEMBELIAN BAHAN BAKU ----------
CREATE TABLE purchases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_no     text UNIQUE NOT NULL,
  purchase_date   date NOT NULL,
  partner_id      uuid NOT NULL REFERENCES partners(id),
  total           numeric(18,2) NOT NULL DEFAULT 0,
  paid_amount     numeric(18,2) NOT NULL DEFAULT 0,
  payment_status  payment_status NOT NULL DEFAULT 'UNPAID',
  due_date        date,
  status          doc_status NOT NULL DEFAULT 'POSTED',
  journal_id      uuid REFERENCES journals(id),
  note            text,
  created_by      uuid REFERENCES users(id)
);
CREATE TABLE purchase_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id  uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES items(id),
  qty          numeric(18,4) NOT NULL CHECK (qty > 0),
  unit_price   numeric(18,4) NOT NULL CHECK (unit_price >= 0),
  line_total   numeric(18,2) NOT NULL
);

-- ---------- 6. PENJUALAN (keset & bahan baku) ----------
CREATE TABLE sales (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_no         text UNIQUE NOT NULL,
  sale_date       date NOT NULL,
  partner_id      uuid REFERENCES partners(id),     -- NULL = pelanggan umum tunai
  subtotal        numeric(18,2) NOT NULL DEFAULT 0,
  discount        numeric(18,2) NOT NULL DEFAULT 0,
  total           numeric(18,2) NOT NULL DEFAULT 0,
  paid_amount     numeric(18,2) NOT NULL DEFAULT 0,
  payment_status  payment_status NOT NULL DEFAULT 'UNPAID',
  due_date        date,
  status          doc_status NOT NULL DEFAULT 'POSTED',
  journal_id      uuid REFERENCES journals(id),
  note            text,
  created_by      uuid REFERENCES users(id)
);
CREATE TABLE sale_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES items(id),
  qty         numeric(18,4) NOT NULL CHECK (qty > 0),
  unit_price  numeric(18,4) NOT NULL CHECK (unit_price >= 0),
  line_total  numeric(18,2) NOT NULL,
  unit_cost   numeric(18,4) NOT NULL DEFAULT 0     -- HPP saat terjual (rata-rata bergerak)
);

CREATE TABLE sale_returns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no    text UNIQUE NOT NULL,
  return_date  date NOT NULL,
  sale_id      uuid NOT NULL REFERENCES sales(id),
  total        numeric(18,2) NOT NULL,
  status       doc_status NOT NULL DEFAULT 'POSTED',
  journal_id   uuid REFERENCES journals(id)
);
CREATE TABLE sale_return_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id   uuid NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES items(id),
  qty         numeric(18,4) NOT NULL CHECK (qty > 0),
  unit_price  numeric(18,4) NOT NULL,
  unit_cost   numeric(18,4) NOT NULL
);

-- ---------- 7. KAS, PEMBAYARAN, KASBON, KOMPENSASI ----------
CREATE TABLE cash_accounts (
  id          serial PRIMARY KEY,
  name        text NOT NULL,                  -- Kas Kecil, BCA, BRI, dst.
  account_id  int NOT NULL REFERENCES accounts(id)
);

-- Pembayaran/penerimaan atas faktur (piutang & utang)
CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_no      text UNIQUE NOT NULL,
  payment_date    date NOT NULL,
  direction       text NOT NULL CHECK (direction IN ('IN','OUT')),   -- IN = terima dari pelanggan, OUT = bayar pemasok
  partner_id      uuid NOT NULL REFERENCES partners(id),
  cash_account_id int NOT NULL REFERENCES cash_accounts(id),
  amount          numeric(18,2) NOT NULL CHECK (amount > 0),
  sale_id         uuid REFERENCES sales(id),
  purchase_id     uuid REFERENCES purchases(id),
  status          doc_status NOT NULL DEFAULT 'POSTED',
  journal_id      uuid REFERENCES journals(id),
  CHECK (sale_id IS NOT NULL OR purchase_id IS NOT NULL)
);

-- Kompensasi (netting) piutang vs utang dengan mitra yang sama
CREATE TABLE partner_nettings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  netting_no    text UNIQUE NOT NULL,
  netting_date  date NOT NULL,
  partner_id    uuid NOT NULL REFERENCES partners(id),
  amount        numeric(18,2) NOT NULL CHECK (amount > 0),
  status        doc_status NOT NULL DEFAULT 'POSTED',
  journal_id    uuid REFERENCES journals(id)
);
CREATE TABLE partner_netting_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  netting_id  uuid NOT NULL REFERENCES partner_nettings(id) ON DELETE CASCADE,
  sale_id     uuid REFERENCES sales(id),
  purchase_id uuid REFERENCES purchases(id),
  amount      numeric(18,2) NOT NULL CHECK (amount > 0),
  CHECK ((sale_id IS NULL) <> (purchase_id IS NULL))
);

-- Beban operasional & transaksi kas lain (transport, listrik, modal, prive)
CREATE TABLE cash_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trx_no          text UNIQUE NOT NULL,
  trx_date        date NOT NULL,
  cash_account_id int NOT NULL REFERENCES cash_accounts(id),
  direction       text NOT NULL CHECK (direction IN ('IN','OUT')),
  counter_account_id int NOT NULL REFERENCES accounts(id),   -- akun lawan: beban/modal/prive/dst.
  amount          numeric(18,2) NOT NULL CHECK (amount > 0),
  description     text,
  status          doc_status NOT NULL DEFAULT 'POSTED',
  journal_id      uuid REFERENCES journals(id)
);

-- Kasbon pekerja
CREATE TABLE worker_advances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_no      text UNIQUE NOT NULL,
  advance_date    date NOT NULL,
  worker_id       uuid NOT NULL REFERENCES workers(id),
  cash_account_id int NOT NULL REFERENCES cash_accounts(id),
  amount          numeric(18,2) NOT NULL CHECK (amount > 0),
  status          doc_status NOT NULL DEFAULT 'POSTED',
  journal_id      uuid REFERENCES journals(id)
);

-- ---------- 8. PRODUKSI BORONGAN ----------
-- Tiket kerja = surat serah bahan ke pekerja
CREATE TABLE work_tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no       text UNIQUE NOT NULL,
  worker_id       uuid NOT NULL REFERENCES workers(id),
  target_item_id  uuid NOT NULL REFERENCES items(id),      -- keset yang dikerjakan
  target_qty      numeric(18,4) NOT NULL CHECK (target_qty > 0),
  issue_date      date NOT NULL,
  due_date        date,                                    -- batas setor (untuk notifikasi)
  bom_id          uuid REFERENCES boms(id),
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','VOID')),
  closed_at       timestamptz,
  note            text,
  created_by      uuid REFERENCES users(id)
);
CREATE INDEX ON work_tickets (worker_id, status);

-- Penyerahan bahan ke pekerja
CREATE TABLE work_ticket_issues (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     uuid NOT NULL REFERENCES work_tickets(id),
  issue_date    date NOT NULL,
  material_id   uuid NOT NULL REFERENCES items(id),
  qty           numeric(18,4) NOT NULL CHECK (qty > 0),
  unit_cost     numeric(18,4) NOT NULL,        -- rata-rata bahan di gudang saat diserahkan
  status        doc_status NOT NULL DEFAULT 'POSTED',
  journal_id    uuid REFERENCES journals(id)
);

-- Setoran hasil jadi + QC
CREATE TABLE work_receipts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no      text UNIQUE NOT NULL,
  ticket_id       uuid NOT NULL REFERENCES work_tickets(id),
  receipt_date    date NOT NULL,
  qty_pass        numeric(18,4) NOT NULL DEFAULT 0 CHECK (qty_pass   >= 0),
  qty_rework      numeric(18,4) NOT NULL DEFAULT 0 CHECK (qty_rework >= 0),
  qty_reject      numeric(18,4) NOT NULL DEFAULT 0 CHECK (qty_reject >= 0),
  rate_pass       numeric(18,2) NOT NULL,      -- tarif yang berlaku saat setor
  rate_rework     numeric(18,2) NOT NULL DEFAULT 0,
  wage_amount     numeric(18,2) NOT NULL,      -- qty_pass*rate_pass + qty_rework*rate_rework
  material_cost   numeric(18,2) NOT NULL,      -- standar BOM x qty (pass) x biaya rata-rata di pekerja
  fg_unit_cost    numeric(18,4) NOT NULL,      -- (material_cost + wage_amount) / qty_pass
  status          doc_status NOT NULL DEFAULT 'POSTED',
  journal_id      uuid REFERENCES journals(id),
  qc_by           uuid REFERENCES users(id)
);

-- Pengembalian sisa bahan dari pekerja
CREATE TABLE work_ticket_returns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     uuid NOT NULL REFERENCES work_tickets(id),
  return_date    date NOT NULL,
  material_id   uuid NOT NULL REFERENCES items(id),
  qty           numeric(18,4) NOT NULL CHECK (qty > 0),
  unit_cost     numeric(18,4) NOT NULL,
  status        doc_status NOT NULL DEFAULT 'POSTED',
  journal_id    uuid REFERENCES journals(id)
);

-- Selisih bahan saat tiket ditutup: diposting ke beban hanya setelah disetujui
CREATE TABLE material_variances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      uuid NOT NULL REFERENCES work_tickets(id),
  material_id    uuid NOT NULL REFERENCES items(id),
  issued_qty     numeric(18,4) NOT NULL,
  returned_qty   numeric(18,4) NOT NULL,
  standard_qty   numeric(18,4) NOT NULL,   -- kebutuhan BOM x hasil jadi (lolos+reject)
  tolerance_qty  numeric(18,4) NOT NULL,   -- standar x toleransi%
  variance_qty   numeric(18,4) NOT NULL,   -- issued - returned - standard
  excess_qty     numeric(18,4) NOT NULL,   -- bagian di atas toleransi (jadi beban)
  unit_cost      numeric(18,4) NOT NULL,
  reason         variance_reason,
  status         variance_status NOT NULL DEFAULT 'PENDING',
  approved_by    uuid REFERENCES users(id),
  approved_at    timestamptz,
  journal_id     uuid REFERENCES journals(id),
  note           text
);

-- Slip upah borongan per periode
CREATE TABLE wage_slips (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slip_no       text UNIQUE NOT NULL,
  worker_id     uuid NOT NULL REFERENCES workers(id),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  gross_wage    numeric(18,2) NOT NULL,          -- jumlah wage_amount pada periode
  advance_deduct numeric(18,2) NOT NULL DEFAULT 0, -- potongan kasbon
  net_paid      numeric(18,2) NOT NULL,
  cash_account_id int REFERENCES cash_accounts(id),
  paid_date     date,
  status        doc_status NOT NULL DEFAULT 'DRAFT',
  journal_id    uuid REFERENCES journals(id),
  CHECK (net_paid = gross_wage - advance_deduct)
);
CREATE TABLE wage_slip_receipts (
  slip_id     uuid NOT NULL REFERENCES wage_slips(id) ON DELETE CASCADE,
  receipt_id  uuid NOT NULL REFERENCES work_receipts(id),
  PRIMARY KEY (slip_id, receipt_id),
  UNIQUE (receipt_id)                           -- satu setoran hanya dibayar sekali
);

-- ---------- 9. VIEW LAPORAN PENTING ----------
-- Neraca saldo
CREATE VIEW v_trial_balance AS
SELECT a.code, a.name, a.type,
       SUM(jl.debit)  AS total_debit,
       SUM(jl.credit) AS total_credit,
       SUM(jl.debit - jl.credit) AS balance
FROM journal_lines jl
JOIN journals j ON j.id = jl.journal_id AND j.status = 'POSTED'
JOIN accounts a ON a.id = jl.account_id
GROUP BY a.code, a.name, a.type;

-- Saldo bahan yang sedang dibawa tiap pekerja
CREATE VIEW v_worker_material_balance AS
SELECT w.name AS worker, i.name AS material, sb.qty, sb.avg_cost,
       ROUND(sb.qty * sb.avg_cost, 2) AS value
FROM stock_balances sb
JOIN workers w ON w.id = sb.worker_id
JOIN items i   ON i.id = sb.item_id
WHERE sb.location = 'WORKER' AND sb.qty <> 0;

-- Tiket lewat batas waktu
CREATE VIEW v_overdue_tickets AS
SELECT t.ticket_no, w.name AS worker, t.issue_date, t.due_date,
       current_date - t.due_date AS days_overdue
FROM work_tickets t JOIN workers w ON w.id = t.worker_id
WHERE t.status = 'OPEN' AND t.due_date < current_date;

-- Saldo bersih mitra (positif = mitra berutang ke kita)
CREATE VIEW v_partner_net_balance AS
SELECT p.id, p.name,
  COALESCE((SELECT SUM(s.total - s.paid_amount) FROM sales s
            WHERE s.partner_id = p.id AND s.status = 'POSTED'), 0) AS receivable,
  COALESCE((SELECT SUM(u.total - u.paid_amount) FROM purchases u
            WHERE u.partner_id = p.id AND u.status = 'POSTED'), 0) AS payable,
  COALESCE((SELECT SUM(s.total - s.paid_amount) FROM sales s
            WHERE s.partner_id = p.id AND s.status = 'POSTED'), 0)
- COALESCE((SELECT SUM(u.total - u.paid_amount) FROM purchases u
            WHERE u.partner_id = p.id AND u.status = 'POSTED'), 0) AS net_balance
FROM partners p;
