// app.js - Frontend Logic untuk ERP Usaha Keset (SAK EMKM)
const API_BASE = '';

// State global
let state = {
  items: [],
  units: [],
  partners: [],
  workers: [],
  cashAccounts: [],
  accounts: [],
  boms: [],
  priceTiers: []
};

// Formatter Rupiah
const formatRupiah = (val) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(val || 0);
};

const formatNumber = (val) => {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(val || 0);
};

// ==========================================
// INISIALISASI & TAB NAVIGATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  // Set default dates to today
  const today = new Date().toISOString().slice(0, 10);
  document.querySelectorAll('input[type="date"]').forEach(el => {
    if (!el.value) el.value = today;
  });

  // Load master data dulu
  await loadGlobalMasters();

  // Load dashboard awal
  switchTab('dashboard');
});

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(el => {
    el.classList.remove('bg-indigo-600', 'text-white', 'shadow-md');
    el.classList.add('text-slate-600', 'hover:bg-slate-100');
  });

  const targetContent = document.getElementById(`tab-${tabId}`);
  const targetBtn = document.getElementById(`nav-${tabId}`);

  if (targetContent) targetContent.classList.remove('hidden');
  if (targetBtn) {
    targetBtn.classList.remove('text-slate-600', 'hover:bg-slate-100');
    targetBtn.classList.add('bg-indigo-600', 'text-white', 'shadow-md');
  }

  // Load data spesifik per tab
  if (tabId === 'dashboard') loadDashboard();
  if (tabId === 'production') loadWorkTickets();
  if (tabId === 'sales') loadSales();
  if (tabId === 'purchases') loadPurchases();
  if (tabId === 'workers') loadWorkers();
  if (tabId === 'inventory') { loadItems(); loadBoms(); loadPartners(); }
  if (tabId === 'finance') { loadCashAccounts(); loadCashTransactions(); }
  if (tabId === 'reports') loadIncomeStatement();
}

async function loadGlobalMasters() {
  try {
    const [itemsRes, partnersRes, workersRes, cashRes, unitsRes, bomsRes, accsRes] = await Promise.all([
      fetch('/api/items').then(r => r.json()),
      fetch('/api/partners').then(r => r.json()),
      fetch('/api/workers').then(r => r.json()),
      fetch('/api/cash-accounts').then(r => r.json()),
      fetch('/api/units').then(r => r.json()),
      fetch('/api/boms').then(r => r.json()),
      fetch('/api/accounts').then(r => r.json())
    ]);

    state.items = itemsRes;
    state.partners = partnersRes;
    state.workers = workersRes;
    state.cashAccounts = cashRes;
    state.units = unitsRes;
    state.boms = bomsRes;
    state.accounts = accsRes;

    populateDropdowns();
  } catch (err) {
    console.error('Gagal memuat master data:', err);
  }
}

function populateDropdowns() {
  // 1. Worker dropdowns
  const workerSelects = ['ticket-worker-id', 'advance-worker-id'];
  workerSelects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">-- Pilih Pekerja --</option>' +
      state.workers.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
  });

  // 2. Finished Goods items
  const fgItems = state.items.filter(i => i.type === 'FINISHED_GOOD');
  const fgSelect = document.getElementById('ticket-item-id');
  if (fgSelect) {
    fgSelect.innerHTML = '<option value="">-- Pilih Produk Keset --</option>' +
      fgItems.map(i => `<option value="${i.id}">${i.name} (${i.sku})</option>`).join('');
  }

  // 3. Raw Material items
  const rawItems = state.items.filter(i => i.type === 'RAW_MATERIAL');
  ['issue-material-id', 'return-material-id'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">-- Pilih Bahan Baku --</option>' +
      rawItems.map(i => `<option value="${i.id}">${i.name} (Stok Gudang: ${formatNumber(i.stock_raw)} ${i.unit_code})</option>`).join('');
  });

  // 4. Partner dropdowns
  const custSelect = document.getElementById('sale-partner-id');
  if (custSelect) {
    custSelect.innerHTML = '<option value="">-- Pelanggan Umum Tunai --</option>' +
      state.partners.filter(p => p.is_customer).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  }

  const suppSelect = document.getElementById('purchase-partner-id');
  if (suppSelect) {
    suppSelect.innerHTML = '<option value="">-- Pilih Pemasok --</option>' +
      state.partners.filter(p => p.is_supplier).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  }

  // 5. Cash Accounts
  const cashSelects = ['sale-cash-account-id', 'purchase-cash-account-id', 'slip-cash-account-id', 'advance-cash-account-id', 'cash-trx-account-id'];
  cashSelects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = state.cashAccounts.map(c => `<option value="${c.id}">${c.name} (Saldo: ${formatRupiah(c.balance)})</option>`).join('');
  });

  // 6. Units
  const unitSelect = document.getElementById('item-unit-id');
  if (unitSelect) {
    unitSelect.innerHTML = state.units.map(u => `<option value="${u.id}">${u.name} (${u.code})</option>`).join('');
  }

  // 7. Counter Accounts for Cash Trx (Expenses & Equities)
  const counterSelect = document.getElementById('cash-counter-account-id');
  if (counterSelect) {
    const postable = state.accounts.filter(a => a.is_postable && (a.type === 'EXPENSE' || a.type === 'EQUITY' || a.type === 'REVENUE'));
    counterSelect.innerHTML = postable.map(a => `<option value="${a.id}">[${a.code}] ${a.name} (${a.type})</option>`).join('');
  }

  // 8. Netting partner dropdown (partners with both is_customer and is_supplier)
  const nettingPartnerSelect = document.getElementById('netting-partner-id');
  if (nettingPartnerSelect) {
    const dualPartners = state.partners.filter(p => p.is_customer && p.is_supplier);
    nettingPartnerSelect.innerHTML = '<option value="">-- Pilih Mitra Kompensasi --</option>' +
      dualPartners.map(p => `<option value="${p.id}">${p.name} (Piutang: ${formatRupiah(p.receivable)} | Utang: ${formatRupiah(p.payable)})</option>`).join('');
  }

  // 9. BOM finished item select
  const bomFgSelect = document.getElementById('bom-finished-item-id');
  if (bomFgSelect) {
    bomFgSelect.innerHTML = '<option value="">-- Pilih Produk Keset --</option>' +
      fgItems.map(i => `<option value="${i.id}">${i.name} (${i.sku})</option>`).join('');
  }

  // 10. Opname item & worker select
  const opnameItemSelect = document.getElementById('opname-item-id');
  if (opnameItemSelect) {
    opnameItemSelect.innerHTML = '<option value="">-- Pilih Barang --</option>' +
      state.items.map(i => `<option value="${i.id}">[${i.type === 'FINISHED_GOOD' ? 'KESET' : 'BAHAN'}] ${i.name} (${i.sku})</option>`).join('');
  }

  const opnameWorkerSelect = document.getElementById('opname-worker-id');
  if (opnameWorkerSelect) {
    opnameWorkerSelect.innerHTML = state.workers.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
  }
}

