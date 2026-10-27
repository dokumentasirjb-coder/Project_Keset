// server.js - REST API Backend dan Auto-Journal Engine untuk Usaha Keset
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { db } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper Fungsi Jurnal & Stok
function getAccountId(code) {
  const row = db.prepare('SELECT id FROM accounts WHERE code = ?').get(code);
  if (!row) throw new Error(`Akun dengan kode ${code} tidak ditemukan.`);
  return row.id;
}

function getNextDocNo(prefix, tableName, colName) {
  const count = db.prepare(`SELECT COUNT(*) as c FROM ${tableName}`).get().c + 1;
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${dateStr}-${String(count).padStart(4, '0')}`;
}

function createJournalEntry({ journalNo, journalDate, description, sourceTable, sourceId, lines }) {
  // Verifikasi debit === credit
  const totalDebit = lines.reduce((acc, l) => acc + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((acc, l) => acc + (Number(l.credit) || 0), 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Jurnal tidak seimbang! Total Debit: ${totalDebit}, Total Credit: ${totalCredit}`);
  }

  const jId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO journals (id, journal_no, journal_date, description, source_table, source_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'POSTED')
  `).run(jId, journalNo, journalDate || new Date().toISOString().slice(0, 10), description, sourceTable, sourceId);

  const insertLine = db.prepare(`
    INSERT INTO journal_lines (id, journal_id, account_id, debit, credit, partner_id, worker_id, memo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const l of lines) {
    insertLine.run(
      crypto.randomUUID(),
      jId,
      l.account_id,
      Number(l.debit) || 0,
      Number(l.credit) || 0,
      l.partner_id || null,
      l.worker_id || null,
      l.memo || null
    );
  }

  return jId;
}

function updateStockBalance(itemId, location, workerId, qtyDelta, unitCost) {
  // workerId NULL jika bukan WORKER
  const wId = location === 'WORKER' ? workerId : null;
  let row = db.prepare(`
    SELECT id, qty, avg_cost FROM stock_balances
    WHERE item_id = ? AND location = ? AND (worker_id = ? OR (worker_id IS NULL AND ? IS NULL))
  `).get(itemId, location, wId, wId);

  if (!row) {
    const newId = crypto.randomUUID();
    const initQty = Math.max(0, qtyDelta);
    const initCost = unitCost || 0;
    db.prepare(`
      INSERT INTO stock_balances (id, item_id, location, worker_id, qty, avg_cost)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(newId, itemId, location, wId, initQty, initCost);
    return { qty: initQty, avg_cost: initCost };
  }

  const oldQty = Number(row.qty);
  const oldAvgCost = Number(row.avg_cost);
  const newQty = oldQty + qtyDelta;

  let newAvgCost = oldAvgCost;
  if (qtyDelta > 0 && unitCost !== undefined && unitCost > 0) {
    // Moving average: (oldQty * oldCost + deltaQty * unitCost) / newQty
    const totalVal = (oldQty * oldAvgCost) + (qtyDelta * unitCost);
    newAvgCost = newQty > 0 ? (totalVal / newQty) : unitCost;
  }

  db.prepare(`
    UPDATE stock_balances
    SET qty = ?, avg_cost = ?
    WHERE id = ?
  `).run(newQty, newAvgCost, row.id);

  return { qty: newQty, avg_cost: newAvgCost };
}

function recordStockMovement({ movementDate, itemId, location, workerId, qtyIn, qtyOut, unitCost, movementType, sourceTable, sourceId, note }) {
  const smId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO stock_movements (id, movement_date, item_id, location, worker_id, qty_in, qty_out, unit_cost, movement_type, source_table, source_id, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    smId,
    movementDate || new Date().toISOString().slice(0, 10),
    itemId,
    location,
    location === 'WORKER' ? workerId : null,
    Number(qtyIn) || 0,
    Number(qtyOut) || 0,
    Number(unitCost) || 0,
    movementType,
    sourceTable,
    sourceId,
    note || null
  );
  return smId;
}

// ==========================================
// 1. DASHBOARD & STATISTIK KPI
// ==========================================
app.get('/api/dashboard', (req, res) => {
  try {
    // 1. Kas & Bank
    const accKas = db.prepare("SELECT SUM(debit - credit) as bal FROM journal_lines WHERE account_id IN (SELECT account_id FROM cash_accounts)").get().bal || 0;

    // 2. Persediaan
    const accRaw = getAccountId('1-1500');
    const accWip = getAccountId('1-1510');
    const accFg  = getAccountId('1-1520');

    const rawBal = db.prepare("SELECT SUM(debit - credit) as bal FROM journal_lines WHERE account_id = ?").get(accRaw).bal || 0;
    const wipBal = db.prepare("SELECT SUM(debit - credit) as bal FROM journal_lines WHERE account_id = ?").get(accWip).bal || 0;
    const fgBal  = db.prepare("SELECT SUM(debit - credit) as bal FROM journal_lines WHERE account_id = ?").get(accFg).bal || 0;

    // 3. Piutang & Utang Usaha
    const accAr = getAccountId('1-1300');
    const accAp = getAccountId('2-1100');
    const accWagePayable = getAccountId('2-1200');

    const arBal = db.prepare("SELECT SUM(debit - credit) as bal FROM journal_lines WHERE account_id = ?").get(accAr).bal || 0;
    const apBal = db.prepare("SELECT SUM(credit - debit) as bal FROM journal_lines WHERE account_id = ?").get(accAp).bal || 0;
    const wagePayableBal = db.prepare("SELECT SUM(credit - debit) as bal FROM journal_lines WHERE account_id = ?").get(accWagePayable).bal || 0;

    // 4. Penjualan & Laba Kotor Berjalan
    const accSales1 = getAccountId('4-1000');
    const accSales2 = getAccountId('4-2000');
    const accCogs1  = getAccountId('5-1000');
    const accCogs2  = getAccountId('5-2000');

    const totalSales = db.prepare("SELECT SUM(credit - debit) as rev FROM journal_lines WHERE account_id IN (?, ?)").get(accSales1, accSales2).rev || 0;
    const totalCogs  = db.prepare("SELECT SUM(debit - credit) as cogs FROM journal_lines WHERE account_id IN (?, ?)").get(accCogs1, accCogs2).cogs || 0;
    const grossProfit = totalSales - totalCogs;

    // 5. Tiket Borongan Aktif & Overdue
    const activeTickets = db.prepare("SELECT COUNT(*) as c FROM work_tickets WHERE status = 'OPEN'").get().c;
    const today = new Date().toISOString().slice(0, 10);
    const overdueTickets = db.prepare("SELECT COUNT(*) as c FROM work_tickets WHERE status = 'OPEN' AND due_date < ?").get(today).c;

    // 6. Transaksi Terakhir
    const recentSales = db.prepare(`
      SELECT s.id, s.sale_no, s.sale_date, s.total, s.paid_amount, s.payment_status, p.name as customer_name
      FROM sales s
      LEFT JOIN partners p ON p.id = s.partner_id
      ORDER BY s.sale_date DESC, s.sale_no DESC LIMIT 5
    `).all();

    const recentPurchases = db.prepare(`
      SELECT pr.id, pr.purchase_no, pr.purchase_date, pr.total, pr.paid_amount, pr.payment_status, p.name as supplier_name
      FROM purchases pr
      LEFT JOIN partners p ON p.id = pr.partner_id
      ORDER BY pr.purchase_date DESC, pr.purchase_no DESC LIMIT 5
    `).all();

    const recentTickets = db.prepare(`
      SELECT t.id, t.ticket_no, t.issue_date, t.target_qty, t.status, w.name as worker_name, i.name as item_name
      FROM work_tickets t
      JOIN workers w ON w.id = t.worker_id
      JOIN items i ON i.id = t.target_item_id
      ORDER BY t.issue_date DESC LIMIT 5
    `).all();

    res.json({
      summary: {
        cash_bank: accKas,
        inventory_raw: rawBal,
        inventory_wip: wipBal,
        inventory_fg: fgBal,
        inventory_total: rawBal + wipBal + fgBal,
        receivable: arBal,
        payable_vendor: apBal,
        payable_wage: wagePayableBal,
        total_sales: totalSales,
        total_cogs: totalCogs,
        gross_profit: grossProfit,
        active_tickets: activeTickets,
        overdue_tickets: overdueTickets
      },
      recent_sales: recentSales,
      recent_purchases: recentPurchases,
      recent_tickets: recentTickets
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. MASTER DATA (Items, Partners, Workers, BOM, Rates, Accounts)
// ==========================================
app.get('/api/items', (req, res) => {
  try {
    const items = db.prepare(`
      SELECT i.*, u.code as unit_code, u.name as unit_name,
        COALESCE((SELECT qty FROM stock_balances WHERE item_id = i.id AND location = 'RAW_WH'), 0) as stock_raw,
        COALESCE((SELECT avg_cost FROM stock_balances WHERE item_id = i.id AND location = 'RAW_WH'), 0) as cost_raw,
        COALESCE((SELECT SUM(qty) FROM stock_balances WHERE item_id = i.id AND location = 'WORKER'), 0) as stock_wip,
        COALESCE((SELECT qty FROM stock_balances WHERE item_id = i.id AND location = 'FG_WH'), 0) as stock_fg,
        COALESCE((SELECT avg_cost FROM stock_balances WHERE item_id = i.id AND location = 'FG_WH'), 0) as cost_fg
      FROM items i
      JOIN units u ON u.id = i.unit_id
      WHERE i.is_active = 1
      ORDER BY i.type DESC, i.name ASC
    `).all();

    // Dapatkan harga jual per tier
    const prices = db.prepare(`
      SELECT ip.item_id, ip.price_tier_id, pt.name as tier_name, ip.price
      FROM item_prices ip
      JOIN price_tiers pt ON pt.id = ip.price_tier_id
    `).all();

    const priceMap = {};
    for (const p of prices) {
      if (!priceMap[p.item_id]) priceMap[p.item_id] = [];
      priceMap[p.item_id].push(p);
    }

    const result = items.map(it => ({
      ...it,
      prices: priceMap[it.id] || []
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/items', (req, res) => {
  try {
    const { sku, name, type, unit_id, can_be_produced_with, can_be_sold, size_label, color, min_stock, shrink_tolerance_pct, prices } = req.body;
    const id = crypto.randomUUID();

    db.exec('BEGIN TRANSACTION');
    db.prepare(`
      INSERT INTO items (id, sku, name, type, unit_id, can_be_produced_with, can_be_sold, size_label, color, min_stock, shrink_tolerance_pct)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, sku, name, type, unit_id,
      can_be_produced_with ? 1 : 0,
      can_be_sold ? 1 : 0,
      size_label || null,
      color || null,
      Number(min_stock) || 0,
      Number(shrink_tolerance_pct) || 0
    );

    if (prices && Array.isArray(prices)) {
      for (const pr of prices) {
        db.prepare('INSERT INTO item_prices (item_id, price_tier_id, price) VALUES (?, ?, ?)').run(id, pr.price_tier_id, pr.price);
      }
    }

    // Buat row saldo stok default
    if (type === 'RAW_MATERIAL') {
      db.prepare("INSERT INTO stock_balances (id, item_id, location, qty, avg_cost) VALUES (?, ?, 'RAW_WH', 0, 0)").run(crypto.randomUUID(), id);
    } else {
      db.prepare("INSERT INTO stock_balances (id, item_id, location, qty, avg_cost) VALUES (?, ?, 'FG_WH', 0, 0)").run(crypto.randomUUID(), id);
    }

    db.exec('COMMIT');
    res.json({ success: true, id });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/units', (req, res) => {
  const units = db.prepare('SELECT * FROM units ORDER BY name').all();
  res.json(units);
});