// ==========================================
// 1. DASHBOARD
// ==========================================
async function loadDashboard() {
  try {
    const res = await fetch('/api/dashboard');
    const data = await res.json();
    const s = data.summary;

    document.getElementById('kpi-cash').textContent = formatRupiah(s.cash_bank);
    document.getElementById('kpi-inventory').textContent = formatRupiah(s.inventory_total);
    document.getElementById('kpi-raw').textContent = formatRupiah(s.inventory_raw);
    document.getElementById('kpi-wip').textContent = formatRupiah(s.inventory_wip);
    document.getElementById('kpi-fg').textContent = formatRupiah(s.inventory_fg);
    document.getElementById('kpi-ar').textContent = formatRupiah(s.receivable);
    document.getElementById('kpi-ap').textContent = formatRupiah(s.payable_vendor + s.payable_wage);
    document.getElementById('kpi-ap-vendor').textContent = formatRupiah(s.payable_vendor);
    document.getElementById('kpi-ap-wage').textContent = formatRupiah(s.payable_wage);

    // Overdue Alert
    const overdueAlert = document.getElementById('overdue-alert');
    if (s.overdue_tickets > 0) {
      overdueAlert.classList.remove('hidden');
      document.getElementById('overdue-count-text').textContent = `Terdapat ${s.overdue_tickets} SPK yang belum disetor melewati batas tanggal tempo!`;
    } else {
      overdueAlert.classList.add('hidden');
    }

    // Recent Tickets
    const tBodyTickets = document.getElementById('dash-recent-tickets');
    if (data.recent_tickets.length === 0) {
      tBodyTickets.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400">Belum ada SPK kerja</td></tr>';
    } else {
      tBodyTickets.innerHTML = data.recent_tickets.map(t => `
        <tr class="hover:bg-slate-50 border-b">
          <td class="p-2.5 font-bold text-indigo-700">${t.ticket_no}</td>
          <td class="p-2.5">${t.worker_name}</td>
          <td class="p-2.5 font-medium">${t.item_name} (${formatNumber(t.target_qty)} pcs)</td>
          <td class="p-2.5 text-center">
            <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${t.status === 'OPEN' ? 'badge-open' : 'badge-closed'}">${t.status}</span>
          </td>
        </tr>
      `).join('');
    }

    // Recent Sales
    const tBodySales = document.getElementById('dash-recent-sales');
    if (data.recent_sales.length === 0) {
      tBodySales.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400">Belum ada penjualan</td></tr>';
    } else {
      tBodySales.innerHTML = data.recent_sales.map(s => `
        <tr class="hover:bg-slate-50 border-b">
          <td class="p-2.5 font-bold text-slate-800">${s.sale_no}</td>
          <td class="p-2.5">${s.customer_name || 'Pelanggan Umum'}</td>
          <td class="p-2.5 text-right font-bold text-emerald-700">${formatRupiah(s.total)}</td>
          <td class="p-2.5 text-center">
            <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${s.payment_status === 'PAID' ? 'badge-posted' : 'badge-draft'}">${s.payment_status}</span>
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Error dashboard:', err);
  }
}

// ==========================================
// 2. PRODUKSI BORONGAN (SPK)
// ==========================================
async function loadWorkTickets() {
  try {
    const res = await fetch('/api/work-tickets');
    const tickets = await res.json();
    const tbody = document.getElementById('tickets-table-body');

    if (tickets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-slate-400">Belum ada SPK tiket kerja. Klik "+ Buat SPK Baru" di atas.</td></tr>';
      return;
    }

    tbody.innerHTML = tickets.map(t => {
      const isClosed = t.status === 'CLOSED';
      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="p-3 font-bold text-indigo-700">
            ${t.ticket_no}
            <div class="text-[10px] text-slate-400 font-normal">Tgl: ${t.issue_date}</div>
          </td>
          <td class="p-3 font-medium text-slate-800">${t.worker_name}</td>
          <td class="p-3">${t.target_item_name}</td>
          <td class="p-3 text-right font-bold">${formatNumber(t.target_qty)} pcs</td>
          <td class="p-3 text-right">
            <span class="text-emerald-700 font-bold">${formatNumber(t.total_pass)}</span> /
            <span class="text-rose-600 font-medium">${formatNumber(t.total_reject)}</span>
          </td>
          <td class="p-3 text-slate-600">${t.due_date || '-'}</td>
          <td class="p-3 text-center">
            <span class="px-2.5 py-1 rounded-full text-xs font-semibold ${t.status === 'OPEN' ? 'badge-open' : 'badge-closed'}">${t.status}</span>
          </td>
          <td class="p-3 text-center">
            ${!isClosed ? `
              <div class="flex items-center justify-center gap-1">
                <button onclick="openIssueModal('${t.id}', '${t.ticket_no}')" class="px-2 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded text-[11px] font-semibold" title="Serah Bahan ke Pekerja (D1)">
                  <i class="fa-solid fa-dolly"></i> Serah Bahan
                </button>
                <button onclick="openReceiveModal('${t.id}', '${t.ticket_no}')" class="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded text-[11px] font-semibold" title="Setor Hasil QC & Upah (D2)">
                  <i class="fa-solid fa-clipboard-check"></i> Setor QC
                </button>
                <button onclick="openReturnModal('${t.id}', '${t.ticket_no}')" class="px-2 py-1 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded text-[11px] font-semibold" title="Retur Sisa Bahan (D3)">
                  <i class="fa-solid fa-arrow-rotate-left"></i> Retur Sisa
                </button>
                <button onclick="closeWorkTicket('${t.id}', '${t.ticket_no}')" class="px-2 py-1 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded text-[11px] font-semibold" title="Tutup Tiket & Analisis Susut (D4/D5)">
                  <i class="fa-solid fa-lock"></i> Tutup
                </button>
              </div>
            ` : `
              <div class="flex items-center justify-center gap-1">
                <span class="text-xs text-slate-400 italic">Selesai</span>
                ${t.variances && t.variances.some(v => v.status === 'PENDING') ? `
                  <button onclick="approveTicketVariance('${t.variances.find(v => v.status === 'PENDING').id}', '${t.ticket_no}')" class="px-2 py-1 bg-amber-600 text-white hover:bg-amber-700 rounded text-[11px] font-semibold" title="Setujui Beban Selisih (D5)">
                    <i class="fa-solid fa-stamp"></i> Setujui Selisih
                  </button>
                ` : ''}
              </div>
            `}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error load tickets:', err);
  }
}

async function submitNewTicket(e) {
  e.preventDefault();
  const worker_id = document.getElementById('ticket-worker-id').value;
  const target_item_id = document.getElementById('ticket-item-id').value;
  const target_qty = document.getElementById('ticket-target-qty').value;
  const due_date = document.getElementById('ticket-due-date').value;
  const note = document.getElementById('ticket-note').value;

  try {
    const res = await fetch('/api/work-tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id, target_item_id, target_qty, due_date, note })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`SPK Tiket ${data.ticket_no} berhasil dibuka! Anda dapat langsung menyerahkan bahan ke pekerja.`);
    closeModal('modal-new-ticket');
    document.getElementById('form-new-ticket').reset();
    loadWorkTickets();
  } catch (err) {
    alert('Gagal membuka tiket: ' + err.message);
  }
}

function openIssueModal(ticketId, ticketNo) {
  document.getElementById('issue-ticket-id').value = ticketId;
  document.getElementById('issue-ticket-title').textContent = `SPK: ${ticketNo}`;
  openModal('modal-issue-material');
}

async function submitIssueMaterial(e) {
  e.preventDefault();
  const ticketId = document.getElementById('issue-ticket-id').value;
  const material_id = document.getElementById('issue-material-id').value;
  const qty = document.getElementById('issue-qty').value;

  try {
    const res = await fetch(`/api/work-tickets/${ticketId}/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ material_id, qty })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`Bahan berhasil diserahkan! Auto-Jurnal (D1) senilai ${formatRupiah(data.total_cost)} telah dibukukan ke WIP.`);
    closeModal('modal-issue-material');
    document.getElementById('form-issue-material').reset();
    await loadGlobalMasters();
    loadWorkTickets();
  } catch (err) {
    alert('Gagal menyerahkan bahan: ' + err.message);
  }
}

function openReceiveModal(ticketId, ticketNo) {
  document.getElementById('receive-ticket-id').value = ticketId;
  document.getElementById('receive-ticket-title').textContent = `SPK: ${ticketNo}`;
  openModal('modal-receive-qc');
}

async function submitReceiveQc(e) {
  e.preventDefault();
  const ticketId = document.getElementById('receive-ticket-id').value;
  const qty_pass = document.getElementById('receive-qty-pass').value;
  const qty_rework = document.getElementById('receive-qty-rework').value;
  const qty_reject = document.getElementById('receive-qty-reject').value;

  try {
    const res = await fetch(`/api/work-tickets/${ticketId}/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty_pass, qty_rework, qty_reject })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`Setoran ${data.receipt_no} diterima! Upah borongan tercatat ${formatRupiah(data.wage_amount)}. HPP Keset Jadi per pcs: ${formatRupiah(data.fg_unit_cost)} (Auto-Jurnal D2).`);
    closeModal('modal-receive-qc');
    document.getElementById('form-receive-qc').reset();
    await loadGlobalMasters();
    loadWorkTickets();
  } catch (err) {
    alert('Gagal memproses setoran: ' + err.message);
  }
}

function openReturnModal(ticketId, ticketNo) {
  document.getElementById('return-ticket-id').value = ticketId;
  document.getElementById('return-ticket-title').textContent = `SPK: ${ticketNo}`;
  openModal('modal-return-material');
}

async function submitReturnMaterial(e) {
  e.preventDefault();
  const ticketId = document.getElementById('return-ticket-id').value;
  const material_id = document.getElementById('return-material-id').value;
  const qty = document.getElementById('return-qty').value;

  try {
    const res = await fetch(`/api/work-tickets/${ticketId}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ material_id, qty })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert('Sisa bahan berhasil dikembalikan ke Gudang Bahan Baku (Auto-Jurnal D3)!');
    closeModal('modal-return-material');
    document.getElementById('form-return-material').reset();
    await loadGlobalMasters();
    loadWorkTickets();
  } catch (err) {
    alert('Gagal mengembalikan bahan: ' + err.message);
  }
}