app.get('/api/price-tiers', (req, res) => {
  const tiers = db.prepare('SELECT * FROM price_tiers ORDER BY id').all();
  res.json(tiers);
});

app.get('/api/partners', (req, res) => {
  try {
    const partners = db.prepare(`
      SELECT p.*, pt.name as price_tier_name,
        COALESCE((SELECT SUM(s.total - s.paid_amount) FROM sales s WHERE s.partner_id = p.id AND s.status = 'POSTED'), 0) as receivable,
        COALESCE((SELECT SUM(u.total - u.paid_amount) FROM purchases u WHERE u.partner_id = p.id AND u.status = 'POSTED'), 0) as payable
      FROM partners p
      LEFT JOIN price_tiers pt ON pt.id = p.price_tier_id
      WHERE p.is_active = 1
      ORDER BY p.name ASC
    `).all();

    const withNet = partners.map(p => ({
      ...p,
      net_balance: p.receivable - p.payable
    }));

    res.json(withNet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/partners', (req, res) => {
  try {
    const { name, phone, address, is_supplier, is_customer, price_tier_id } = req.body;
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO partners (id, name, phone, address, is_supplier, is_customer, price_tier_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, phone || null, address || null, is_supplier ? 1 : 0, is_customer ? 1 : 0, price_tier_id || null);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workers', (req, res) => {
  try {
    const workers = db.prepare(`
      SELECT w.*,
        COALESCE((SELECT SUM(qty * avg_cost) FROM stock_balances WHERE location = 'WORKER' AND worker_id = w.id), 0) as wip_material_value,
        COALESCE((SELECT SUM(wage_amount) FROM work_receipts wr JOIN work_tickets wt ON wt.id = wr.ticket_id WHERE wt.worker_id = w.id AND wr.id NOT IN (SELECT receipt_id FROM wage_slip_receipts)), 0) as unpaid_wage,
        COALESCE((SELECT SUM(credit - debit) FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE a.code = '1-1400' AND jl.worker_id = w.id), 0) * -1 as advance_debt
      FROM workers w
      WHERE w.is_active = 1
      ORDER BY w.name ASC
    `).all();

    res.json(workers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workers', (req, res) => {
  try {
    const { name, phone, address } = req.body;
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO workers (id, name, phone, address)
      VALUES (?, ?, ?, ?)
    `).run(id, name, phone || null, address || null);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/boms', (req, res) => {
  try {
    const boms = db.prepare(`
      SELECT b.*, i.name as finished_item_name, i.sku as finished_item_sku
      FROM boms b
      JOIN items i ON i.id = b.finished_item_id
      WHERE b.is_active = 1
    `).all();

    const lines = db.prepare(`
      SELECT bl.*, i.name as material_name, i.sku as material_sku, u.code as unit_code
      FROM bom_lines bl
      JOIN items i ON i.id = bl.material_id
      JOIN units u ON u.id = i.unit_id
    `).all();

    const lineMap = {};
    for (const l of lines) {
      if (!lineMap[l.bom_id]) lineMap[l.bom_id] = [];
      lineMap[l.bom_id].push(l);
    }

    const result = boms.map(b => ({
      ...b,
      lines: lineMap[b.id] || []
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/boms', (req, res) => {
  try {
    const { finished_item_id, lines } = req.body;
    const id = crypto.randomUUID();

    db.exec('BEGIN TRANSACTION');
    db.prepare(`
      INSERT INTO boms (id, finished_item_id, version, is_active)
      VALUES (?, ?, 1, 1)
    `).run(id, finished_item_id);

    const insertLine = db.prepare('INSERT INTO bom_lines (id, bom_id, material_id, qty_per_unit) VALUES (?, ?, ?, ?)');
    for (const l of lines) {
      insertLine.run(crypto.randomUUID(), id, l.material_id, Number(l.qty_per_unit));
    }

    db.exec('COMMIT');
    res.json({ success: true, id });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/piece-rates', (req, res) => {
  try {
    const rates = db.prepare(`
      SELECT pr.*, i.name as item_name, w.name as worker_name
      FROM piece_rates pr
      JOIN items i ON i.id = pr.item_id
      LEFT JOIN workers w ON w.id = pr.worker_id
      ORDER BY i.name ASC
    `).all();
    res.json(rates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/piece-rates', (req, res) => {
  try {
    const { item_id, worker_id, rate_pass, rate_rework } = req.body;
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO piece_rates (id, item_id, worker_id, rate_pass, rate_rework)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, item_id, worker_id || null, Number(rate_pass), Number(rate_rework || 0));
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/accounts', (req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY code ASC').all();
  res.json(accounts);
});

app.get('/api/cash-accounts', (req, res) => {
  const cashes = db.prepare(`
    SELECT ca.*, a.code as account_code, a.name as account_name,
      COALESCE((SELECT SUM(debit - credit) FROM journal_lines WHERE account_id = ca.account_id), 0) as balance
    FROM cash_accounts ca
    JOIN accounts a ON a.id = ca.account_id
    ORDER BY ca.id ASC
  `).all();
  res.json(cashes);
});

// ==========================================
// 3. PEMBELIAN BAHAN BAKU (Auto-Jurnal A1 & A2)
// ==========================================
app.get('/api/purchases', (req, res) => {
  try {
    const purchases = db.prepare(`
      SELECT pr.*, p.name as supplier_name, j.journal_no
      FROM purchases pr
      JOIN partners p ON p.id = pr.partner_id
      LEFT JOIN journals j ON j.id = pr.journal_id
      ORDER BY pr.purchase_date DESC, pr.purchase_no DESC
    `).all();

    const lines = db.prepare(`
      SELECT pl.*, i.name as item_name, i.sku as item_sku, u.code as unit_code
      FROM purchase_lines pl
      JOIN items i ON i.id = pl.item_id
      JOIN units u ON u.id = i.unit_id
    `).all();

    const lineMap = {};
    for (const l of lines) {
      if (!lineMap[l.purchase_id]) lineMap[l.purchase_id] = [];
      lineMap[l.purchase_id].push(l);
    }

    const result = purchases.map(pr => ({
      ...pr,
      lines: lineMap[pr.id] || []
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/purchases', (req, res) => {
  try {
    const { partner_id, purchase_date, lines, is_cash, cash_account_id, due_date, note } = req.body;
    if (!lines || lines.length === 0) return res.status(400).json({ error: 'Daftar bahan baku tidak boleh kosong.' });

    db.exec('BEGIN TRANSACTION');

    const purchaseId = crypto.randomUUID();
    const purchaseNo = getNextDocNo('PO', 'purchases', 'purchase_no');
    const dateStr = purchase_date || new Date().toISOString().slice(0, 10);

    let totalAmount = 0;
    for (const l of lines) {
      const lineTotal = Number(l.qty) * Number(l.unit_price);
      totalAmount += lineTotal;
    }

    const paidAmount = is_cash ? totalAmount : 0;
    const paymentStatus = is_cash ? 'PAID' : 'UNPAID';

    // 1. Simpan Header Pembelian
    db.prepare(`
      INSERT INTO purchases (id, purchase_no, purchase_date, partner_id, total, paid_amount, payment_status, due_date, status, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?)
    `).run(purchaseId, purchaseNo, dateStr, partner_id, totalAmount, paidAmount, paymentStatus, due_date || null, note || null);

    // 2. Simpan Detail & Perbarui Stok RAW_WH serta Moving Average Cost
    const insertLine = db.prepare(`
      INSERT INTO purchase_lines (id, purchase_id, item_id, qty, unit_price, line_total)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const l of lines) {
      const q = Number(l.qty);
      const pr = Number(l.unit_price);
      const lt = q * pr;

      insertLine.run(crypto.randomUUID(), purchaseId, l.item_id, q, pr, lt);

      // Update stok berjalan & moving average di RAW_WH
      updateStockBalance(l.item_id, 'RAW_WH', null, q, pr);

      // Catat kartu stok
      recordStockMovement({
        movementDate: dateStr,
        itemId: l.item_id,
        location: 'RAW_WH',
        qtyIn: q,
        unitCost: pr,
        movementType: 'PURCHASE',
        sourceTable: 'purchases',
        sourceId: purchaseId,
        note: `Pembelian PO ${purchaseNo}`
      });
    }

    // 3. AUTO-JURNAL A1 / A2
    // Dr 1-1500 Persediaan Bahan Baku; Cr Kas/Bank (jika tunai) ATAU Cr 2-1100 Utang Usaha (jika kredit)
    const accRawInv = getAccountId('1-1500');
    const journalNo = getNextDocNo('JRN-PO', 'journals', 'journal_no');

    const journalLines = [
      {
        account_id: accRawInv,
        debit: totalAmount,
        credit: 0,
        memo: `Pembelian bahan baku PO ${purchaseNo}`
      }
    ];

    if (is_cash) {
      // Jurnal A1: Cr Kas/Bank
      const cashAcc = db.prepare('SELECT account_id FROM cash_accounts WHERE id = ?').get(cash_account_id);
      journalLines.push({
        account_id: cashAcc.account_id,
        debit: 0,
        credit: totalAmount,
        partner_id: partner_id,
        memo: `Bayar tunai PO ${purchaseNo}`
      });
    } else {
      // Jurnal A2: Cr 2-1100 Utang Usaha
      const accAp = getAccountId('2-1100');
      journalLines.push({
        account_id: accAp,
        debit: 0,
        credit: totalAmount,
        partner_id: partner_id,
        memo: `Utang usaha PO ${purchaseNo}`
      });
    }

    const jId = createJournalEntry({
      journalNo,
      journalDate: dateStr,
      description: `Auto-jurnal Pembelian PO ${purchaseNo}`,
      sourceTable: 'purchases',
      sourceId: purchaseId,
      lines: journalLines
    });

    db.prepare('UPDATE purchases SET journal_id = ? WHERE id = ?').run(jId, purchaseId);

    db.exec('COMMIT');
    res.json({ success: true, purchase_id: purchaseId, purchase_no: purchaseNo, total: totalAmount });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. PENJUALAN KESET & BAHAN BAKU (Auto-Jurnal B1, B2, B3, B4)
// ==========================================
app.get('/api/sales', (req, res) => {
  try {
    const sales = db.prepare(`
      SELECT s.*, p.name as customer_name, j.journal_no
      FROM sales s
      LEFT JOIN partners p ON p.id = s.partner_id
      LEFT JOIN journals j ON j.id = s.journal_id
      ORDER BY s.sale_date DESC, s.sale_no DESC
    `).all();

    const lines = db.prepare(`
      SELECT sl.*, i.name as item_name, i.sku as item_sku, i.type as item_type, u.code as unit_code
      FROM sale_lines sl
      JOIN items i ON i.id = sl.item_id
      JOIN units u ON u.id = i.unit_id
    `).all();

    const lineMap = {};
    for (const l of lines) {
      if (!lineMap[l.sale_id]) lineMap[l.sale_id] = [];
      lineMap[l.sale_id].push(l);
    }

    const result = sales.map(s => ({
      ...s,
      lines: lineMap[s.id] || []
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales', (req, res) => {
  try {
    const { partner_id, sale_date, lines, discount, is_cash, cash_account_id, due_date, note } = req.body;
    if (!lines || lines.length === 0) return res.status(400).json({ error: 'Item penjualan tidak boleh kosong.' });

    db.exec('BEGIN TRANSACTION');

    const saleId = crypto.randomUUID();
    const saleNo = getNextDocNo('INV', 'sales', 'sale_no');
    const dateStr = sale_date || new Date().toISOString().slice(0, 10);

    let subtotal = 0;
    for (const l of lines) {
      subtotal += Number(l.qty) * Number(l.unit_price);
    }

    const disc = Number(discount) || 0;
    const total = subtotal - disc;
    const paidAmount = is_cash ? total : 0;
    const paymentStatus = is_cash ? 'PAID' : 'UNPAID';

    db.prepare(`
      INSERT INTO sales (id, sale_no, sale_date, partner_id, subtotal, discount, total, paid_amount, payment_status, due_date, status, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?)
    `).run(saleId, saleNo, dateStr, partner_id || null, subtotal, disc, total, paidAmount, paymentStatus, due_date || null, note || null);

    const insertLine = db.prepare(`
      INSERT INTO sale_lines (id, sale_id, item_id, qty, unit_price, line_total, unit_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let totalFgSales = 0;
    let totalFgCogs = 0;
    let totalRawSales = 0;
    let totalRawCogs = 0;

    for (const l of lines) {
      const q = Number(l.qty);
      const pr = Number(l.unit_price);
      const lt = q * pr;

      // Ambil tipe barang & harga pokok rata-rata berjalan
      const it = db.prepare('SELECT type FROM items WHERE id = ?').get(l.item_id);
      const loc = it.type === 'FINISHED_GOOD' ? 'FG_WH' : 'RAW_WH';

      const stockRow = db.prepare('SELECT qty, avg_cost FROM stock_balances WHERE item_id = ? AND location = ?').get(l.item_id, loc);
      const currentAvgCost = stockRow ? Number(stockRow.avg_cost) : 0;
      const currentQty = stockRow ? Number(stockRow.qty) : 0;

      if (currentQty < q) {
        throw new Error(`Stok barang '${l.item_id}' di ${loc} tidak mencukupi (Tersedia: ${currentQty}, Diminta: ${q})`);
      }

      insertLine.run(crypto.randomUUID(), saleId, l.item_id, q, pr, lt, currentAvgCost);

      // Kurangi stok di lokasi terkait
      updateStockBalance(l.item_id, loc, null, -q, currentAvgCost);

      // Catat kartu stok
      recordStockMovement({
        movementDate: dateStr,
        itemId: l.item_id,
        location: loc,
        qtyOut: q,
        unitCost: currentAvgCost,
        movementType: 'SALE',
        sourceTable: 'sales',
        sourceId: saleId,
        note: `Penjualan Faktur ${saleNo}`
      });

      const lineCogs = q * currentAvgCost;
      if (it.type === 'FINISHED_GOOD') {
        totalFgSales += lt;
        totalFgCogs += lineCogs;
      } else {
        totalRawSales += lt;
        totalRawCogs += lineCogs;
      }
    }

    // AUTO-JURNAL B1, B2, B3, B4
    // 1. Pengakuan Pendapatan: Dr Kas/Bank atau Dr Piutang Usaha; Cr Penjualan Keset (4-1000) & Cr Penjualan Bahan Baku (4-2000)
    // 2. Pengakuan HPP: Dr HPP Keset (5-1000); Cr Persediaan FG (1-1520) & Dr HPP Bahan (5-2000); Cr Persediaan Bahan (1-1500)
    const journalNo = getNextDocNo('JRN-INV', 'journals', 'journal_no');
    const journalLines = [];

    // Bagian Pendapatan & Kas / Piutang
    if (is_cash) {
      const cashAcc = db.prepare('SELECT account_id FROM cash_accounts WHERE id = ?').get(cash_account_id);
      journalLines.push({
        account_id: cashAcc.account_id,
        debit: total,
        credit: 0,
        partner_id: partner_id || null,
        memo: `Penerimaan kas penjualan ${saleNo}`
      });
    } else {
      const accAr = getAccountId('1-1300');
      journalLines.push({
        account_id: accAr,
        debit: total,
        credit: 0,
        partner_id: partner_id,
        memo: `Piutang usaha penjualan ${saleNo}`
      });
    }

    if (disc > 0) {
      const accDisc = getAccountId('4-4000');
      journalLines.push({
        account_id: accDisc,
        debit: disc,
        credit: 0,
        memo: `Diskon penjualan ${saleNo}`
      });
    }

    if (totalFgSales > 0) {
      const accRevFg = getAccountId('4-1000');
      journalLines.push({
        account_id: accRevFg,
        debit: 0,
        credit: totalFgSales,
        memo: `Pendapatan penjualan keset ${saleNo}`
      });
    }

    if (totalRawSales > 0) {
      const accRevRaw = getAccountId('4-2000');
      journalLines.push({
        account_id: accRevRaw,
        debit: 0,
        credit: totalRawSales,
        memo: `Pendapatan penjualan bahan baku ${saleNo}`
      });
    }

    // Bagian HPP & Persediaan
    if (totalFgCogs > 0) {
      const accCogsFg = getAccountId('5-1000');
      const accInvFg  = getAccountId('1-1520');
      journalLines.push({
        account_id: accCogsFg,
        debit: totalFgCogs,
        credit: 0,
        memo: `HPP Keset ${saleNo}`
      });
      journalLines.push({
        account_id: accInvFg,
        debit: 0,
        credit: totalFgCogs,
        memo: `Pengurangan stok barang jadi ${saleNo}`
      });
    }

    if (totalRawCogs > 0) {
      const accCogsRaw = getAccountId('5-2000');
      const accInvRaw  = getAccountId('1-1500');
      journalLines.push({
        account_id: accCogsRaw,
        debit: totalRawCogs,
        credit: 0,
        memo: `HPP Bahan Baku ${saleNo}`
      });
      journalLines.push({
        account_id: accInvRaw,
        debit: 0,
        credit: totalRawCogs,
        memo: `Pengurangan persediaan bahan baku terjual ${saleNo}`
      });
    }

    const jId = createJournalEntry({
      journalNo,
      journalDate: dateStr,
      description: `Auto-jurnal Penjualan Faktur ${saleNo}`,
      sourceTable: 'sales',
      sourceId: saleId,
      lines: journalLines
    });

    db.prepare('UPDATE sales SET journal_id = ? WHERE id = ?').run(jId, saleId);

    db.exec('COMMIT');
    res.json({ success: true, sale_id: saleId, sale_no: saleNo, total });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. PEMBAYARAN & KOMPENSASI (Auto-Jurnal A3, B6, C1)
// ==========================================
app.post('/api/payments', (req, res) => {
  try {
    const { payment_date, direction, partner_id, cash_account_id, amount, sale_id, purchase_id } = req.body;
    const amt = Number(amount);
    if (amt <= 0) return res.status(400).json({ error: 'Jumlah pembayaran harus lebih besar dari 0' });

    db.exec('BEGIN TRANSACTION');

    const payId = crypto.randomUUID();
    const payNo = getNextDocNo(direction === 'IN' ? 'PAY-IN' : 'PAY-OUT', 'payments', 'payment_no');
    const dateStr = payment_date || new Date().toISOString().slice(0, 10);

    db.prepare(`
      INSERT INTO payments (id, payment_no, payment_date, direction, partner_id, cash_account_id, amount, sale_id, purchase_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED')
    `).run(payId, payNo, dateStr, direction, partner_id, cash_account_id, amt, sale_id || null, purchase_id || null);

    const cashAcc = db.prepare('SELECT account_id FROM cash_accounts WHERE id = ?').get(cash_account_id);
    const journalNo = getNextDocNo('JRN-PAY', 'journals', 'journal_no');
    const journalLines = [];

    if (direction === 'IN') {
      // B6: Terima pembayaran piutang dari pelanggan
      // Dr Kas/Bank; Cr 1-1300 Piutang Usaha
      const accAr = getAccountId('1-1300');
      journalLines.push({ account_id: cashAcc.account_id, debit: amt, credit: 0, memo: `Penerimaan kas ${payNo}` });
      journalLines.push({ account_id: accAr, debit: 0, credit: amt, partner_id, memo: `Pelunasan piutang mitra ${payNo}` });

      if (sale_id) {
        db.prepare('UPDATE sales SET paid_amount = paid_amount + ?, payment_status = CASE WHEN paid_amount + ? >= total THEN \'PAID\' ELSE \'PARTIAL\' END WHERE id = ?').run(amt, amt, sale_id);
      }
    } else {
      // A3: Bayar utang ke pemasok
      // Dr 2-1100 Utang Usaha; Cr Kas/Bank
      const accAp = getAccountId('2-1100');
      journalLines.push({ account_id: accAp, debit: amt, credit: 0, partner_id, memo: `Pembayaran utang mitra ${payNo}` });
      journalLines.push({ account_id: cashAcc.account_id, debit: 0, credit: amt, memo: `Pengeluaran kas bayar utang ${payNo}` });

      if (purchase_id) {
        db.prepare('UPDATE purchases SET paid_amount = paid_amount + ?, payment_status = CASE WHEN paid_amount + ? >= total THEN \'PAID\' ELSE \'PARTIAL\' END WHERE id = ?').run(amt, amt, purchase_id);
      }
    }

    const jId = createJournalEntry({
      journalNo,
      journalDate: dateStr,
      description: `Auto-jurnal Pembayaran ${payNo}`,
      sourceTable: 'payments',
      sourceId: payId,
      lines: journalLines
    });

    db.prepare('UPDATE payments SET journal_id = ? WHERE id = ?').run(jId, payId);

    db.exec('COMMIT');
    res.json({ success: true, payment_id: payId, payment_no: payNo });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// C1: Kompensasi (Netting) Piutang vs Utang Mitra yang Sama
app.post('/api/partner-nettings', (req, res) => {
  try {
    const { netting_date, partner_id, sale_id, purchase_id, amount } = req.body;
    const amt = Number(amount);
    if (amt <= 0) return res.status(400).json({ error: 'Nilai kompensasi netting harus > 0' });

    db.exec('BEGIN TRANSACTION');

    const netId = crypto.randomUUID();
    const netNo = getNextDocNo('NET', 'partner_nettings', 'netting_no');
    const dateStr = netting_date || new Date().toISOString().slice(0, 10);

    db.prepare(`
      INSERT INTO partner_nettings (id, netting_no, netting_date, partner_id, amount, status)
      VALUES (?, ?, ?, ?, ?, 'POSTED')
    `).run(netId, netNo, dateStr, partner_id, amt);

    db.prepare(`
      INSERT INTO partner_netting_lines (id, netting_id, sale_id, purchase_id, amount)
      VALUES (?, ?, ?, NULL, ?)
    `).run(crypto.randomUUID(), netId, sale_id, amt);

    db.prepare(`
      INSERT INTO partner_netting_lines (id, netting_id, sale_id, purchase_id, amount)
      VALUES (?, ?, NULL, ?, ?)
    `).run(crypto.randomUUID(), netId, purchase_id, amt);

    // Update paid_amount di sales dan purchases
    db.prepare('UPDATE sales SET paid_amount = paid_amount + ?, payment_status = CASE WHEN paid_amount + ? >= total THEN \'PAID\' ELSE \'PARTIAL\' END WHERE id = ?').run(amt, amt, sale_id);
    db.prepare('UPDATE purchases SET paid_amount = paid_amount + ?, payment_status = CASE WHEN paid_amount + ? >= total THEN \'PAID\' ELSE \'PARTIAL\' END WHERE id = ?').run(amt, amt, purchase_id);

    // Auto-jurnal C1: Dr 2-1100 Utang Usaha; Cr 1-1300 Piutang Usaha
    const accAp = getAccountId('2-1100');
    const accAr = getAccountId('1-1300');
    const journalNo = getNextDocNo('JRN-NET', 'journals', 'journal_no');

    const jId = createJournalEntry({
      journalNo,
      journalDate: dateStr,
      description: `Kompensasi (Netting) Piutang-Utang ${netNo}`,
      sourceTable: 'partner_nettings',
      sourceId: netId,
      lines: [
        { account_id: accAp, debit: amt, credit: 0, partner_id, memo: `Netting pelunasan utang ${netNo}` },
        { account_id: accAr, debit: 0, credit: amt, partner_id, memo: `Netting pelunasan piutang ${netNo}` }
      ]
    });

    db.prepare('UPDATE partner_nettings SET journal_id = ? WHERE id = ?').run(jId, netId);

    db.exec('COMMIT');
    res.json({ success: true, netting_id: netId, netting_no: netNo });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 6. PRODUKSI BORONGAN: SPK TIKET KERJA (Auto-Jurnal D1, D2, D3, D4, D5)
// ==========================================
app.get('/api/work-tickets', (req, res) => {
  try {
    const tickets = db.prepare(`
      SELECT t.*, w.name as worker_name, i.name as target_item_name, i.sku as target_item_sku,
        COALESCE((SELECT SUM(qty_pass) FROM work_receipts WHERE ticket_id = t.id), 0) as total_pass,
        COALESCE((SELECT SUM(qty_rework) FROM work_receipts WHERE ticket_id = t.id), 0) as total_rework,
        COALESCE((SELECT SUM(qty_reject) FROM work_receipts WHERE ticket_id = t.id), 0) as total_reject
      FROM work_tickets t
      JOIN workers w ON w.id = t.worker_id
      JOIN items i ON i.id = t.target_item_id
      ORDER BY t.issue_date DESC, t.ticket_no DESC
    `).all();

    // Dapatkan data issues, receipts, returns, variances per tiket
    const issues = db.prepare(`
      SELECT ti.*, i.name as material_name, i.sku as material_sku, u.code as unit_code
      FROM work_ticket_issues ti
      JOIN items i ON i.id = ti.material_id
      JOIN units u ON u.id = i.unit_id
    `).all();

    const receipts = db.prepare(`
      SELECT wr.*, j.journal_no
      FROM work_receipts wr
      LEFT JOIN journals j ON j.id = wr.journal_id
    `).all();

    const returns = db.prepare(`
      SELECT tr.*, i.name as material_name, u.code as unit_code
      FROM work_ticket_returns tr
      JOIN items i ON i.id = tr.material_id
      JOIN units u ON u.id = i.unit_id
    `).all();

    const variances = db.prepare(`
      SELECT mv.*, i.name as material_name, u.code as unit_code
      FROM material_variances mv
      JOIN items i ON i.id = mv.material_id
      JOIN units u ON u.id = i.unit_id
    `).all();

    const issueMap = {}, receiptMap = {}, returnMap = {}, varMap = {};
    for (const is of issues) {
      if (!issueMap[is.ticket_id]) issueMap[is.ticket_id] = [];
      issueMap[is.ticket_id].push(is);
    }
    for (const rc of receipts) {
      if (!receiptMap[rc.ticket_id]) receiptMap[rc.ticket_id] = [];
      receiptMap[rc.ticket_id].push(rc);
    }
    for (const rt of returns) {
      if (!returnMap[rt.ticket_id]) returnMap[rt.ticket_id] = [];
      returnMap[rt.ticket_id].push(rt);
    }
    for (const v of variances) {
      if (!varMap[v.ticket_id]) varMap[v.ticket_id] = [];
      varMap[v.ticket_id].push(v);
    }

    const result = tickets.map(t => ({
      ...t,
      issues: issueMap[t.id] || [],
      receipts: receiptMap[t.id] || [],
      returns: returnMap[t.id] || [],
      variances: varMap[t.id] || []
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Buka Tiket Kerja Baru
app.post('/api/work-tickets', (req, res) => {
  try {
    const { worker_id, target_item_id, target_qty, issue_date, due_date, bom_id, note } = req.body;
    const ticketId = crypto.randomUUID();
    const ticketNo = getNextDocNo('SPK', 'work_tickets', 'ticket_no');
    const dateStr = issue_date || new Date().toISOString().slice(0, 10);

    db.prepare(`
      INSERT INTO work_tickets (id, ticket_no, worker_id, target_item_id, target_qty, issue_date, due_date, bom_id, status, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
    `).run(ticketId, ticketNo, worker_id, target_item_id, Number(target_qty), dateStr, due_date || null, bom_id || null, note || null);

    res.json({ success: true, ticket_id: ticketId, ticket_no: ticketNo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// D1: Serah Bahan Baku ke Pekerja (WIP)
app.post('/api/work-tickets/:id/issue', (req, res) => {
  try {
    const ticketId = req.params.id;
    const { material_id, qty, issue_date } = req.body;
    const q = Number(qty);
    if (q <= 0) return res.status(400).json({ error: 'Kuantitas bahan harus > 0' });

    db.exec('BEGIN TRANSACTION');

    const ticket = db.prepare('SELECT * FROM work_tickets WHERE id = ?').get(ticketId);
    if (!ticket) throw new Error('Tiket SPK tidak ditemukan');
    if (ticket.status !== 'OPEN') throw new Error('Tiket sudah ditutup atau dibatalkan');

    // Cek ketersediaan stok & unit cost di gudang RAW_WH
    const rawStock = db.prepare("SELECT qty, avg_cost FROM stock_balances WHERE item_id = ? AND location = 'RAW_WH'").get(material_id);
    const available = rawStock ? Number(rawStock.qty) : 0;
    const rawCost = rawStock ? Number(rawStock.avg_cost) : 0;

    if (available < q) {
      throw new Error(`Stok bahan baku di gudang tidak mencukupi (Tersedia: ${available}, Dibutuhkan: ${q})`);
    }

    const dateStr = issue_date || new Date().toISOString().slice(0, 10);
    const issueId = crypto.randomUUID();

    // Simpan issue
    db.prepare(`
      INSERT INTO work_ticket_issues (id, ticket_id, issue_date, material_id, qty, unit_cost, status)
      VALUES (?, ?, ?, ?, ?, ?, 'POSTED')
    `).run(issueId, ticketId, dateStr, material_id, q, rawCost);

    // Kurangi stok di RAW_WH
    updateStockBalance(material_id, 'RAW_WH', null, -q, rawCost);
    recordStockMovement({
      movementDate: dateStr,
      itemId: material_id,
      location: 'RAW_WH',
      qtyOut: q,
      unitCost: rawCost,
      movementType: 'ISSUE_TO_WORKER',
      sourceTable: 'work_ticket_issues',
      sourceId: issueId,
      note: `Serah bahan ke pekerja SPK ${ticket.ticket_no}`
    });

    // Tambah stok di WORKER (WIP pekerja)
    updateStockBalance(material_id, 'WORKER', ticket.worker_id, q, rawCost);
    recordStockMovement({
      movementDate: dateStr,
      itemId: material_id,
      location: 'WORKER',
      workerId: ticket.worker_id,
      qtyIn: q,
      unitCost: rawCost,
      movementType: 'ISSUE_TO_WORKER',
      sourceTable: 'work_ticket_issues',
      sourceId: issueId,
      note: `Penerimaan bahan kerja SPK ${ticket.ticket_no}`
    });

    // AUTO-JURNAL D1:
    // Dr 1-1510 Persediaan Bahan di Pekerja (WIP); Cr 1-1500 Persediaan Bahan Baku (qty x rawCost)
    const totalIssueCost = q * rawCost;
    const accWip = getAccountId('1-1510');
    const accRaw = getAccountId('1-1500');
    const journalNo = getNextDocNo('JRN-ISS', 'journals', 'journal_no');

    const jId = createJournalEntry({
      journalNo,
      journalDate: dateStr,
      description: `Serah Bahan ke Pekerja SPK ${ticket.ticket_no}`,
      sourceTable: 'work_ticket_issues',
      sourceId: issueId,
      lines: [
        { account_id: accWip, debit: totalIssueCost, credit: 0, worker_id: ticket.worker_id, memo: `Bahan di pekerja SPK ${ticket.ticket_no}` },
        { account_id: accRaw, debit: 0, credit: totalIssueCost, memo: `Pengeluaran bahan dari gudang SPK ${ticket.ticket_no}` }
      ]
    });

    db.prepare('UPDATE work_ticket_issues SET journal_id = ? WHERE id = ?').run(jId, issueId);

    db.exec('COMMIT');
    res.json({ success: true, issue_id: issueId, total_cost: totalIssueCost });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// D2: Setor Hasil Jadi Lolos QC & Hitung Upah Borongan
app.post('/api/work-tickets/:id/receipt', (req, res) => {
  try {
    const ticketId = req.params.id;
    const { qty_pass, qty_rework, qty_reject, receipt_date } = req.body;
    const pass = Number(qty_pass) || 0;
    const rework = Number(qty_rework) || 0;
    const reject = Number(qty_reject) || 0;

    if (pass <= 0 && rework <= 0) {
      return res.status(400).json({ error: 'Jumlah lolos atau rework harus > 0' });
    }

    db.exec('BEGIN TRANSACTION');

    const ticket = db.prepare('SELECT * FROM work_tickets WHERE id = ?').get(ticketId);
    if (!ticket) throw new Error('Tiket tidak ditemukan');

    // Cari tarif upah borongan
    const rateRow = db.prepare(`
      SELECT rate_pass, rate_rework FROM piece_rates
      WHERE item_id = ? AND (worker_id = ? OR worker_id IS NULL)
      ORDER BY worker_id DESC, valid_from DESC LIMIT 1
    `).get(ticket.target_item_id, ticket.worker_id);

    const ratePass = rateRow ? Number(rateRow.rate_pass) : 0;
    const rateRework = rateRow ? Number(rateRow.rate_rework) : 0;
    const wageAmount = (pass * ratePass) + (rework * rateRework);

    // Hitung standar biaya bahan baku dari BOM
    const bom = db.prepare('SELECT id FROM boms WHERE finished_item_id = ? AND is_active = 1').get(ticket.target_item_id);
    if (!bom) throw new Error('Resep BOM untuk barang jadi ini belum dikonfigurasi!');

    const bomLines = db.prepare('SELECT material_id, qty_per_unit FROM bom_lines WHERE bom_id = ?').all(bom.id);

    let totalMaterialCost = 0;
    const dateStr = receipt_date || new Date().toISOString().slice(0, 10);

    // Untuk setiap bahan di BOM, kurangi WIP pekerja sebanyak: (pass + rework + reject) * bomLine.qty_per_unit
    for (const bl of bomLines) {
      const neededQty = (pass + rework + reject) * Number(bl.qty_per_unit);

      // Cari avg_cost di tangan pekerja
      const workerStock = db.prepare("SELECT qty, avg_cost FROM stock_balances WHERE item_id = ? AND location = 'WORKER' AND worker_id = ?").get(bl.material_id, ticket.worker_id);
      const workerAvgCost = workerStock ? Number(workerStock.avg_cost) : 0;
      const matLineCost = neededQty * workerAvgCost;
      totalMaterialCost += matLineCost;

      // Kurangi WIP di pekerja
      updateStockBalance(bl.material_id, 'WORKER', ticket.worker_id, -neededQty, workerAvgCost);
      recordStockMovement({
        movementDate: dateStr,
        itemId: bl.material_id,
        location: 'WORKER',
        workerId: ticket.worker_id,
        qtyOut: neededQty,
        unitCost: workerAvgCost,
        movementType: 'RECEIPT_FG',
        sourceTable: 'work_receipts',
        sourceId: ticketId,
        note: `Bahan terpakai produksi setoran SPK ${ticket.ticket_no}`
      });
    }

    // Biaya per unit FG = (totalMaterialCost + wageAmount) / pass
    const fgUnitCost = pass > 0 ? ((totalMaterialCost + wageAmount) / pass) : 0;

    // Tambah stok Barang Jadi di FG_WH
    if (pass > 0) {
      updateStockBalance(ticket.target_item_id, 'FG_WH', null, pass, fgUnitCost);
      recordStockMovement({
        movementDate: dateStr,
        itemId: ticket.target_item_id,
        location: 'FG_WH',
        qtyIn: pass,
        unitCost: fgUnitCost,
        movementType: 'RECEIPT_FG',
        sourceTable: 'work_receipts',
        sourceId: ticketId,
        note: `Setor hasil jadi lolos QC SPK ${ticket.ticket_no}`
      });
    }

    const receiptId = crypto.randomUUID();
    const receiptNo = getNextDocNo('RCV', 'work_receipts', 'receipt_no');

    db.prepare(`
      INSERT INTO work_receipts (id, receipt_no, ticket_id, receipt_date, qty_pass, qty_rework, qty_reject, rate_pass, rate_rework, wage_amount, material_cost, fg_unit_cost, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED')
    `).run(receiptId, receiptNo, ticketId, dateStr, pass, rework, reject, ratePass, rateRework, wageAmount, totalMaterialCost, fgUnitCost);

    // AUTO-JURNAL D2:
    // Dr 1-1520 Persediaan Barang Jadi (material_cost + wage_amount);
    // Cr 1-1510 Persediaan Bahan di Pekerja (material_cost);
    // Cr 2-1200 Utang Upah Borongan (wage_amount)
    const accFgInv = getAccountId('1-1520');
    const accWip   = getAccountId('1-1510');
    const accWagePayable = getAccountId('2-1200');
    const journalNo = getNextDocNo('JRN-RCV', 'journals', 'journal_no');

    const journalLines = [
      {
        account_id: accFgInv,
        debit: totalMaterialCost + wageAmount,
        credit: 0,
        memo: `Persediaan barang jadi lolos QC ${receiptNo}`
      },
      {
        account_id: accWip,
        debit: 0,
        credit: totalMaterialCost,
        worker_id: ticket.worker_id,
        memo: `Bahan terpakai produksi ${receiptNo}`
      },
      {
        account_id: accWagePayable,
        debit: 0,
        credit: wageAmount,
        worker_id: ticket.worker_id,
        memo: `Utang upah borongan pekerja ${receiptNo}`
      }
    ];

    const jId = createJournalEntry({
      journalNo,
      journalDate: dateStr,
      description: `Setoran Hasil QC & Upah SPK ${ticket.ticket_no}`,
      sourceTable: 'work_receipts',
      sourceId: receiptId,
      lines: journalLines
    });

    db.prepare('UPDATE work_receipts SET journal_id = ? WHERE id = ?').run(jId, receiptId);

    db.exec('COMMIT');
    res.json({
      success: true,
      receipt_id: receiptId,
      receipt_no: receiptNo,
      wage_amount: wageAmount,
      fg_unit_cost: fgUnitCost
    });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// D3: Kembalikan Sisa Bahan dari Pekerja ke Gudang
app.post('/api/work-tickets/:id/return', (req, res) => {
  try {
    const ticketId = req.params.id;
    const { material_id, qty, return_date } = req.body;
    const q = Number(qty);
    if (q <= 0) return res.status(400).json({ error: 'Kuantitas retur sisa bahan harus > 0' });

    db.exec('BEGIN TRANSACTION');

    const ticket = db.prepare('SELECT * FROM work_tickets WHERE id = ?').get(ticketId);
    if (!ticket) throw new Error('Tiket tidak ditemukan');

    // Dapatkan avg_cost di pekerja
    const workerStock = db.prepare("SELECT qty, avg_cost FROM stock_balances WHERE item_id = ? AND location = 'WORKER' AND worker_id = ?").get(material_id, ticket.worker_id);
    const workerCost = workerStock ? Number(workerStock.avg_cost) : 0;
    const dateStr = return_date || new Date().toISOString().slice(0, 10);
    const returnId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO work_ticket_returns (id, ticket_id, return_date, material_id, qty, unit_cost, status)
      VALUES (?, ?, ?, ?, ?, ?, 'POSTED')
    `).run(returnId, ticketId, dateStr, material_id, q, workerCost);

    // Kurangi stok di WORKER
    updateStockBalance(material_id, 'WORKER', ticket.worker_id, -q, workerCost);
    // Tambah stok kembali ke RAW_WH
    updateStockBalance(material_id, 'RAW_WH', null, q, workerCost);

    // AUTO-JURNAL D3:
    // Dr 1-1500 Persediaan Bahan Baku; Cr 1-1510 Persediaan Bahan di Pekerja
    const totalReturnCost = q * workerCost;
    const accRaw = getAccountId('1-1500');
    const accWip = getAccountId('1-1510');
    const journalNo = getNextDocNo('JRN-RET', 'journals', 'journal_no');

    const jId = createJournalEntry({
      journalNo,
      journalDate: dateStr,
      description: `Kembalikan Sisa Bahan SPK ${ticket.ticket_no}`,
      sourceTable: 'work_ticket_returns',
      sourceId: returnId,
      lines: [
        { account_id: accRaw, debit: totalReturnCost, credit: 0, memo: `Retur sisa bahan ke gudang SPK ${ticket.ticket_no}` },
        { account_id: accWip, debit: 0, credit: totalReturnCost, worker_id: ticket.worker_id, memo: `Bahan kembali dari pekerja SPK ${ticket.ticket_no}` }
      ]
    });

    db.prepare('UPDATE work_ticket_returns SET journal_id = ? WHERE id = ?').run(jId, returnId);

    db.exec('COMMIT');
    res.json({ success: true, return_id: returnId });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// Tutup Tiket & Analisis Susut/Varian Bahan (D4 & D5)
app.post('/api/work-tickets/:id/close', (req, res) => {
  try {
    const ticketId = req.params.id;
    db.exec('BEGIN TRANSACTION');

    const ticket = db.prepare('SELECT * FROM work_tickets WHERE id = ?').get(ticketId);
    if (!ticket) throw new Error('Tiket tidak ditemukan');
    if (ticket.status === 'CLOSED') throw new Error('Tiket sudah berstatus CLOSED');

    // Total hasil jadi (pass + reject)
    const receiptStats = db.prepare(`
      SELECT COALESCE(SUM(qty_pass), 0) as pass, COALESCE(SUM(qty_reject), 0) as reject
      FROM work_receipts WHERE ticket_id = ?
    `).get(ticketId);

    const totalProduced = Number(receiptStats.pass) + Number(receiptStats.reject);

    // BOM
    const bom = db.prepare('SELECT id FROM boms WHERE finished_item_id = ? AND is_active = 1').get(ticket.target_item_id);
    const bomLines = bom ? db.prepare('SELECT material_id, qty_per_unit FROM bom_lines WHERE bom_id = ?').all(bom.id) : [];

    // Periksa per bahan
    const variancesCreated = [];

    for (const bl of bomLines) {
      const mat = db.prepare('SELECT shrink_tolerance_pct FROM items WHERE id = ?').get(bl.material_id);
      const tolPct = mat ? Number(mat.shrink_tolerance_pct) : 0;

      const issued = db.prepare('SELECT COALESCE(SUM(qty), 0) as q FROM work_ticket_issues WHERE ticket_id = ? AND material_id = ?').get(ticketId, bl.material_id).q;
      const returned = db.prepare('SELECT COALESCE(SUM(qty), 0) as q FROM work_ticket_returns WHERE ticket_id = ? AND material_id = ?').get(ticketId, bl.material_id).q;

      const standardQty = totalProduced * Number(bl.qty_per_unit);
      const toleranceQty = standardQty * (tolPct / 100);
      const varianceQty = issued - returned - standardQty; // positif = boros/selisih
      const excessQty = Math.max(0, varianceQty - toleranceQty);

      const workerStock = db.prepare("SELECT avg_cost FROM stock_balances WHERE item_id = ? AND location = 'WORKER' AND worker_id = ?").get(bl.material_id, ticket.worker_id);
      const workerCost = workerStock ? Number(workerStock.avg_cost) : 0;

      const varId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO material_variances (id, ticket_id, material_id, issued_qty, returned_qty, standard_qty, tolerance_qty, variance_qty, excess_qty, unit_cost, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        varId,
        ticketId,
        bl.material_id,
        issued,
        returned,
        standardQty,
        toleranceQty,
        varianceQty,
        excessQty,
        workerCost,
        excessQty > 0 ? 'PENDING' : 'APPROVED'
      );

      variancesCreated.push({ material_id: bl.material_id, varianceQty, excessQty });
    }

    db.prepare("UPDATE work_tickets SET status = 'CLOSED', closed_at = datetime('now') WHERE id = ?").run(ticketId);

    db.exec('COMMIT');
    res.json({ success: true, variances: variancesCreated });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// D5: Persetujuan Selisih Bahan (Approve Excess Variance) -> Masuk Beban Selisih Bahan
app.post('/api/material-variances/:id/approve', (req, res) => {
  try {
    const varId = req.params.id;
    db.exec('BEGIN TRANSACTION');

    const mv = db.prepare('SELECT mv.*, wt.ticket_no, wt.worker_id FROM material_variances mv JOIN work_tickets wt ON wt.id = mv.ticket_id WHERE mv.id = ?').get(varId);
    if (!mv) throw new Error('Data varian tidak ditemukan');
    if (mv.status !== 'PENDING') throw new Error('Status bukan PENDING');

    const excessCost = Number(mv.excess_qty) * Number(mv.unit_cost);
    let jId = null;

    if (excessCost > 0) {
      // Kurangi sisa WIP di pekerja
      updateStockBalance(mv.material_id, 'WORKER', mv.worker_id, -Number(mv.excess_qty), Number(mv.unit_cost));

      // AUTO-JURNAL D5:
      // Dr 5-4000 Beban Selisih Bahan; Cr 1-1510 Persediaan Bahan di Pekerja
      const accLoss = getAccountId('5-4000');
      const accWip  = getAccountId('1-1510');
      const journalNo = getNextDocNo('JRN-VAR', 'journals', 'journal_no');

      jId = createJournalEntry({
        journalNo,
        journalDate: new Date().toISOString().slice(0, 10),
        description: `Beban Selisih Bahan SPK ${mv.ticket_no}`,
        sourceTable: 'material_variances',
        sourceId: varId,
        lines: [
          { account_id: accLoss, debit: excessCost, credit: 0, memo: `Beban selisih bahan di atas toleransi SPK ${mv.ticket_no}` },
          { account_id: accWip, debit: 0, credit: excessCost, worker_id: mv.worker_id, memo: `Penyesuaian WIP pekerja SPK ${mv.ticket_no}` }
        ]
      });
    }

    db.prepare("UPDATE material_variances SET status = 'APPROVED', approved_at = datetime('now'), journal_id = ? WHERE id = ?").run(jId, varId);

    db.exec('COMMIT');
    res.json({ success: true, excess_cost: excessCost });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 7. PENGGAJIAN & KASBON (Auto-Jurnal E1 & E2)
// ==========================================
app.get('/api/wage-slips', (req, res) => {
  try {
    const slips = db.prepare(`
      SELECT ws.*, w.name as worker_name, ca.name as cash_account_name, j.journal_no
      FROM wage_slips ws
      JOIN workers w ON w.id = ws.worker_id
      LEFT JOIN cash_accounts ca ON ca.id = ws.cash_account_id
      LEFT JOIN journals j ON j.id = ws.journal_id
      ORDER BY ws.paid_date DESC, ws.slip_no DESC
    `).all();

    res.json(slips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// E1: Beri Kasbon ke Pekerja
app.post('/api/worker-advances', (req, res) => {
  try {
    const { worker_id, cash_account_id, amount, advance_date, note } = req.body;
    const amt = Number(amount);
    if (amt <= 0) return res.status(400).json({ error: 'Jumlah kasbon harus > 0' });

    db.exec('BEGIN TRANSACTION');

    const advId = crypto.randomUUID();
    const advNo = getNextDocNo('ADV', 'worker_advances', 'advance_no');
    const dateStr = advance_date || new Date().toISOString().slice(0, 10);

    db.prepare(`
      INSERT INTO worker_advances (id, advance_no, advance_date, worker_id, cash_account_id, amount, status)
      VALUES (?, ?, ?, ?, ?, ?, 'POSTED')
    `).run(advId, advNo, dateStr, worker_id, cash_account_id, amt);

    // AUTO-JURNAL E1:
    // Dr 1-1400 Piutang Karyawan (Kasbon); Cr Kas/Bank
    const accAdvance = getAccountId('1-1400');
    const cashAcc = db.prepare('SELECT account_id FROM cash_accounts WHERE id = ?').get(cash_account_id);
    const journalNo = getNextDocNo('JRN-ADV', 'journals', 'journal_no');

    const jId = createJournalEntry({
      journalNo,
      journalDate: dateStr,
      description: `Pemberian Kasbon Pekerja ${advNo}`,
      sourceTable: 'worker_advances',
      sourceId: advId,
      lines: [
        { account_id: accAdvance, debit: amt, credit: 0, worker_id, memo: `Kasbon pekerja ${advNo}` },
        { account_id: cashAcc.account_id, debit: 0, credit: amt, memo: `Pengeluaran kas kasbon ${advNo}` }
      ]
    });

    db.prepare('UPDATE worker_advances SET journal_id = ? WHERE id = ?').run(jId, advId);

    db.exec('COMMIT');
    res.json({ success: true, advance_id: advId, advance_no: advNo });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// E2: Bayar Slip Upah Borongan
app.post('/api/wage-slips', (req, res) => {
  try {
    const { worker_id, period_start, period_end, cash_account_id, advance_deduct, receipt_ids } = req.body;
    if (!receipt_ids || receipt_ids.length === 0) {
      return res.status(400).json({ error: 'Pilih setoran hasil kerja yang akan dibayar pada slip ini' });
    }

    db.exec('BEGIN TRANSACTION');

    // Hitung total upah kotor (gross_wage) dari receipt yang dipilih
    let grossWage = 0;
    for (const rId of receipt_ids) {
      const rc = db.prepare('SELECT wage_amount FROM work_receipts WHERE id = ?').get(rId);
      if (rc) grossWage += Number(rc.wage_amount);
    }

    const deduct = Number(advance_deduct) || 0;
    const netPaid = grossWage - deduct;

    if (netPaid < 0) {
      throw new Error(`Potongan kasbon (${deduct}) tidak boleh melebihi upah kotor (${grossWage})`);
    }

    const slipId = crypto.randomUUID();
    const slipNo = getNextDocNo('SLIP', 'wage_slips', 'slip_no');
    const today = new Date().toISOString().slice(0, 10);

    db.prepare(`
      INSERT INTO wage_slips (id, slip_no, worker_id, period_start, period_end, gross_wage, advance_deduct, net_paid, cash_account_id, paid_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED')
    `).run(slipId, slipNo, worker_id, period_start || today, period_end || today, grossWage, deduct, netPaid, cash_account_id, today);

    // Hubungkan receipt ke slip
    for (const rId of receipt_ids) {
      db.prepare('INSERT INTO wage_slip_receipts (slip_id, receipt_id) VALUES (?, ?)').run(slipId, rId);
    }

    // AUTO-JURNAL E2:
    // Dr 2-1200 Utang Upah Borongan (grossWage);
    // Cr Kas/Bank (netPaid);
    // Cr 1-1400 Piutang Karyawan/Kasbon (deduct, jika ada)
    const accWagePayable = getAccountId('2-1200');
    const accAdvance     = getAccountId('1-1400');
    const cashAcc = db.prepare('SELECT account_id FROM cash_accounts WHERE id = ?').get(cash_account_id);
    const journalNo = getNextDocNo('JRN-SLIP', 'journals', 'journal_no');

    const journalLines = [
      {
        account_id: accWagePayable,
        debit: grossWage,
        credit: 0,
        worker_id,
        memo: `Pelunasan utang upah slip ${slipNo}`
      },
      {
        account_id: cashAcc.account_id,
        debit: 0,
        credit: netPaid,
        memo: `Pembayaran upah netto slip ${slipNo}`
      }
    ];

    if (deduct > 0) {
      journalLines.push({
        account_id: accAdvance,
        debit: 0,
        credit: deduct,
        worker_id,
        memo: `Potongan kasbon pada slip ${slipNo}`
      });
    }

    const jId = createJournalEntry({
      journalNo,
      journalDate: today,
      description: `Pembayaran Upah Borongan Slip ${slipNo}`,
      sourceTable: 'wage_slips',
      sourceId: slipId,
      lines: journalLines
    });

    db.prepare('UPDATE wage_slips SET journal_id = ? WHERE id = ?').run(jId, slipId);

    db.exec('COMMIT');
    res.json({ success: true, slip_id: slipId, slip_no: slipNo, gross_wage: grossWage, net_paid: netPaid });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// Ambil setoran pekerja yang belum dibuatkan slip upah
app.get('/api/workers/:id/unpaid-receipts', (req, res) => {
  try {
    const workerId = req.params.id;
    const receipts = db.prepare(`
      SELECT wr.*, wt.ticket_no, i.name as target_item_name
      FROM work_receipts wr
      JOIN work_tickets wt ON wt.id = wr.ticket_id
      JOIN items i ON i.id = wt.target_item_id
      WHERE wt.worker_id = ?
        AND wr.id NOT IN (SELECT receipt_id FROM wage_slip_receipts)
      ORDER BY wr.receipt_date ASC
    `).all(workerId);

    res.json(receipts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 8. KAS OPERASIONAL & PENYESUAIAN (Auto-Jurnal F1, F2, F3)
// ==========================================
app.get('/api/cash-transactions', (req, res) => {
  try {
    const list = db.prepare(`
      SELECT ct.*, ca.name as cash_account_name, a.code as counter_account_code, a.name as counter_account_name, j.journal_no
      FROM cash_transactions ct
      JOIN cash_accounts ca ON ca.id = ct.cash_account_id
      JOIN accounts a ON a.id = ct.counter_account_id
      LEFT JOIN journals j ON j.id = ct.journal_id
      ORDER BY ct.trx_date DESC, ct.trx_no DESC
    `).all();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cash-transactions', (req, res) => {
  try {
    const { trx_date, cash_account_id, direction, counter_account_id, amount, description } = req.body;
    const amt = Number(amount);
    if (amt <= 0) return res.status(400).json({ error: 'Nominal transaksi kas harus > 0' });

    db.exec('BEGIN TRANSACTION');

    const trxId = crypto.randomUUID();
    const trxNo = getNextDocNo(direction === 'IN' ? 'KAS-IN' : 'KAS-OUT', 'cash_transactions', 'trx_no');
    const dateStr = trx_date || new Date().toISOString().slice(0, 10);

    db.prepare(`
      INSERT INTO cash_transactions (id, trx_no, trx_date, cash_account_id, direction, counter_account_id, amount, description, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'POSTED')
    `).run(trxId, trxNo, dateStr, cash_account_id, direction, counter_account_id, amt, description || null);

    const cashAcc = db.prepare('SELECT account_id FROM cash_accounts WHERE id = ?').get(cash_account_id);
    const journalNo = getNextDocNo('JRN-KAS', 'journals', 'journal_no');
    const journalLines = [];

    if (direction === 'OUT') {
      // F1 / F3: Beban / Prive (Dr Counter Account; Cr Kas/Bank)
      journalLines.push({ account_id: counter_account_id, debit: amt, credit: 0, memo: description || `Kas keluar ${trxNo}` });
      journalLines.push({ account_id: cashAcc.account_id, debit: 0, credit: amt, memo: `Pengeluaran ${trxNo}` });
    } else {
      // F2: Setor Modal / Pendapatan Lain (Dr Kas/Bank; Cr Counter Account)
      journalLines.push({ account_id: cashAcc.account_id, debit: amt, credit: 0, memo: `Penerimaan kas ${trxNo}` });
      journalLines.push({ account_id: counter_account_id, debit: 0, credit: amt, memo: description || `Kas masuk ${trxNo}` });
    }

    const jId = createJournalEntry({
      journalNo,
      journalDate: dateStr,
      description: `Transaksi Kas: ${description || trxNo}`,
      sourceTable: 'cash_transactions',
      sourceId: trxId,
      lines: journalLines
    });

    db.prepare('UPDATE cash_transactions SET journal_id = ? WHERE id = ?').run(jId, trxId);

    db.exec('COMMIT');
    res.json({ success: true, trx_id: trxId, trx_no: trxNo });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 9. LAPORAN KEUANGAN (SAK EMKM) & LAPORAN OPERASIONAL
// ==========================================

// Jurnal Umum
app.get('/api/reports/journals', (req, res) => {
  try {
    const journals = db.prepare(`
      SELECT j.*,
        (SELECT SUM(debit) FROM journal_lines WHERE journal_id = j.id) as total_debit,
        (SELECT SUM(credit) FROM journal_lines WHERE journal_id = j.id) as total_credit
      FROM journals j
      ORDER BY j.journal_date DESC, j.journal_no DESC
    `).all();

    const lines = db.prepare(`
      SELECT jl.*, a.code as account_code, a.name as account_name,
        p.name as partner_name, w.name as worker_name
      FROM journal_lines jl
      JOIN accounts a ON a.id = jl.account_id
      LEFT JOIN partners p ON p.id = jl.partner_id
      LEFT JOIN workers w ON w.id = jl.worker_id
    `).all();

    const lineMap = {};
    for (const l of lines) {
      if (!lineMap[l.journal_id]) lineMap[l.journal_id] = [];
      lineMap[l.journal_id].push(l);
    }

    const result = journals.map(j => ({
      ...j,
      lines: lineMap[j.id] || []
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Neraca Saldo (Trial Balance)
app.get('/api/reports/trial-balance', (req, res) => {
  try {
    const list = db.prepare(`
      SELECT a.code, a.name, a.type,
        COALESCE(SUM(jl.debit), 0) as total_debit,
        COALESCE(SUM(jl.credit), 0) as total_credit,
        CASE
          WHEN a.type IN ('ASSET', 'COGS', 'EXPENSE') THEN COALESCE(SUM(jl.debit - jl.credit), 0)
          ELSE COALESCE(SUM(jl.credit - jl.debit), 0)
        END as ending_balance
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id
      WHERE a.is_postable = 1
      GROUP BY a.id, a.code, a.name, a.type
      HAVING total_debit > 0 OR total_credit > 0
      ORDER BY a.code ASC
    `).all();

    const sumDebit = list.reduce((acc, row) => acc + row.total_debit, 0);
    const sumCredit = list.reduce((acc, row) => acc + row.total_credit, 0);

    res.json({ accounts: list, total_debit: sumDebit, total_credit: sumCredit, is_balanced: Math.abs(sumDebit - sumCredit) < 0.01 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Laporan Laba Rugi
app.get('/api/reports/income-statement', (req, res) => {
  try {
    // 1. Pendapatan (REVENUE)
    const revenues = db.prepare(`
      SELECT a.code, a.name,
        COALESCE(SUM(jl.credit - jl.debit), 0) as amount
      FROM accounts a
      JOIN journal_lines jl ON jl.account_id = a.id
      WHERE a.type = 'REVENUE'
      GROUP BY a.id, a.code, a.name
      ORDER BY a.code ASC
    `).all();

    const totalRevenue = revenues.reduce((acc, r) => acc + r.amount, 0);

    // 2. Harga Pokok Penjualan (COGS)
    const cogs = db.prepare(`
      SELECT a.code, a.name,
        COALESCE(SUM(jl.debit - jl.credit), 0) as amount
      FROM accounts a
      JOIN journal_lines jl ON jl.account_id = a.id
      WHERE a.type = 'COGS'
      GROUP BY a.id, a.code, a.name
      ORDER BY a.code ASC
    `).all();

    const totalCogs = cogs.reduce((acc, c) => acc + c.amount, 0);
    const grossProfit = totalRevenue - totalCogs;

    // 3. Beban Operasional (EXPENSE)
    const expenses = db.prepare(`
      SELECT a.code, a.name,
        COALESCE(SUM(jl.debit - jl.credit), 0) as amount
      FROM accounts a
      JOIN journal_lines jl ON jl.account_id = a.id
      WHERE a.type = 'EXPENSE'
      GROUP BY a.id, a.code, a.name
      ORDER BY a.code ASC
    `).all();

    const totalExpense = expenses.reduce((acc, e) => acc + e.amount, 0);
    const netIncome = grossProfit - totalExpense;

    res.json({
      revenues,
      total_revenue: totalRevenue,
      cogs,
      total_cogs: totalCogs,
      gross_profit: grossProfit,
      expenses,
      total_expense: totalExpense,
      net_income: netIncome
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Laporan Posisi Keuangan (Neraca)
app.get('/api/reports/balance-sheet', (req, res) => {
  try {
    // Aset
    const assets = db.prepare(`
      SELECT a.code, a.name,
        COALESCE(SUM(jl.debit - jl.credit), 0) as amount
      FROM accounts a
      JOIN journal_lines jl ON jl.account_id = a.id
      WHERE a.type = 'ASSET'
      GROUP BY a.id, a.code, a.name
      HAVING amount <> 0
      ORDER BY a.code ASC
    `).all();

    const totalAssets = assets.reduce((acc, a) => acc + a.amount, 0);

    // Liabilitas
    const liabilities = db.prepare(`
      SELECT a.code, a.name,
        COALESCE(SUM(jl.credit - jl.debit), 0) as amount
      FROM accounts a
      JOIN journal_lines jl ON jl.account_id = a.id
      WHERE a.type = 'LIABILITY'
      GROUP BY a.id, a.code, a.name
      HAVING amount <> 0
      ORDER BY a.code ASC
    `).all();

    const totalLiabilities = liabilities.reduce((acc, l) => acc + l.amount, 0);

    // Ekuitas Master (Modal, Prive, dll.)
    const equities = db.prepare(`
      SELECT a.code, a.name,
        COALESCE(SUM(jl.credit - jl.debit), 0) as amount
      FROM accounts a
      JOIN journal_lines jl ON jl.account_id = a.id
      WHERE a.type = 'EQUITY'
      GROUP BY a.id, a.code, a.name
      HAVING amount <> 0
      ORDER BY a.code ASC
    `).all();

    // Laba Berjalan (Pendapatan - HPP - Beban)
    const revTotal = db.prepare("SELECT COALESCE(SUM(jl.credit - jl.debit), 0) as v FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE a.type = 'REVENUE'").get().v;
    const cogsTotal = db.prepare("SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as v FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE a.type = 'COGS'").get().v;
    const expTotal = db.prepare("SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as v FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE a.type = 'EXPENSE'").get().v;
    const currentYearProfit = revTotal - cogsTotal - expTotal;

    const totalEquities = equities.reduce((acc, e) => acc + e.amount, 0) + currentYearProfit;

    res.json({
      assets,
      total_assets: totalAssets,
      liabilities,
      total_liabilities: totalLiabilities,
      equities,
      current_year_profit: currentYearProfit,
      total_equities: totalEquities,
      is_balanced: Math.abs(totalAssets - (totalLiabilities + totalEquities)) < 0.01
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Kartu Stok & Ringkasan Per Lokasi
app.get('/api/reports/stock-summary', (req, res) => {
  try {
    const list = db.prepare(`
      SELECT sb.*, i.name as item_name, i.sku as item_sku, i.type as item_type, u.code as unit_code,
        w.name as worker_name,
        ROUND(sb.qty * sb.avg_cost, 2) as total_value
      FROM stock_balances sb
      JOIN items i ON i.id = sb.item_id
      JOIN units u ON u.id = i.unit_id
      LEFT JOIN workers w ON w.id = sb.worker_id
      WHERE sb.qty <> 0
      ORDER BY sb.location ASC, i.name ASC
    `).all();

    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mutasi Kartu Stok Detail
app.get('/api/reports/stock-movements', (req, res) => {
  try {
    const list = db.prepare(`
      SELECT sm.*, i.name as item_name, i.sku as item_sku, u.code as unit_code, w.name as worker_name
      FROM stock_movements sm
      JOIN items i ON i.id = sm.item_id
      JOIN units u ON u.id = i.unit_id
      LEFT JOIN workers w ON w.id = sm.worker_id
      ORDER BY sm.movement_date DESC, sm.created_at DESC LIMIT 100
    `).all();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Laporan Perubahan Ekuitas (SAK EMKM)
app.get('/api/reports/equity-statement', (req, res) => {
  try {
    const accModal = getAccountId('3-1000');
    const accPrive = getAccountId('3-2000');

    const modalTotal = db.prepare("SELECT COALESCE(SUM(credit - debit), 0) as v FROM journal_lines WHERE account_id = ?").get(accModal).v;
    const priveTotal = db.prepare("SELECT COALESCE(SUM(debit - credit), 0) as v FROM journal_lines WHERE account_id = ?").get(accPrive).v;

    // Laba Bersih
    const revTotal = db.prepare("SELECT COALESCE(SUM(jl.credit - jl.debit), 0) as v FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE a.type = 'REVENUE'").get().v;
    const cogsTotal = db.prepare("SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as v FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE a.type = 'COGS'").get().v;
    const expTotal = db.prepare("SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as v FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE a.type = 'EXPENSE'").get().v;
    const netProfit = revTotal - cogsTotal - expTotal;

    const endingEquity = modalTotal - priveTotal + netProfit;

    res.json({
      initial_modal: modalTotal,
      prive: priveTotal,
      net_profit: netProfit,
      ending_equity: endingEquity
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Laporan Arus Kas (Metode Langsung)
app.get('/api/reports/cash-flow', (req, res) => {
  try {
    // 1. Arus Kas Operasi
    // Penerimaan dari pelanggan
    const salesIn = db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) as v FROM payments p WHERE p.direction = 'IN'
    `).get().v;
    const cashSalesIn = db.prepare(`
      SELECT COALESCE(SUM(s.total), 0) as v FROM sales s WHERE s.paid_amount >= s.total
    `).get().v;

    // Pembayaran ke pemasok
    const vendorOut = db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) as v FROM payments p WHERE p.direction = 'OUT'
    `).get().v;

    // Pembayaran upah borongan
    const wageOut = db.prepare(`
      SELECT COALESCE(SUM(ws.net_paid), 0) as v FROM wage_slips ws
    `).get().v;

    // Beban operasional kas
    const opExpenseOut = db.prepare(`
      SELECT COALESCE(SUM(ct.amount), 0) as v FROM cash_transactions ct
      JOIN accounts a ON a.id = ct.counter_account_id
      WHERE ct.direction = 'OUT' AND a.type = 'EXPENSE'
    `).get().v;

    const operatingCashFlow = (salesIn + cashSalesIn) - (vendorOut + wageOut + opExpenseOut);

    // 2. Arus Kas Pendanaan (Modal / Prive)
    const capitalIn = db.prepare(`
      SELECT COALESCE(SUM(ct.amount), 0) as v FROM cash_transactions ct
      JOIN accounts a ON a.id = ct.counter_account_id
      WHERE ct.direction = 'IN' AND a.type = 'EQUITY'
    `).get().v;

    const priveOut = db.prepare(`
      SELECT COALESCE(SUM(ct.amount), 0) as v FROM cash_transactions ct
      JOIN accounts a ON a.id = ct.counter_account_id
      WHERE ct.direction = 'OUT' AND a.code = '3-2000'
    `).get().v;

    const financingCashFlow = capitalIn - priveOut;

    res.json({
      operating: {
        receipts_from_customers: salesIn + cashSalesIn,
        payments_to_suppliers: vendorOut,
        payments_for_wages: wageOut,
        payments_for_expenses: opExpenseOut,
        net_operating: operatingCashFlow
      },
      financing: {
        capital_contribution: capitalIn,
        owner_drawings: priveOut,
        net_financing: financingCashFlow
      },
      net_cash_change: operatingCashFlow + financingCashFlow
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ambil faktur belum lunas dari mitra untuk mempermudah Netting (C1)
app.get('/api/partners/:id/unpaid-invoices', (req, res) => {
  try {
    const partnerId = req.params.id;
    const unpaidSales = db.prepare(`
      SELECT id, sale_no, sale_date, total, paid_amount, (total - paid_amount) as remaining
      FROM sales WHERE partner_id = ? AND status = 'POSTED' AND paid_amount < total
      ORDER BY sale_date ASC
    `).all(partnerId);

    const unpaidPurchases = db.prepare(`
      SELECT id, purchase_no, purchase_date, total, paid_amount, (total - paid_amount) as remaining
      FROM purchases WHERE partner_id = ? AND status = 'POSTED' AND paid_amount < total
      ORDER BY purchase_date ASC
    `).all(partnerId);

    res.json({ unpaidSales, unpaidPurchases });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// F4 & F5: Penyesuaian Stok Opname Fisik vs Sistem
app.post('/api/stock-opnames', (req, res) => {
  try {
    const { item_id, location, worker_id, counted_qty, note } = req.body;
    const counted = Number(counted_qty);
    if (isNaN(counted) || counted < 0) return res.status(400).json({ error: 'Kuantitas fisik harus valid >= 0' });

    db.exec('BEGIN TRANSACTION');

    const wId = location === 'WORKER' ? worker_id : null;
    const stockRow = db.prepare(`
      SELECT id, qty, avg_cost FROM stock_balances
      WHERE item_id = ? AND location = ? AND (worker_id = ? OR (worker_id IS NULL AND ? IS NULL))
    `).get(item_id, location, wId, wId);

    const systemQty = stockRow ? Number(stockRow.qty) : 0;
    const avgCost = stockRow ? Number(stockRow.avg_cost) : 0;
    const diffQty = counted - systemQty; // >0: Lebih, <0: Kurang

    if (diffQty === 0) {
      db.exec('COMMIT');
      return res.json({ success: true, message: 'Stok fisik sesuai persis dengan sistem. Tidak ada selisih.' });
    }

    const opnameId = crypto.randomUUID();
    const opnameNo = getNextDocNo('OPN', 'journals', 'journal_no');
    const today = new Date().toISOString().slice(0, 10);

    // Update stok menjadi counted
    updateStockBalance(item_id, location, wId, diffQty, avgCost);

    recordStockMovement({
      movementDate: today,
      itemId: item_id,
      location: location,
      workerId: wId,
      qtyIn: diffQty > 0 ? diffQty : 0,
      qtyOut: diffQty < 0 ? Math.abs(diffQty) : 0,
      unitCost: avgCost,
      movementType: 'ADJUSTMENT',
      sourceTable: 'stock_opnames',
      sourceId: opnameId,
      note: note || `Penyesuaian stok opname ${opnameNo}`
    });

    // Auto-jurnal F4 / F5:
    // Akun selisih persediaan: 5-5000 Selisih Persediaan (Opname)
    // Akun persediaan sesuai lokasi: RAW (1-1500), WIP (1-1510), FG (1-1520)
    let invAccCode = '1-1500';
    if (location === 'WORKER') invAccCode = '1-1510';
    if (location === 'FG_WH') invAccCode = '1-1520';

    const accInv = getAccountId(invAccCode);
    const accVariance = getAccountId('5-5000');
    const totalVal = Math.abs(diffQty) * avgCost;

    const journalLines = [];
    if (diffQty < 0) {
      // F4: Stok Kurang -> Dr 5-5000 Selisih Persediaan; Cr Akun Persediaan
      journalLines.push({ account_id: accVariance, debit: totalVal, credit: 0, memo: `Beban selisih opname kurang ${opnameNo}` });
      journalLines.push({ account_id: accInv, debit: 0, credit: totalVal, worker_id: wId, memo: `Penurunan stok hasil opname ${opnameNo}` });
    } else {
      // F5: Stok Lebih -> Dr Akun Persediaan; Cr 5-5000 Selisih Persediaan
      journalLines.push({ account_id: accInv, debit: totalVal, credit: 0, worker_id: wId, memo: `Kenaikan stok hasil opname ${opnameNo}` });
      journalLines.push({ account_id: accVariance, debit: 0, credit: totalVal, memo: `Penyesuaian opname stok lebih ${opnameNo}` });
    }

    const jId = createJournalEntry({
      journalNo: opnameNo,
      journalDate: today,
      description: `Auto-jurnal Penyesuaian Stok Opname (${location})`,
      sourceTable: 'stock_opnames',
      sourceId: opnameId,
      lines: journalLines
    });

    db.exec('COMMIT');
    res.json({ success: true, opname_no: opnameNo, diff_qty: diffQty, total_value: totalVal });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// Jalankan Web Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  APLIKASI USAHA KESET (SAK EMKM) AKTIF & BERJALAN!`);
  console.log(`  Buka browser Anda di: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});