async function closeWorkTicket(ticketId, ticketNo) {
  if (!confirm(`Apakah Anda yakin ingin menutup SPK ${ticketNo}? Sistem akan menghitung toleransi susut wajar vs selisih boros bahan (D4/D5).`)) return;

  try {
    const res = await fetch(`/api/work-tickets/${ticketId}/close`, { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`SPK ${ticketNo} resmi DITUTUP! Variasi selisih bahan telah dievaluasi.`);
    loadWorkTickets();
  } catch (err) {
    alert('Gagal menutup tiket: ' + err.message);
  }
}

// ==========================================
// 3. PENJUALAN (POS)
// ==========================================
let saleLinesState = [];

function addSaleLine() {
  const container = document.getElementById('sale-lines-container');
  const lineIdx = saleLinesState.length;
  saleLinesState.push({ item_id: '', qty: 1, unit_price: 0 });

  const div = document.createElement('div');
  div.id = `sale-line-${lineIdx}`;
  div.className = 'grid grid-cols-12 gap-2 items-center bg-white p-2 rounded-lg border border-slate-200';
  div.innerHTML = `
    <div class="col-span-6">
      <select onchange="onSaleItemChange(${lineIdx}, this.value)" class="w-full p-2 border rounded-lg bg-slate-50 text-xs" required>
        <option value="">-- Pilih Barang / Keset --</option>
        ${state.items.map(i => `<option value="${i.id}">[${i.type === 'FINISHED_GOOD' ? 'KESET' : 'BAHAN'}] ${i.name} (Stok: ${formatNumber(i.type === 'FINISHED_GOOD' ? i.stock_fg : i.stock_raw)})</option>`).join('')}
      </select>
    </div>
    <div class="col-span-2">
      <input type="number" onchange="onSaleQtyChange(${lineIdx}, this.value)" min="1" step="1" value="1" placeholder="Qty" class="w-full p-2 border rounded-lg bg-slate-50 text-xs" required>
    </div>
    <div class="col-span-3">
      <input type="number" id="sale-price-${lineIdx}" onchange="onSalePriceChange(${lineIdx}, this.value)" placeholder="Harga Satuan" class="w-full p-2 border rounded-lg bg-slate-50 text-xs font-semibold" required>
    </div>
    <div class="col-span-1 text-center">
      <button type="button" onclick="removeSaleLine(${lineIdx})" class="text-rose-500 hover:text-rose-700"><i class="fa-solid fa-trash"></i></button>
    </div>
  `;
  container.appendChild(div);
}

function onSaleItemChange(idx, itemId) {
  saleLinesState[idx].item_id = itemId;
  const it = state.items.find(i => i.id === itemId);
  if (it && it.prices && it.prices.length > 0) {
    const defPrice = it.prices[0].price;
    saleLinesState[idx].unit_price = defPrice;
    document.getElementById(`sale-price-${idx}`).value = defPrice;
  }
}

function onSaleQtyChange(idx, val) {
  saleLinesState[idx].qty = Number(val);
}

function onSalePriceChange(idx, val) {
  saleLinesState[idx].unit_price = Number(val);
}

function removeSaleLine(idx) {
  const el = document.getElementById(`sale-line-${idx}`);
  if (el) el.remove();
  saleLinesState[idx] = null;
}

function toggleSalePaymentFields() {
  const isCash = document.getElementById('sale-is-cash').value === '1';
  document.getElementById('sale-cash-account-wrapper').style.display = isCash ? 'block' : 'none';
}

async function submitNewSale(e) {
  e.preventDefault();
  const validLines = saleLinesState.filter(l => l !== null && l.item_id && l.qty > 0);
  if (validLines.length === 0) return alert('Silakan tambahkan minimal 1 baris barang yang dijual!');

  const partner_id = document.getElementById('sale-partner-id').value || null;
  const sale_date = document.getElementById('sale-date').value;
  const discount = document.getElementById('sale-discount').value;
  const is_cash = document.getElementById('sale-is-cash').value === '1';
  const cash_account_id = document.getElementById('sale-cash-account-id').value;

  try {
    const res = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_id, sale_date, lines: validLines, discount, is_cash, cash_account_id })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`Faktur Penjualan ${data.sale_no} berhasil dibuat senilai ${formatRupiah(data.total)}! Auto-jurnal pendapatan & HPP langsung dibukukan.`);
    closeModal('modal-new-sale');
    document.getElementById('form-new-sale').reset();
    saleLinesState = [];
    document.getElementById('sale-lines-container').innerHTML = '';
    await loadGlobalMasters();
    loadSales();
  } catch (err) {
    alert('Gagal menyimpan penjualan: ' + err.message);
  }
}

async function loadSales() {
  try {
    const res = await fetch('/api/sales');
    const sales = await res.json();
    const tbody = document.getElementById('sales-table-body');

    if (sales.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="p-4 text-center text-slate-400">Belum ada faktur penjualan</td></tr>';
      return;
    }

    tbody.innerHTML = sales.map(s => `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3 font-bold text-slate-800">${s.sale_no}</td>
        <td class="p-3">${s.sale_date}</td>
        <td class="p-3 font-medium">${s.customer_name || 'Pelanggan Umum (Tunai)'}</td>
        <td class="p-3">
          <ul class="text-[11px] text-slate-600 list-disc list-inside">
            ${s.lines.map(l => `<li>${l.item_name} x ${formatNumber(l.qty)} ${l.unit_code} (@${formatRupiah(l.unit_price)})</li>`).join('')}
          </ul>
        </td>
        <td class="p-3 text-right font-bold text-slate-800">${formatRupiah(s.total)}</td>
        <td class="p-3 text-right text-emerald-700 font-semibold">${formatRupiah(s.paid_amount)}</td>
        <td class="p-3 text-center">
          <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${s.payment_status === 'PAID' ? 'badge-posted' : 'badge-draft'}">${s.payment_status}</span>
        </td>
        <td class="p-3 text-center font-mono text-[11px] text-indigo-700">${s.journal_no || '-'}</td>
        <td class="p-3 text-center">
          <div class="flex items-center justify-center gap-1">
            <button onclick="printSaleInvoice('${s.id}')" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold flex items-center gap-1">
              <i class="fa-solid fa-receipt"></i> Nota
            </button>
            ${s.payment_status !== 'PAID' ? `
              <button onclick="payInvoice('${s.id}', '${s.sale_no}', ${s.total - s.paid_amount}, '${s.partner_id}')" class="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700">Pelunasan</button>
            ` : `<span class="text-xs text-emerald-600 font-semibold"><i class="fa-solid fa-check-circle"></i> Lunas</span>`}
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error load sales:', err);
  }
}

async function payInvoice(saleId, saleNo, remainingAmt, partnerId) {
  const payAmt = prompt(`Masukkan jumlah pelunasan untuk faktur ${saleNo} (Sisa tagihan: ${formatRupiah(remainingAmt)}):`, remainingAmt);
  if (!payAmt) return;

  const cashAccId = state.cashAccounts[0].id;
  try {
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        direction: 'IN',
        partner_id: partnerId,
        cash_account_id: cashAccId,
        amount: Number(payAmt),
        sale_id: saleId
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`Pelunasan berhasil diproses dengan nomor ${data.payment_no}!`);
    loadSales();
  } catch (err) {
    alert('Gagal memproses pelunasan: ' + err.message);
  }
}

// ==========================================
// 4. PEMBELIAN BAHAN BAKU
// ==========================================
let purchaseLinesState = [];

function addPurchaseLine() {
  const container = document.getElementById('purchase-lines-container');
  const lineIdx = purchaseLinesState.length;
  purchaseLinesState.push({ item_id: '', qty: 1, unit_price: 0 });

  const rawMaterials = state.items.filter(i => i.type === 'RAW_MATERIAL');

  const div = document.createElement('div');
  div.id = `purchase-line-${lineIdx}`;
  div.className = 'grid grid-cols-12 gap-2 items-center bg-white p-2 rounded-lg border border-slate-200';
  div.innerHTML = `
    <div class="col-span-6">
      <select onchange="purchaseLinesState[${lineIdx}].item_id = this.value" class="w-full p-2 border rounded-lg bg-slate-50 text-xs" required>
        <option value="">-- Pilih Bahan Baku --</option>
        ${rawMaterials.map(i => `<option value="${i.id}">${i.name} (${i.sku})</option>`).join('')}
      </select>
    </div>
    <div class="col-span-2">
      <input type="number" onchange="purchaseLinesState[${lineIdx}].qty = Number(this.value)" min="0.1" step="0.1" value="10" placeholder="Qty" class="w-full p-2 border rounded-lg bg-slate-50 text-xs" required>
    </div>
    <div class="col-span-3">
      <input type="number" onchange="purchaseLinesState[${lineIdx}].unit_price = Number(this.value)" placeholder="Harga Beli Satuan" class="w-full p-2 border rounded-lg bg-slate-50 text-xs font-semibold" required>
    </div>
    <div class="col-span-1 text-center">
      <button type="button" onclick="document.getElementById('purchase-line-${lineIdx}').remove(); purchaseLinesState[${lineIdx}] = null;" class="text-rose-500 hover:text-rose-700"><i class="fa-solid fa-trash"></i></button>
    </div>
  `;
  container.appendChild(div);
}

function togglePurchasePaymentFields() {
  const isCash = document.getElementById('purchase-is-cash').value === '1';
  document.getElementById('purchase-cash-account-wrapper').style.display = isCash ? 'block' : 'none';
}

async function submitNewPurchase(e) {
  e.preventDefault();
  const validLines = purchaseLinesState.filter(l => l !== null && l.item_id && l.qty > 0 && l.unit_price > 0);
  if (validLines.length === 0) return alert('Silakan lengkapi baris bahan baku & harga satuan!');

  const partner_id = document.getElementById('purchase-partner-id').value;
  const purchase_date = document.getElementById('purchase-date').value;
  const is_cash = document.getElementById('purchase-is-cash').value === '1';
  const cash_account_id = document.getElementById('purchase-cash-account-id').value;

  try {
    const res = await fetch('/api/purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_id, purchase_date, lines: validLines, is_cash, cash_account_id })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`Pembelian PO ${data.purchase_no} berhasil dicatat senilai ${formatRupiah(data.total)}! Stok gudang bertambah dan biaya rata-rata diperbarui.`);
    closeModal('modal-new-purchase');
    document.getElementById('form-new-purchase').reset();
    purchaseLinesState = [];
    document.getElementById('purchase-lines-container').innerHTML = '';
    await loadGlobalMasters();
    loadPurchases();
  } catch (err) {
    alert('Gagal mencatat pembelian: ' + err.message);
  }
}

async function loadPurchases() {
  try {
    const res = await fetch('/api/purchases');
    const purchases = await res.json();
    const tbody = document.getElementById('purchases-table-body');

    if (purchases.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="p-4 text-center text-slate-400">Belum ada data pembelian bahan</td></tr>';
      return;
    }

    tbody.innerHTML = purchases.map(p => `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3 font-bold text-slate-800">${p.purchase_no}</td>
        <td class="p-3">${p.purchase_date}</td>
        <td class="p-3 font-medium">${p.supplier_name}</td>
        <td class="p-3">
          <ul class="text-[11px] text-slate-600 list-disc list-inside">
            ${p.lines.map(l => `<li>${l.item_name} x ${formatNumber(l.qty)} ${l.unit_code} (@${formatRupiah(l.unit_price)})</li>`).join('')}
          </ul>
        </td>
        <td class="p-3 text-right font-bold text-slate-800">${formatRupiah(p.total)}</td>
        <td class="p-3 text-right text-emerald-700 font-semibold">${formatRupiah(p.paid_amount)}</td>
        <td class="p-3 text-center">
          <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${p.payment_status === 'PAID' ? 'badge-posted' : 'badge-draft'}">${p.payment_status}</span>
        </td>
        <td class="p-3 text-center font-mono text-[11px] text-indigo-700">${p.journal_no || '-'}</td>
        <td class="p-3 text-center">
          ${p.payment_status !== 'PAID' ? `
            <button onclick="payVendorBill('${p.id}', '${p.purchase_no}', ${p.total - p.paid_amount}, '${p.partner_id}')" class="px-2.5 py-1 bg-indigo-600 text-white rounded text-xs font-semibold hover:bg-indigo-700">Bayar Utang</button>
          ` : `<span class="text-xs text-emerald-600"><i class="fa-solid fa-check-circle"></i> Lunas</span>`}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error load purchases:', err);
  }
}

async function payVendorBill(purchaseId, purchaseNo, remainingAmt, partnerId) {
  const payAmt = prompt(`Bayar utang PO ${purchaseNo} (Sisa utang: ${formatRupiah(remainingAmt)}):`, remainingAmt);
  if (!payAmt) return;

  const cashAccId = state.cashAccounts[0].id;
  try {
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        direction: 'OUT',
        partner_id: partnerId,
        cash_account_id: cashAccId,
        amount: Number(payAmt),
        purchase_id: purchaseId
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`Pembayaran utang berhasil dibukukan dengan nomor ${data.payment_no}!`);
    loadPurchases();
  } catch (err) {
    alert('Gagal membayar utang: ' + err.message);
  }
}

// ==========================================
// 5. PEKERJA & PENGGAJIAN
// ==========================================
async function loadWorkers() {
  try {
    const res = await fetch('/api/workers');
    const workers = await res.json();
    const tbody = document.getElementById('workers-table-body');

    tbody.innerHTML = workers.map(w => `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3 font-bold text-slate-800">${w.name}</td>
        <td class="p-3 text-slate-600">${w.phone || '-'} <br><span class="text-[11px] text-slate-400">${w.address || ''}</span></td>
        <td class="p-3 text-right font-medium text-amber-700">${formatRupiah(w.wip_material_value)}</td>
        <td class="p-3 text-right font-bold text-indigo-700">${formatRupiah(w.unpaid_wage)}</td>
        <td class="p-3 text-right font-medium text-rose-600">${formatRupiah(w.advance_debt)}</td>
        <td class="p-3 text-center">
          <button onclick="openWageSlipModal('${w.id}', '${w.name}', ${w.advance_debt})" class="px-2.5 py-1 bg-indigo-600 text-white rounded text-xs font-semibold hover:bg-indigo-700">
            Bayar Slip Upah (E2)
          </button>
        </td>
      </tr>
    `).join('');

    // Load wage slips history
    const slipsRes = await fetch('/api/wage-slips');
    const slips = await slipsRes.json();
    const slipsContainer = document.getElementById('wage-slips-list');

    if (slips.length === 0) {
      slipsContainer.innerHTML = '<p class="text-xs text-slate-400 text-center">Belum ada slip upah diterbitkan</p>';
    } else {
      slipsContainer.innerHTML = slips.map(s => `
        <div class="border rounded-xl p-3 bg-slate-50 text-xs space-y-1">
          <div class="flex justify-between items-center font-bold text-slate-800">
            <span>${s.slip_no}</span>
            <span class="text-emerald-700">${formatRupiah(s.net_paid)}</span>
          </div>
          <div class="text-slate-500">${s.worker_name} • Tgl: ${s.paid_date}</div>
          <div class="text-[11px] text-slate-400">Upah Kotor: ${formatRupiah(s.gross_wage)} | Potong Kasbon: ${formatRupiah(s.advance_deduct)}</div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Error load workers:', err);
  }
}

async function openWageSlipModal(workerId, workerName, advanceDebt) {
  document.getElementById('slip-worker-id').value = workerId;
  document.getElementById('wage-worker-title').textContent = `Pekerja: ${workerName} (Kasbon aktif: ${formatRupiah(advanceDebt)})`;
  document.getElementById('slip-advance-deduct').value = advanceDebt > 0 ? advanceDebt : 0;

  // Dapatkan receipt yang belum dibayar
  const res = await fetch(`/api/workers/${workerId}/unpaid-receipts`);
  const receipts = await res.json();
  const container = document.getElementById('unpaid-receipts-container');

  if (receipts.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-400 text-center py-2">Tidak ada setoran hasil kerja yang menunggu pembayaran untuk pekerja ini.</p>';
  } else {
    container.innerHTML = receipts.map(r => `
      <label class="flex items-center justify-between p-2 rounded-lg bg-white border hover:bg-indigo-50/50 cursor-pointer text-xs">
        <div class="flex items-center gap-2">
          <input type="checkbox" name="receipt_id" value="${r.id}" checked class="rounded text-indigo-600">
          <div>
            <span class="font-bold text-slate-800">${r.receipt_no}</span>
            <span class="text-slate-500">(${r.target_item_name}: ${formatNumber(r.qty_pass)} pcs pass)</span>
          </div>
        </div>
        <span class="font-bold text-indigo-700">${formatRupiah(r.wage_amount)}</span>
      </label>
    `).join('');
  }

  openModal('modal-new-wage-slip');
}

async function submitNewWageSlip(e) {
  e.preventDefault();
  const worker_id = document.getElementById('slip-worker-id').value;
  const cash_account_id = document.getElementById('slip-cash-account-id').value;
  const advance_deduct = document.getElementById('slip-advance-deduct').value;

  const checkedBoxes = document.querySelectorAll('input[name="receipt_id"]:checked');
  const receipt_ids = Array.from(checkedBoxes).map(cb => cb.value);

  if (receipt_ids.length === 0) return alert('Pilih minimal satu setoran hasil kerja untuk dibayar!');

  try {
    const res = await fetch('/api/wage-slips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id, cash_account_id, advance_deduct, receipt_ids })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`Slip Upah ${data.slip_no} berhasil dibayar! Upah kotor: ${formatRupiah(data.gross_wage)}, Dibayar bersih: ${formatRupiah(data.net_paid)} (Auto-Jurnal E2).`);
    closeModal('modal-new-wage-slip');
    await loadGlobalMasters();
    loadWorkers();
  } catch (err) {
    alert('Gagal membayar upah: ' + err.message);
  }
}

async function submitNewAdvance(e) {
  e.preventDefault();
  const worker_id = document.getElementById('advance-worker-id').value;
  const amount = document.getElementById('advance-amount').value;
  const cash_account_id = document.getElementById('advance-cash-account-id').value;

  try {
    const res = await fetch('/api/worker-advances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id, amount, cash_account_id })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`Pencairan Kasbon ${data.advance_no} berhasil dicatat (Auto-Jurnal E1)!`);
    closeModal('modal-new-advance');
    document.getElementById('form-new-advance').reset();
    await loadGlobalMasters();
    loadWorkers();
  } catch (err) {
    alert('Gagal mencairkan kasbon: ' + err.message);
  }
}

async function submitNewWorker(e) {
  e.preventDefault();
  const name = document.getElementById('worker-name').value;
  const phone = document.getElementById('worker-phone').value;
  const address = document.getElementById('worker-address').value;

  try {
    const res = await fetch('/api/workers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, address })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`Pekerja ${name} berhasil didaftarkan!`);
    closeModal('modal-new-worker');
    document.getElementById('form-new-worker').reset();
    await loadGlobalMasters();
    loadWorkers();
  } catch (err) {
    alert('Gagal menambahkan pekerja: ' + err.message);
  }
}

// ==========================================
// 6. MASTER BARANG, RESEP (BOM) & MITRA
// ==========================================
async function loadItems() {
  try {
    const res = await fetch('/api/items');
    const items = await res.json();
    const tbody = document.getElementById('items-table-body');

    tbody.innerHTML = items.map(it => {
      const isFg = it.type === 'FINISHED_GOOD';
      const mainStock = isFg ? it.stock_fg : it.stock_raw;
      const mainCost = isFg ? it.cost_fg : it.cost_raw;

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="p-3 font-mono font-bold text-slate-800">${it.sku}</td>
          <td class="p-3 font-medium text-slate-900">${it.name}</td>
          <td class="p-3">
            <span class="px-2 py-0.5 rounded text-xs font-semibold ${isFg ? 'bg-indigo-100 text-indigo-800' : 'bg-amber-100 text-amber-800'}">
              ${isFg ? 'Barang Jadi (Keset)' : 'Bahan Baku'}
            </span>
          </td>
          <td class="p-3 text-right font-bold text-slate-800">${formatNumber(mainStock)} ${it.unit_code}</td>
          <td class="p-3 text-right text-amber-700 font-semibold">${isFg ? '-' : `${formatNumber(it.stock_wip)} ${it.unit_code}`}</td>
          <td class="p-3 text-right font-medium text-slate-600">${formatRupiah(mainCost)}</td>
          <td class="p-3 text-xs">
            ${it.prices.map(p => `<span class="inline-block bg-slate-100 px-1.5 py-0.5 rounded mr-1 mb-1">${p.tier_name}: <b>${formatRupiah(p.price)}</b></span>`).join('')}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error load items:', err);
  }
}

async function loadBoms() {
  try {
    const res = await fetch('/api/boms');
    const boms = await res.json();
    const container = document.getElementById('boms-list');

    if (boms.length === 0) {
      container.innerHTML = '<p class="text-xs text-slate-400 text-center">Belum ada resep BOM dikonfigurasi</p>';
      return;
    }

    container.innerHTML = boms.map(b => `
      <div class="border rounded-xl p-3 bg-slate-50 text-xs space-y-2">
        <div class="flex justify-between items-center">
          <h4 class="font-bold text-indigo-800">${b.finished_item_name} (${b.finished_item_sku})</h4>
          <span class="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-semibold">BOM v${b.version}</span>
        </div>
        <div class="text-slate-600">
          <p class="font-semibold text-slate-700 mb-1">Standar Kebutuhan Bahan Per 1 Pcs Keset:</p>
          <ul class="list-disc list-inside space-y-0.5 text-slate-600">
            ${b.lines.map(l => `<li>${l.material_name}: <b>${l.qty_per_unit} ${l.unit_code}</b></li>`).join('')}
          </ul>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error load boms:', err);
  }
}

async function loadPartners() {
  try {
    const res = await fetch('/api/partners');
    const partners = await res.json();
    const tbody = document.getElementById('partners-table-body');

    tbody.innerHTML = partners.map(p => `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-2.5 font-bold text-slate-800">${p.name}</td>
        <td class="p-2.5 text-xs text-slate-500">${p.is_supplier && p.is_customer ? 'Pemasok & Pelanggan' : p.is_supplier ? 'Pemasok' : 'Pelanggan'}</td>
        <td class="p-2.5 text-right font-medium text-emerald-700">${formatRupiah(p.receivable)}</td>
        <td class="p-2.5 text-right font-medium text-rose-600">${formatRupiah(p.payable)}</td>
        <td class="p-2.5 text-right font-bold ${p.net_balance >= 0 ? 'text-indigo-700' : 'text-amber-700'}">${formatRupiah(p.net_balance)}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error load partners:', err);
  }
}

async function submitNewItem(e) {
  e.preventDefault();
  const sku = document.getElementById('item-sku').value;
  const name = document.getElementById('item-name').value;
  const type = document.getElementById('item-type').value;
  const unit_id = Number(document.getElementById('item-unit-id').value);
  const size_label = document.getElementById('item-size').value;
  const min_stock = document.getElementById('item-min-stock').value;

  try {
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku, name, type, unit_id, size_label, min_stock,
        can_be_produced_with: type === 'RAW_MATERIAL' ? 1 : 0,
        can_be_sold: 1,
        shrink_tolerance_pct: 3.0
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`Barang ${name} berhasil ditambahkan!`);
    closeModal('modal-new-item');
    document.getElementById('form-new-item').reset();
    await loadGlobalMasters();
    loadItems();
  } catch (err) {
    alert('Gagal menambah barang: ' + err.message);
  }
}

async function submitNewPartner(e) {
  e.preventDefault();
  const name = document.getElementById('partner-name').value;
  const phone = document.getElementById('partner-phone').value;
  const address = document.getElementById('partner-address').value;
  const is_customer = document.getElementById('partner-is-customer').checked;
  const is_supplier = document.getElementById('partner-is-supplier').checked;

  try {
    const res = await fetch('/api/partners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, address, is_customer, is_supplier })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`Mitra ${name} berhasil ditambahkan!`);
    closeModal('modal-new-partner');
    document.getElementById('form-new-partner').reset();
    await loadGlobalMasters();
    loadPartners();
  } catch (err) {
    alert('Gagal menambah mitra: ' + err.message);
  }
}

// ==========================================
// 7. KAS & BEBAN OPERASIONAL
// ==========================================
async function loadCashAccounts() {
  try {
    const res = await fetch('/api/cash-accounts');
    const cashes = await res.json();
    const container = document.getElementById('cash-accounts-list');

    container.innerHTML = cashes.map(c => `
      <div class="border rounded-xl p-3 bg-slate-50 flex items-center justify-between">
        <div>
          <h4 class="font-bold text-slate-800 text-xs">${c.name}</h4>
          <span class="text-[10px] text-slate-400 font-mono">Kode Akun: ${c.account_code}</span>
        </div>
        <span class="text-sm font-bold text-indigo-700">${formatRupiah(c.balance)}</span>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error load cash accounts:', err);
  }
}

async function loadCashTransactions() {
  try {
    const res = await fetch('/api/cash-transactions');
    const trxs = await res.json();
    const tbody = document.getElementById('cash-trx-table-body');

    if (trxs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-slate-400">Belum ada transaksi kas langsung</td></tr>';
      return;
    }

    tbody.innerHTML = trxs.map(t => `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3 font-bold text-slate-800">${t.trx_no}</td>
        <td class="p-3">${t.trx_date}</td>
        <td class="p-3 font-medium">${t.cash_account_name}</td>
        <td class="p-3">[${t.counter_account_code}] ${t.counter_account_name}</td>
        <td class="p-3 text-right font-bold ${t.direction === 'IN' ? 'text-emerald-700' : 'text-rose-600'}">
          ${t.direction === 'IN' ? '+' : '-'} ${formatRupiah(t.amount)}
        </td>
        <td class="p-3 text-slate-600">${t.description || '-'}</td>
        <td class="p-3 text-center font-mono text-[11px] text-indigo-700">${t.journal_no || '-'}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error load cash trxs:', err);
  }
}

async function submitNewCashTrx(e) {
  e.preventDefault();
  const direction = document.getElementById('cash-direction').value;
  const cash_account_id = document.getElementById('cash-trx-account-id').value;
  const counter_account_id = document.getElementById('cash-counter-account-id').value;
  const amount = document.getElementById('cash-amount').value;
  const description = document.getElementById('cash-desc').value;

  try {
    const res = await fetch('/api/cash-transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, cash_account_id, counter_account_id, amount, description })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`Transaksi kas ${data.trx_no} berhasil dicatat (Auto-Jurnal F1/F2/F3)!`);
    closeModal('modal-new-cash-trx');
    document.getElementById('form-new-cash-trx').reset();
    await loadGlobalMasters();
    loadCashAccounts();
    loadCashTransactions();
  } catch (err) {
    alert('Gagal mencatat transaksi kas: ' + err.message);
  }
}

// ==========================================
// 8. LAPORAN KEUANGAN SAK EMKM
// ==========================================
async function loadIncomeStatement() {
  try {
    const res = await fetch('/api/reports/income-statement');
    const data = await res.json();
    const container = document.getElementById('report-container');

    container.innerHTML = `
      <div class="border-b pb-4 text-center">
        <h3 class="text-lg font-bold text-slate-900 uppercase">Laporan Laba Rugi</h3>
        <p class="text-xs text-slate-500">Standar Akuntansi Keuangan EMKM • Usaha Keset</p>
      </div>

      <div class="space-y-4 text-xs">
        <!-- Pendapatan -->
        <div>
          <div class="flex justify-between font-bold text-slate-800 bg-slate-100 p-2.5 rounded-lg">
            <span>PENDAPATAN USAHA</span>
            <span>${formatRupiah(data.total_revenue)}</span>
          </div>
          <div class="p-2 space-y-1">
            ${data.revenues.map(r => `
              <div class="flex justify-between pl-4 text-slate-600">
                <span>[${r.code}] ${r.name}</span>
                <span>${formatRupiah(r.amount)}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- HPP -->
        <div>
          <div class="flex justify-between font-bold text-slate-800 bg-slate-100 p-2.5 rounded-lg">
            <span>HARGA POKOK PENJUALAN (HPP)</span>
            <span class="text-rose-700">(${formatRupiah(data.total_cogs)})</span>
          </div>
          <div class="p-2 space-y-1">
            ${data.cogs.map(c => `
              <div class="flex justify-between pl-4 text-slate-600">
                <span>[${c.code}] ${c.name}</span>
                <span>${formatRupiah(c.amount)}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Laba Kotor -->
        <div class="flex justify-between font-bold text-sm bg-indigo-50 border border-indigo-200 p-3 rounded-xl text-indigo-950">
          <span>LABA KOTOR (GROSS PROFIT)</span>
          <span>${formatRupiah(data.gross_profit)}</span>
        </div>

        <!-- Beban Operasional -->
        <div>
          <div class="flex justify-between font-bold text-slate-800 bg-slate-100 p-2.5 rounded-lg">
            <span>BEBAN OPERASIONAL</span>
            <span class="text-rose-700">(${formatRupiah(data.total_expense)})</span>
          </div>
          <div class="p-2 space-y-1">
            ${data.expenses.map(e => `
              <div class="flex justify-between pl-4 text-slate-600">
                <span>[${e.code}] ${e.name}</span>
                <span>${formatRupiah(e.amount)}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Laba Bersih -->
        <div class="flex justify-between font-bold text-base bg-emerald-50 border border-emerald-300 p-4 rounded-xl text-emerald-950">
          <span>LABA BERSIH PERIODE BERJALAN</span>
          <span class="${data.net_income >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${formatRupiah(data.net_income)}</span>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Error load income statement:', err);
  }
}

async function loadBalanceSheet() {
  try {
    const res = await fetch('/api/reports/balance-sheet');
    const data = await res.json();
    const container = document.getElementById('report-container');

    container.innerHTML = `
      <div class="border-b pb-4 text-center">
        <h3 class="text-lg font-bold text-slate-900 uppercase">Laporan Posisi Keuangan (Neraca)</h3>
        <p class="text-xs text-slate-500">Standar Akuntansi Keuangan EMKM • Usaha Keset</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
        <!-- Aset -->
        <div class="space-y-3">
          <div class="flex justify-between font-bold text-slate-800 bg-slate-100 p-2.5 rounded-lg">
            <span>ASET</span>
            <span class="text-indigo-700">${formatRupiah(data.total_assets)}</span>
          </div>
          <div class="space-y-1">
            ${data.assets.map(a => `
              <div class="flex justify-between p-2 border-b">
                <span>[${a.code}] ${a.name}</span>
                <span class="font-semibold">${formatRupiah(a.amount)}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Liabilitas & Ekuitas -->
        <div class="space-y-4">
          <!-- Liabilitas -->
          <div class="space-y-3">
            <div class="flex justify-between font-bold text-slate-800 bg-slate-100 p-2.5 rounded-lg">
              <span>LIABILITAS (KEWAJIBAN)</span>
              <span class="text-rose-700">${formatRupiah(data.total_liabilities)}</span>
            </div>
            <div class="space-y-1">
              ${data.liabilities.map(l => `
                <div class="flex justify-between p-2 border-b">
                  <span>[${l.code}] ${l.name}</span>
                  <span class="font-semibold">${formatRupiah(l.amount)}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Ekuitas -->
          <div class="space-y-3">
            <div class="flex justify-between font-bold text-slate-800 bg-slate-100 p-2.5 rounded-lg">
              <span>EKUITAS (MODAL)</span>
              <span class="text-indigo-700">${formatRupiah(data.total_equities)}</span>
            </div>
            <div class="space-y-1">
              ${data.equities.map(e => `
                <div class="flex justify-between p-2 border-b">
                  <span>[${e.code}] ${e.name}</span>
                  <span class="font-semibold">${formatRupiah(e.amount)}</span>
                </div>
              `).join('')}
              <div class="flex justify-between p-2 border-b font-medium text-emerald-800 bg-emerald-50/50">
                <span>Laba Periode Berjalan</span>
                <span class="font-semibold">${formatRupiah(data.current_year_profit)}</span>
              </div>
            </div>
          </div>

          <!-- Total Pasiva -->
          <div class="flex justify-between font-bold text-sm bg-indigo-50 border border-indigo-200 p-3 rounded-xl text-indigo-950">
            <span>TOTAL LIABILITAS & EKUITAS</span>
            <span>${formatRupiah(data.total_liabilities + data.total_equities)}</span>
          </div>

          <div class="text-center text-xs font-semibold ${data.is_balanced ? 'text-emerald-700' : 'text-rose-600'}">
            ${data.is_balanced ? '<i class="fa-solid fa-check-circle"></i> Neraca Seimbang (Aktiva = Pasiva)' : '<i class="fa-solid fa-triangle-exclamation"></i> Neraca Belum Seimbang'}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Error load balance sheet:', err);
  }
}

async function loadTrialBalance() {
  try {
    const res = await fetch('/api/reports/trial-balance');
    const data = await res.json();
    const container = document.getElementById('report-container');

    container.innerHTML = `
      <div class="border-b pb-4 text-center">
        <h3 class="text-lg font-bold text-slate-900 uppercase">Neraca Saldo (Trial Balance)</h3>
        <p class="text-xs text-slate-500">Saldo Akhir Seluruh Akun Buku Besar • SAK EMKM</p>
      </div>

      <div class="overflow-x-auto text-xs">
        <table class="w-full text-left">
          <thead class="bg-slate-50 text-slate-700 uppercase font-semibold border-b">
            <tr>
              <th class="p-3">Kode</th>
              <th class="p-3">Nama Akun</th>
              <th class="p-3">Tipe</th>
              <th class="p-3 text-right">Total Debit</th>
              <th class="p-3 text-right">Total Kredit</th>
              <th class="p-3 text-right">Saldo Akhir</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${data.accounts.map(a => `
              <tr class="hover:bg-slate-50">
                <td class="p-3 font-mono font-bold text-indigo-700">${a.code}</td>
                <td class="p-3 font-medium">${a.name}</td>
                <td class="p-3 text-slate-500">${a.type}</td>
                <td class="p-3 text-right">${formatRupiah(a.total_debit)}</td>
                <td class="p-3 text-right">${formatRupiah(a.total_credit)}</td>
                <td class="p-3 text-right font-bold text-slate-900">${formatRupiah(a.ending_balance)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot class="bg-slate-100 font-bold border-t-2 border-slate-300">
            <tr>
              <td colspan="3" class="p-3 text-center uppercase">Total Keseimbangan (Balance)</td>
              <td class="p-3 text-right text-indigo-800">${formatRupiah(data.total_debit)}</td>
              <td class="p-3 text-right text-indigo-800">${formatRupiah(data.total_credit)}</td>
              <td class="p-3 text-right ${data.is_balanced ? 'text-emerald-700' : 'text-rose-600'}">
                ${data.is_balanced ? 'SEIMBANG' : 'SELISIH'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  } catch (err) {
    console.error('Error load trial balance:', err);
  }
}

async function loadJournals() {
  try {
    const res = await fetch('/api/reports/journals');
    const journals = await res.json();
    const container = document.getElementById('report-container');

    container.innerHTML = `
      <div class="border-b pb-4 text-center">
        <h3 class="text-lg font-bold text-slate-900 uppercase">Buku Jurnal Umum (General Journal)</h3>
        <p class="text-xs text-slate-500">Semua ayat jurnal otomatis yang dibentuk oleh transaksi sistem</p>
      </div>

      <div class="space-y-4 text-xs">
        ${journals.map(j => `
          <div class="border rounded-2xl overflow-hidden bg-white shadow-sm">
            <div class="bg-slate-100 p-3 flex flex-wrap items-center justify-between gap-2 border-b">
              <div class="flex items-center gap-3">
                <span class="font-mono font-bold text-indigo-800">${j.journal_no}</span>
                <span class="text-slate-500">Tgl: ${j.journal_date}</span>
                <span class="text-slate-700 font-medium">${j.description || ''}</span>
              </div>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold badge-posted">POSTED</span>
            </div>
            <div class="p-3 overflow-x-auto">
              <table class="w-full text-left">
                <thead>
                  <tr class="text-[11px] text-slate-400 uppercase border-b pb-1">
                    <th class="pb-1">Akun</th>
                    <th class="pb-1">Keterangan / Memo</th>
                    <th class="pb-1 text-right">Debit</th>
                    <th class="pb-1 text-right">Kredit</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${j.lines.map(l => `
                    <tr>
                      <td class="py-1.5 ${l.credit > 0 ? 'pl-6 text-slate-600' : 'font-semibold text-slate-800'}">
                        [${l.account_code}] ${l.account_name}
                      </td>
                      <td class="py-1.5 text-slate-500 text-[11px]">${l.memo || '-'}</td>
                      <td class="py-1.5 text-right font-medium text-slate-800">${l.debit > 0 ? formatRupiah(l.debit) : '-'}</td>
                      <td class="py-1.5 text-right font-medium text-slate-800">${l.credit > 0 ? formatRupiah(l.credit) : '-'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    console.error('Error load journals:', err);
  }
}

// Laporan Arus Kas
async function loadCashFlow() {
  try {
    const res = await fetch('/api/reports/cash-flow');
    const data = await res.json();
    const container = document.getElementById('report-container');

    container.innerHTML = `
      <div class="border-b pb-4 text-center">
        <h3 class="text-lg font-bold text-slate-900 uppercase">Laporan Arus Kas</h3>
        <p class="text-xs text-slate-500">Metode Langsung • SAK EMKM Usaha Keset</p>
      </div>

      <div class="space-y-4 text-xs max-w-2xl mx-auto">
        <!-- Aktivitas Operasi -->
        <div class="border rounded-xl p-4 bg-white shadow-sm space-y-2">
          <div class="flex justify-between font-bold text-slate-800 border-b pb-2">
            <span>ARUS KAS DARI AKTIVITAS OPERASI</span>
            <span class="${data.operating.net_operating >= 0 ? 'text-emerald-700' : 'text-rose-600'}">${formatRupiah(data.operating.net_operating)}</span>
          </div>
          <div class="space-y-1.5 pl-3 text-slate-600">
            <div class="flex justify-between"><span>Penerimaan Kas dari Pelanggan:</span><span class="font-semibold text-emerald-700">+${formatRupiah(data.operating.receipts_from_customers)}</span></div>
            <div class="flex justify-between"><span>Pembayaran Kas ke Pemasok Bahan:</span><span class="font-semibold text-rose-600">-${formatRupiah(data.operating.payments_to_suppliers)}</span></div>
            <div class="flex justify-between"><span>Pembayaran Upah Borongan Pekerja:</span><span class="font-semibold text-rose-600">-${formatRupiah(data.operating.payments_for_wages)}</span></div>
            <div class="flex justify-between"><span>Pembayaran Beban Operasional Usaha:</span><span class="font-semibold text-rose-600">-${formatRupiah(data.operating.payments_for_expenses)}</span></div>
          </div>
        </div>

        <!-- Aktivitas Pendanaan -->
        <div class="border rounded-xl p-4 bg-white shadow-sm space-y-2">
          <div class="flex justify-between font-bold text-slate-800 border-b pb-2">
            <span>ARUS KAS DARI AKTIVITAS PENDANAAN</span>
            <span class="${data.financing.net_financing >= 0 ? 'text-emerald-700' : 'text-rose-600'}">${formatRupiah(data.financing.net_financing)}</span>
          </div>
          <div class="space-y-1.5 pl-3 text-slate-600">
            <div class="flex justify-between"><span>Penyetoran Modal Pemilik:</span><span class="font-semibold text-emerald-700">+${formatRupiah(data.financing.capital_contribution)}</span></div>
            <div class="flex justify-between"><span>Penarikan Pribadi (Prive):</span><span class="font-semibold text-rose-600">-${formatRupiah(data.financing.owner_drawings)}</span></div>
          </div>
        </div>

        <!-- Kenaikan Bersih Kas -->
        <div class="flex justify-between font-bold text-sm bg-indigo-50 border border-indigo-200 p-3 rounded-xl text-indigo-950">
          <span>KENAIKAN / (PENURUNAN) BERSIH KAS & BANK</span>
          <span class="${data.net_cash_change >= 0 ? 'text-emerald-700' : 'text-rose-600'}">${formatRupiah(data.net_cash_change)}</span>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Error load cash flow:', err);
  }
}

// Laporan Perubahan Ekuitas
async function loadEquityStatement() {
  try {
    const res = await fetch('/api/reports/equity-statement');
    const data = await res.json();
    const container = document.getElementById('report-container');

    container.innerHTML = `
      <div class="border-b pb-4 text-center">
        <h3 class="text-lg font-bold text-slate-900 uppercase">Laporan Perubahan Ekuitas</h3>
        <p class="text-xs text-slate-500">Mutasi Modal Pemilik • SAK EMKM Usaha Keset</p>
      </div>

      <div class="border rounded-2xl p-5 bg-white shadow-sm space-y-3 text-xs max-w-xl mx-auto">
        <div class="flex justify-between p-2 border-b">
          <span class="font-medium text-slate-700">Modal Disetor Awal & Tambahan</span>
          <span class="font-bold text-slate-800">${formatRupiah(data.initial_modal)}</span>
        </div>
        <div class="flex justify-between p-2 border-b">
          <span class="font-medium text-slate-700">Laba Bersih Periode Berjalan</span>
          <span class="font-bold text-emerald-700">+${formatRupiah(data.net_profit)}</span>
        </div>
        <div class="flex justify-between p-2 border-b">
          <span class="font-medium text-slate-700">Penarikan Pribadi Pemilik (Prive)</span>
          <span class="font-bold text-rose-600">-${formatRupiah(data.prive)}</span>
        </div>
        <div class="flex justify-between p-3 bg-indigo-50 rounded-xl text-sm font-bold text-indigo-950 border border-indigo-200">
          <span>EKUITAS AKHIR PERIODE</span>
          <span>${formatRupiah(data.ending_equity)}</span>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Error load equity statement:', err);
  }
}

// Kartu Stok & Riwayat Mutasi
async function loadStockMovements() {
  try {
    const res = await fetch('/api/reports/stock-movements');
    const list = await res.json();
    const container = document.getElementById('report-container');

    container.innerHTML = `
      <div class="border-b pb-4 text-center">
        <h3 class="text-lg font-bold text-slate-900 uppercase">Buku Kartu Stok (Mutasi Persediaan)</h3>
        <p class="text-xs text-slate-500">Pelacakan riil keluar-masuk barang di gudang RAW_WH, WIP WORKER, dan FG_WH</p>
      </div>

      <div class="overflow-x-auto text-xs">
        <table class="w-full text-left">
          <thead class="bg-slate-50 text-slate-700 uppercase font-semibold border-b">
            <tr>
              <th class="p-2.5">Tanggal</th>
              <th class="p-2.5">Barang / Bahan</th>
              <th class="p-2.5">Lokasi</th>
              <th class="p-2.5">Tipe Mutasi</th>
              <th class="p-2.5 text-right text-emerald-700 font-bold">Qty Masuk</th>
              <th class="p-2.5 text-right text-rose-600 font-bold">Qty Keluar</th>
              <th class="p-2.5 text-right">Biaya Satuan</th>
              <th class="p-2.5">Keterangan</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${list.map(m => `
              <tr class="hover:bg-slate-50">
                <td class="p-2.5">${m.movement_date}</td>
                <td class="p-2.5 font-medium">${m.item_name} <span class="text-slate-400">(${m.item_sku})</span></td>
                <td class="p-2.5 font-semibold text-slate-800">${m.location}${m.worker_name ? ` (${m.worker_name})` : ''}</td>
                <td class="p-2.5 font-mono text-[11px] text-indigo-700">${m.movement_type}</td>
                <td class="p-2.5 text-right font-bold text-emerald-700">${m.qty_in > 0 ? `+${formatNumber(m.qty_in)} ${m.unit_code}` : '-'}</td>
                <td class="p-2.5 text-right font-bold text-rose-600">${m.qty_out > 0 ? `-${formatNumber(m.qty_out)} ${m.unit_code}` : '-'}</td>
                <td class="p-2.5 text-right font-medium text-slate-600">${formatRupiah(m.unit_cost)}</td>
                <td class="p-2.5 text-slate-500 text-[11px]">${m.note || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.error('Error load stock movements:', err);
  }
}

// Persetujuan Selisih Varian Bahan (D5)
async function approveTicketVariance(varId, ticketNo) {
  if (!confirm(`Setujui pembebanan selisih bahan SPK ${ticketNo} ke akun Beban Selisih Bahan (5-4000)?`)) return;

  try {
    const res = await fetch(`/api/material-variances/${varId}/approve`, { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`Persetujuan berhasil! Auto-Jurnal (D5) senilai ${formatRupiah(data.excess_cost)} telah dibukukan.`);
    loadWorkTickets();
  } catch (err) {
    alert('Gagal menyetujui selisih: ' + err.message);
  }
}

// Cetak Nota Penjualan
async function printSaleInvoice(saleId) {
  try {
    const res = await fetch('/api/sales');
    const sales = await res.json();
    const s = sales.find(x => x.id === saleId);
    if (!s) return alert('Data faktur tidak ditemukan');

    const content = document.getElementById('print-invoice-content');
    content.innerHTML = `
      <div class="text-center border-b pb-3">
        <h2 class="text-base font-bold text-slate-900">USAHA KESET SEJAHTERA</h2>
        <p class="text-[11px] text-slate-500">Sentra Kerajinan Keset & Tekstil • SAK EMKM</p>
      </div>

      <div class="flex justify-between text-[11px] pt-1">
        <div>
          <div><b>No Faktur:</b> ${s.sale_no}</div>
          <div><b>Tanggal:</b> ${s.sale_date}</div>
        </div>
        <div class="text-right">
          <div><b>Pelanggan:</b> ${s.customer_name || 'Pelanggan Umum'}</div>
          <div><b>Status:</b> ${s.payment_status}</div>
        </div>
      </div>

      <div class="border-t border-b py-2 my-2">
        <table class="w-full text-left text-[11px]">
          <thead class="border-b">
            <tr>
              <th class="pb-1">Item</th>
              <th class="pb-1 text-right">Qty</th>
              <th class="pb-1 text-right">Harga</th>
              <th class="pb-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${s.lines.map(l => `
              <tr>
                <td class="py-1">${l.item_name}</td>
                <td class="py-1 text-right">${formatNumber(l.qty)} ${l.unit_code}</td>
                <td class="py-1 text-right">${formatRupiah(l.unit_price)}</td>
                <td class="py-1 text-right font-semibold">${formatRupiah(l.line_total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="space-y-1 text-right text-[11px]">
        <div>Subtotal: <b>${formatRupiah(s.subtotal)}</b></div>
        ${s.discount > 0 ? `<div>Diskon: <b class="text-rose-600">-${formatRupiah(s.discount)}</b></div>` : ''}
        <div class="text-sm font-bold text-slate-900 pt-1 border-t">Total Tagihan: ${formatRupiah(s.total)}</div>
        <div class="text-emerald-700 font-semibold">Telah Dibayar: ${formatRupiah(s.paid_amount)}</div>
      </div>

      <div class="text-center text-[10px] text-slate-400 border-t pt-3 mt-3">
        Terima kasih atas kerja sama Anda.<br>Barang yang sudah dibeli tidak dapat ditukar tanpa bukti faktur ini.
      </div>
    `;

    openModal('modal-print-invoice');
  } catch (err) {
    alert('Gagal memuat nota: ' + err.message);
  }
}

// Netting Mitra (C1) Logic
async function onNettingPartnerChange(partnerId) {
  if (!partnerId) return;
  const res = await fetch(`/api/partners/${partnerId}/unpaid-invoices`);
  const data = await res.json();

  const saleSelect = document.getElementById('netting-sale-id');
  const purchSelect = document.getElementById('netting-purchase-id');

  saleSelect.innerHTML = '<option value="">-- Pilih Faktur Piutang --</option>' +
    data.unpaidSales.map(s => `<option value="${s.id}">${s.sale_no} (Sisa: ${formatRupiah(s.remaining)})</option>`).join('');

  purchSelect.innerHTML = '<option value="">-- Pilih Faktur Utang --</option>' +
    data.unpaidPurchases.map(p => `<option value="${p.id}">${p.purchase_no} (Sisa: ${formatRupiah(p.remaining)})</option>`).join('');
}

async function submitNetting(e) {
  e.preventDefault();
  const partner_id = document.getElementById('netting-partner-id').value;
  const sale_id = document.getElementById('netting-sale-id').value;
  const purchase_id = document.getElementById('netting-purchase-id').value;
  const amount = document.getElementById('netting-amount').value;

  try {
    const res = await fetch('/api/partner-nettings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_id, sale_id, purchase_id, amount })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`Kompensasi (Netting) ${data.netting_no} berhasil dibukukan (Auto-Jurnal C1)!`);
    closeModal('modal-netting');
    document.getElementById('form-netting').reset();
    await loadGlobalMasters();
    loadSales();
  } catch (err) {
    alert('Gagal memproses netting: ' + err.message);
  }
}

// Tambah Resep BOM Baru
let bomLinesState = [];
function addBomLine() {
  const container = document.getElementById('bom-lines-container');
  const lineIdx = bomLinesState.length;
  bomLinesState.push({ material_id: '', qty_per_unit: 1 });

  const rawMaterials = state.items.filter(i => i.type === 'RAW_MATERIAL');

  const div = document.createElement('div');
  div.id = `bom-line-${lineIdx}`;
  div.className = 'grid grid-cols-12 gap-2 items-center bg-white p-2 rounded-lg border border-slate-200';
  div.innerHTML = `
    <div class="col-span-8">
      <select onchange="bomLinesState[${lineIdx}].material_id = this.value" class="w-full p-2 border rounded-lg bg-slate-50 text-xs" required>
        <option value="">-- Pilih Bahan Baku --</option>
        ${rawMaterials.map(i => `<option value="${i.id}">${i.name} (${i.unit_code})</option>`).join('')}
      </select>
    </div>
    <div class="col-span-3">
      <input type="number" onchange="bomLinesState[${lineIdx}].qty_per_unit = Number(this.value)" min="0.001" step="0.001" placeholder="Kebutuhan" class="w-full p-2 border rounded-lg bg-slate-50 text-xs" required>
    </div>
    <div class="col-span-1 text-center">
      <button type="button" onclick="document.getElementById('bom-line-${lineIdx}').remove(); bomLinesState[${lineIdx}] = null;" class="text-rose-500 hover:text-rose-700"><i class="fa-solid fa-trash"></i></button>
    </div>
  `;
  container.appendChild(div);
}

async function submitNewBom(e) {
  e.preventDefault();
  const finished_item_id = document.getElementById('bom-finished-item-id').value;
  const validLines = bomLinesState.filter(l => l !== null && l.material_id && l.qty_per_unit > 0);
  if (validLines.length === 0) return alert('Silakan tambahkan minimal 1 baris bahan baku resep!');

  try {
    const res = await fetch('/api/boms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ finished_item_id, lines: validLines })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert('Resep Standar (BOM) berhasil disimpan!');
    closeModal('modal-new-bom');
    document.getElementById('form-new-bom').reset();
    bomLinesState = [];
    document.getElementById('bom-lines-container').innerHTML = '';
    await loadGlobalMasters();
    loadBoms();
  } catch (err) {
    alert('Gagal menyimpan resep BOM: ' + err.message);
  }
}

// Stok Opname
function toggleOpnameWorker(location) {
  document.getElementById('opname-worker-wrapper').style.display = location === 'WORKER' ? 'block' : 'none';
}

async function submitStockOpname(e) {
  e.preventDefault();
  const item_id = document.getElementById('opname-item-id').value;
  const location = document.getElementById('opname-location').value;
  const worker_id = document.getElementById('opname-worker-id').value;
  const counted_qty = document.getElementById('opname-counted-qty').value;
  const note = document.getElementById('opname-note').value;

  try {
    const res = await fetch('/api/stock-opnames', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id, location, worker_id, counted_qty, note })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    alert(`Stok Opname ${data.opname_no || ''} berhasil dicatat! Selisih: ${formatNumber(data.diff_qty)} (Auto-Jurnal F4/F5 senilai ${formatRupiah(data.total_value)}).`);
    closeModal('modal-stock-opname');
    document.getElementById('form-stock-opname').reset();
    await loadGlobalMasters();
    loadItems();
  } catch (err) {
    alert('Gagal memproses stok opname: ' + err.message);
  }
}

// ==========================================
// MODAL CONTROLS
// ==========================================
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('hidden');
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('hidden');
}

