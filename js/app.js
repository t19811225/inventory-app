// ====== 預設資料 ======
const DEFAULT_REGIONS = [];  // 透過匯入資料載入

// 產品和客戶資料不內建在程式碼中（資安考量）
// 首次使用時透過「設定 > 匯入資料」載入
const DEFAULT_PRODUCTS_DATA = [];

const DEFAULT_CLIENTS = {};

// ====== 全域狀態 ======
let allProducts = [];
let allClients = [];
let allRegions = [];
let scanned = {};       // { productId: { name, qty, expiry, barcode } }
let activeClientId = null;
let scannerOn = false;
let pickerOpen = false;
let expiryTarget = null;
let expiryCamStream = null;

// ====== 初始化 ======
document.addEventListener('DOMContentLoaded', async () => {
  await initData();
  initTabs();
  initInfoBar();
  initScanTab();
  initModals();
  initSettings();
  initFirebaseUI();
  registerSW();
});

function initFirebaseUI() {
  document.getElementById('btnGoogleLogin').addEventListener('click', googleLogin);
  document.getElementById('btnLogout').addEventListener('click', logout);
}

async function registerSW() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); } catch(e) {}
  }
}

async function initData() {
  await openDB();

  allRegions = await dbGetAll('regions');
  allProducts = await dbGetAll('products');
  allClients = await dbGetAll('clients');

  // 首次使用：顯示匯入提示
  if (allRegions.length === 0 && allProducts.length === 0 && allClients.length === 0) {
    showFirstTimeHint();
  }

  populateRegionSelects();
  document.getElementById('checkDate').value = new Date().toISOString().split('T')[0];
}

function showFirstTimeHint() {
  setTimeout(() => {
    const msg = document.getElementById('scanList');
    if (msg) {
      msg.innerHTML = '<div class="empty"><div class="empty-icon">&#128230;</div>' +
        '<p>首次使用，請先匯入資料</p>' +
        '<span class="sub">點右上角「設定」→「匯入資料」<br>載入產品和客戶資料後即可開始盤點</span>' +
        '<br><br><button class="btn btn-primary" onclick="document.getElementById(\'btnHeaderSettings\').click()">前往設定匯入</button></div>';
    }
  }, 500);
}

function populateRegionSelects() {
  ['regionSelect', 'ncRegion', 'ecRegion'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const isMain = id === 'regionSelect';
    sel.innerHTML = isMain ? '<option value="">— 全部區域 —</option>' : '';
    allRegions.forEach(r => { sel.innerHTML += `<option value="${r.name}">${r.name}${isMain ? ` (${allClients.filter(c=>c.region===r.name).length})` : ''}</option>`; });
  });
}

// ====== Tab 導航 ======
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'compare') renderCompare();
      if (btn.dataset.tab === 'yearly') renderYearly();
      if (btn.dataset.tab === 'history') renderHistory();
    });
  });
}

// ====== Info Bar ======
function initInfoBar() {
  const regionSel = document.getElementById('regionSelect');
  const clientSel = document.getElementById('clientSelect');

  regionSel.addEventListener('change', () => {
    filterClients();
    activeClientId = null;
    scanned = {};
    renderScanList();
  });

  clientSel.addEventListener('change', () => {
    activeClientId = clientSel.value ? parseInt(clientSel.value) : null;
    scanned = {};
    renderScanList();
    if (activeClientId) {
      const c = allClients.find(x => x.id === activeClientId);
      toast('已選擇：' + (c?.name || ''));
    }
  });

  filterClients();
}

function filterClients() {
  const region = document.getElementById('regionSelect').value;
  const sel = document.getElementById('clientSelect');
  const filtered = region ? allClients.filter(c => c.region === region) : allClients;
  filtered.sort((a,b) => a.name.localeCompare(b.name, 'zh-TW'));
  sel.innerHTML = '<option value="">— 選擇客戶 —</option>';
  filtered.forEach(c => { sel.innerHTML += `<option value="${c.id}">${c.name}</option>`; });
  document.getElementById('clientCountLabel').textContent = `(${filtered.length}個)`;
}

// ====== Toast ======
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2000);
}

// ====== 確認對話框 ======
function showConfirm(title, msg) {
  return new Promise(resolve => {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    openModal('confirmModal');
    document.getElementById('btnConfirmYes').onclick = () => { closeModal('confirmModal'); resolve(true); };
    document.getElementById('btnConfirmNo').onclick = () => { closeModal('confirmModal'); resolve(false); };
  });
}

// ====== Modal 通用 ======
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function initModals() {
  // 關閉按鈕
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Header 按鈕
  document.getElementById('btnHeaderAddProduct').addEventListener('click', () => {
    document.getElementById('npName').value = '';
    document.getElementById('npBarcode').value = '';
    document.getElementById('npPrice').value = '';
    openModal('productModal');
  });
  document.getElementById('btnHeaderAddClient').addEventListener('click', () => {
    document.getElementById('ncName').value = '';
    openModal('clientModal');
  });
  document.getElementById('btnHeaderSettings').addEventListener('click', () => {
    refreshSettingsLists();
    openModal('settingsModal');
  });

  // 儲存品項
  document.getElementById('btnSaveProduct').addEventListener('click', async () => {
    const name = document.getElementById('npName').value.trim();
    if (!name) return toast('請填寫品項名稱');
    const barcode = document.getElementById('npBarcode').value.trim();
    const price = parseFloat(document.getElementById('npPrice').value) || 0;
    await syncAdd('products', { name, barcode, price });
    allProducts = await dbGetAll('products');
    closeModal('productModal');
    toast('已新增：' + name);
  });

  // 更新品項
  document.getElementById('btnUpdateProduct').addEventListener('click', async () => {
    const id = parseInt(document.getElementById('editProductId').value);
    const name = document.getElementById('epName').value.trim();
    if (!name) return toast('請填寫品項名稱');
    const existingProd = allProducts.find(x => x.id === id);
    await syncPut('products', { ...existingProd, id, name, barcode: document.getElementById('epBarcode').value.trim(), price: parseFloat(document.getElementById('epPrice').value) || 0 });
    allProducts = await dbGetAll('products');
    closeModal('editProductModal');
    refreshSettingsLists();
    toast('品項已更新');
  });

  // 刪除品項
  document.getElementById('btnDeleteProduct').addEventListener('click', async () => {
    const id = parseInt(document.getElementById('editProductId').value);
    const ok = await showConfirm('刪除品項', '確定要刪除此品項嗎？');
    if (!ok) return;
    await syncDelete('products', id);
    allProducts = await dbGetAll('products');
    closeModal('editProductModal');
    refreshSettingsLists();
    toast('品項已刪除');
  });

  // 儲存客戶
  document.getElementById('btnSaveClient').addEventListener('click', async () => {
    const name = document.getElementById('ncName').value.trim();
    const region = document.getElementById('ncRegion').value;
    if (!name) return toast('請填寫客戶名稱');
    if (!region) return toast('請選擇區域');
    await syncAdd('clients', { name, region });
    allClients = await dbGetAll('clients');
    populateRegionSelects();
    filterClients();
    closeModal('clientModal');
    toast('已新增：' + name);
  });

  // 更新客戶
  document.getElementById('btnUpdateClient').addEventListener('click', async () => {
    const id = parseInt(document.getElementById('editClientId').value);
    const name = document.getElementById('ecName').value.trim();
    const region = document.getElementById('ecRegion').value;
    if (!name) return toast('請填寫客戶名稱');
    const existingClient = allClients.find(x => x.id === id);
    await syncPut('clients', { ...existingClient, id, name, region });
    allClients = await dbGetAll('clients');
    populateRegionSelects();
    filterClients();
    closeModal('editClientModal');
    refreshSettingsLists();
    toast('客戶已更新');
  });

  // 刪除客戶
  document.getElementById('btnDeleteClient').addEventListener('click', async () => {
    const id = parseInt(document.getElementById('editClientId').value);
    const ok = await showConfirm('刪除客戶', '確定要刪除此客戶嗎？');
    if (!ok) return;
    await syncDelete('clients', id);
    allClients = await dbGetAll('clients');
    populateRegionSelects();
    filterClients();
    closeModal('editClientModal');
    refreshSettingsLists();
    toast('客戶已刪除');
  });

  // 效期拍照
  document.getElementById('btnCaptureExpiry').addEventListener('click', captureExpiry);
  document.getElementById('btnCloseExpiryCam').addEventListener('click', closeExpiryCam);
  document.getElementById('btnConfirmOCR').addEventListener('click', confirmOCR);

  // 儲存盤點
  document.getElementById('btnSaveRecord').addEventListener('click', saveRecord);
}

// ====== 掃碼盤點 Tab ======
function initScanTab() {
  document.getElementById('scanToggle').addEventListener('click', toggleScanner);
  document.getElementById('btnTogglePicker').addEventListener('click', toggleProductPicker);
  document.getElementById('btnManualAdd').addEventListener('click', addManual);
  document.getElementById('manualBarcode').addEventListener('keypress', e => { if (e.key === 'Enter') addManual(); });
  document.getElementById('productSearchInPicker').addEventListener('input', e => renderProductGrid(e.target.value));
}

// ====== 掃碼器 ======
function toggleScanner() {
  const box = document.getElementById('scanner-container');
  const btn = document.getElementById('scanToggle');
  if (scannerOn) {
    try { Quagga.stop(); } catch(e) {}
    box.style.display = 'none';
    btn.textContent = '開啟掃碼';
    scannerOn = false;
  } else {
    if (!activeClientId) return toast('請先選擇客戶');
    box.style.display = 'block';
    btn.textContent = '關閉掃碼';
    scannerOn = true;
    Quagga.init({
      inputStream: { name:'Live', type:'LiveStream', target: box, constraints: { facingMode:'environment', width:{ideal:640}, height:{ideal:480} }},
      decoder: { readers: ['ean_reader','ean_8_reader','upc_reader','upc_e_reader'] },
      locate: true
    }, function(err) {
      if (err) { toast('無法開啟相機'); box.style.display='none'; btn.textContent='開啟掃碼'; scannerOn=false; return; }
      Quagga.start();
    });
    Quagga.onDetected(function(r) {
      const code = r.codeResult.code;
      if (code) { addItemByBarcode(code); if(navigator.vibrate) navigator.vibrate(100); }
    });
  }
}

// ====== 品項選擇器 ======
function toggleProductPicker() {
  if (!activeClientId) return toast('請先選擇客戶');
  pickerOpen = !pickerOpen;
  document.getElementById('productPicker').style.display = pickerOpen ? 'block' : 'none';
  if (pickerOpen) renderProductGrid();
}

function renderProductGrid(filter) {
  const grid = document.getElementById('productGrid');
  const f = (filter || '').toLowerCase();
  let html = '';
  allProducts.forEach(p => {
    if (f && !p.name.toLowerCase().includes(f)) return;
    const isAdded = scanned[p.id];
    const cls = isAdded ? ' added' : '';
    const qtyLabel = isAdded ? ` (${isAdded.qty})` : '';
    html += `<button class="product-pick${cls}" data-pid="${p.id}">${p.name}${qtyLabel}</button>`;
  });
  grid.innerHTML = html || '<div style="grid-column:1/-1;text-align:center;color:var(--text-dim);padding:20px;">找不到品項</div>';

  grid.querySelectorAll('.product-pick').forEach(btn => {
    btn.addEventListener('click', () => addItemById(parseInt(btn.dataset.pid)));
  });
}

// ====== 加入品項 ======
function addItemById(productId) {
  if (!activeClientId) return toast('請先選擇客戶');
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;
  if (scanned[productId]) {
    scanned[productId].qty++;
  } else {
    scanned[productId] = { name: p.name, qty: 1, expiry: '', barcode: p.barcode || '' };
  }
  renderScanList();
  if (pickerOpen) renderProductGrid(document.getElementById('productSearchInPicker').value);
  toast('+ ' + p.name);
}

function addItemByBarcode(code) {
  const p = allProducts.find(x => x.barcode === code);
  if (p) {
    addItemById(p.id);
  } else {
    toast('條碼 ' + code + ' 未登記，請至設定新增');
  }
}

function addManual() {
  const inp = document.getElementById('manualBarcode');
  const v = inp.value.trim();
  if (!v) return;
  if (!activeClientId) return toast('請先選擇客戶');
  // 先搜名稱再搜條碼
  let p = allProducts.find(x => x.name === v) || allProducts.find(x => x.barcode === v);
  if (p) {
    addItemById(p.id);
  } else {
    toast('找不到：' + v);
  }
  inp.value = '';
}

// ====== 渲染盤點清單 ======
function renderScanList() {
  const el = document.getElementById('scanList');
  const entries = Object.entries(scanned);
  document.getElementById('itemCount').textContent = entries.length + ' 項';

  if (!entries.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">&#128247;</div><p>尚未掃描任何商品</p><span class="sub">開啟掃碼或點擊「選擇品項」開始盤點</span></div>';
    return;
  }

  el.innerHTML = entries.map(([pid, item]) => {
    let expiryClass = '';
    if (item.expiry) {
      const d = (new Date(item.expiry) - new Date()) / 86400000;
      if (d < 0) expiryClass = 'expiry-expired';
      else if (d < 90) expiryClass = 'expiry-soon';
      else expiryClass = 'expiry-ok';
    }

    // 上次比較
    let compareHtml = '';
    // 從歷史紀錄抓上次
    // (會在有歷史資料時顯示)

    return `<div class="item-card">
      <div class="item-top">
        <div>
          <div class="item-name">${item.name}</div>
          ${item.barcode ? `<div class="item-barcode">${item.barcode}</div>` : ''}
        </div>
        <button class="item-delete" data-del="${pid}">&#10005;</button>
      </div>
      <div class="item-fields">
        <div class="field-group">
          <span class="field-label">數量</span>
          <div class="qty-ctrl">
            <button class="qty-btn" data-qty="${pid}" data-d="-1">&#8722;</button>
            <span class="qty-val">${item.qty}</span>
            <button class="qty-btn" data-qty="${pid}" data-d="1">&#65291;</button>
          </div>
        </div>
        <div class="field-group">
          <span class="field-label">效期</span>
          <div class="field-row">
            <input type="date" class="expiry-input ${expiryClass}" value="${item.expiry}" data-expiry="${pid}">
            <button class="cam-btn" data-cam="${pid}" title="拍照辨識效期">&#128247;</button>
          </div>
        </div>
      </div>
      ${compareHtml}
    </div>`;
  }).join('');

  // 綁定事件
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    delete scanned[parseInt(b.dataset.del)];
    renderScanList();
    if (pickerOpen) renderProductGrid(document.getElementById('productSearchInPicker').value);
  }));
  el.querySelectorAll('[data-qty]').forEach(b => b.addEventListener('click', () => {
    const pid = parseInt(b.dataset.qty);
    const d = parseInt(b.dataset.d);
    if (!scanned[pid]) return;
    scanned[pid].qty = Math.max(0, scanned[pid].qty + d);
    if (scanned[pid].qty === 0) delete scanned[pid];
    renderScanList();
    if (pickerOpen) renderProductGrid(document.getElementById('productSearchInPicker').value);
  }));
  el.querySelectorAll('[data-expiry]').forEach(inp => inp.addEventListener('change', () => {
    const pid = parseInt(inp.dataset.expiry);
    if (scanned[pid]) scanned[pid].expiry = inp.value;
    renderScanList();
  }));
  el.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => openExpiryCam(parseInt(b.dataset.cam))));
}

// ====== 效期拍照 ======
// 預先載入 OCR 引擎
let ocrWorker = null;
async function initOCR() {
  if (ocrWorker) return;
  ocrWorker = await Tesseract.createWorker('eng', 1, {
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
  });
}
// 頁面載入後背景預載 OCR
setTimeout(initOCR, 3000);

function openExpiryCam(pid) {
  expiryTarget = pid;
  document.getElementById('ocrResult').textContent = '等待拍照...';
  document.getElementById('ocrResult').style.color = 'var(--text-dim)';
  document.getElementById('ocrConfirm').style.display = 'none';
  // 確保 OCR 已載入
  initOCR();
  openModal('expiryCamModal');
  const video = document.getElementById('expiryCamPreview');
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(stream => { expiryCamStream = stream; video.srcObject = stream; })
    .catch(() => toast('無法開啟相機'));
}

async function captureExpiry() {
  const video = document.getElementById('expiryCamPreview');
  const canvas = document.getElementById('ocrCanvas');
  const result = document.getElementById('ocrResult');
  const confirmBtn = document.getElementById('ocrConfirm');

  canvas.width = video.videoWidth || 320;
  canvas.height = video.videoHeight || 240;
  canvas.getContext('2d').drawImage(video, 0, 0);

  result.textContent = '辨識中，請稍候...';
  result.style.color = 'var(--text-dim)';
  confirmBtn.style.display = 'none';

  try {
    // 裁剪中央區域提高速度和準確度
    const cropCanvas = document.createElement('canvas');
    const cw = canvas.width, ch = canvas.height;
    cropCanvas.width = cw * 0.8;
    cropCanvas.height = ch * 0.4;
    cropCanvas.getContext('2d').drawImage(canvas, cw*0.1, ch*0.3, cw*0.8, ch*0.4, 0, 0, cropCanvas.width, cropCanvas.height);

    // 使用預載的 OCR worker
    if (!ocrWorker) await initOCR();
    const { data } = await ocrWorker.recognize(cropCanvas);

    const text = data.text;
    // 嘗試從辨識文字中提取日期
    const dateStr = extractDate(text);

    if (dateStr) {
      result.textContent = dateStr.display;
      result.style.color = 'var(--accent)';
      result.dataset.date = dateStr.value;
      confirmBtn.style.display = 'flex';
    } else {
      result.textContent = '未能辨識日期，請重試';
      result.style.color = 'var(--danger)';
      // 顯示原始辨識文字供參考
      if (text.trim()) {
        result.textContent += '\n辨識到: ' + text.trim().substring(0, 50);
      }
    }
  } catch (e) {
    console.error('OCR error:', e);
    result.textContent = '辨識失敗，請手動輸入';
    result.style.color = 'var(--danger)';
  }
}

// 從 OCR 文字中提取日期
function extractDate(text) {
  // 清理文字
  const clean = text.replace(/[oO]/g, '0').replace(/[lI]/g, '1').replace(/[sS]/g, '5').replace(/[bB]/g, '6');

  // 常見日期格式
  const patterns = [
    // 2027/03/26 or 2027.03.26 or 2027-03-26
    /(\d{4})[\/\.\-\s](\d{1,2})[\/\.\-\s](\d{1,2})/,
    // 西元年月日無分隔: 20270326
    /(\d{4})(\d{2})(\d{2})/,
    // 民國年: 116/03/26 or 116.03.26
    /(1\d{2})[\/\.\-\s](\d{1,2})[\/\.\-\s](\d{1,2})/,
    // 月/年: 03/2027 or 03.2027
    /(\d{1,2})[\/\.\-](\d{4})/,
    // 年月: 2027/03 or 2027.03
    /(\d{4})[\/\.\-](\d{1,2})/,
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match) {
      let yr, mo, dy;

      if (pattern === patterns[3]) {
        // 月/年格式
        mo = parseInt(match[1]);
        yr = parseInt(match[2]);
        dy = 1;
      } else if (pattern === patterns[4]) {
        // 年月格式
        yr = parseInt(match[1]);
        mo = parseInt(match[2]);
        dy = 1;
      } else if (pattern === patterns[2]) {
        // 民國年
        yr = parseInt(match[1]) + 1911;
        mo = parseInt(match[2]);
        dy = parseInt(match[3]);
      } else {
        yr = parseInt(match[1]);
        mo = parseInt(match[2]);
        dy = parseInt(match[3]);
      }

      // 驗證日期合理性
      if (yr >= 2024 && yr <= 2035 && mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) {
        const moStr = String(mo).padStart(2, '0');
        const dyStr = String(dy).padStart(2, '0');
        return {
          display: `${yr}/${moStr}/${dyStr}`,
          value: `${yr}-${moStr}-${dyStr}`
        };
      }
    }
  }
  return null;
}

function confirmOCR() {
  const dateStr = document.getElementById('ocrResult').dataset.date;
  if (dateStr && expiryTarget && scanned[expiryTarget]) {
    scanned[expiryTarget].expiry = dateStr;
    renderScanList();
    toast('效期已設定');
  }
  closeExpiryCam();
}

function closeExpiryCam() {
  if (expiryCamStream) { expiryCamStream.getTracks().forEach(t => t.stop()); expiryCamStream = null; }
  closeModal('expiryCamModal');
  expiryTarget = null;
}

// ====== 儲存盤點 ======
async function saveRecord() {
  if (!activeClientId) return toast('請先選擇客戶');
  const entries = Object.entries(scanned);
  if (!entries.length) return toast('請先掃描商品');

  const client = allClients.find(c => c.id === activeClientId);
  const date = document.getElementById('checkDate').value;
  const items = entries.map(([pid, item]) => ({
    productId: parseInt(pid),
    name: item.name,
    qty: item.qty,
    expiry: item.expiry,
    barcode: item.barcode
  }));

  const record = {
    clientId: activeClientId,
    clientName: client?.name || '',
    region: client?.region || '',
    date,
    items,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    savedAt: new Date().toISOString()
  };

  await syncAdd('records', record);
  toast('盤點紀錄已儲存！');
}

// ====== 即時比較 ======
async function renderCompare() {
  const el = document.getElementById('compareView');
  const entries = Object.entries(scanned);

  if (!activeClientId || !entries.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">&#128202;</div><p>${!activeClientId?'請先選擇客戶':'請先掃描商品'}</p><span class="sub">掃描後可即時比較上次資料</span></div>`;
    return;
  }

  const client = allClients.find(c => c.id === activeClientId);
  const lastRec = await getLastRecord(activeClientId, document.getElementById('checkDate').value + 'Z');

  let totNow = 0, totItems = entries.length;
  entries.forEach(([, item]) => { totNow += item.qty; });
  let totLast = 0;
  if (lastRec) lastRec.items.forEach(i => { totLast += i.qty; });

  let h = `<div class="stats-row">
    <div class="stat-box"><div class="stat-num blue">${totItems}</div><div class="stat-desc">盤點品項</div></div>
    <div class="stat-box"><div class="stat-num green">${totNow}</div><div class="stat-desc">總庫存</div></div>
    <div class="stat-box"><div class="stat-num orange">${lastRec ? lastRec.items.length : '-'}</div><div class="stat-desc">上次品項</div></div>
    <div class="stat-box"><div class="stat-num ${totNow < totLast ? 'red' : 'green'}">${lastRec ? totLast : '-'}</div><div class="stat-desc">上次庫存</div></div>
  </div>`;

  h += `<div class="section-title" style="margin-bottom:10px;">本次盤點明細${lastRec ? ` (vs ${lastRec.date})` : ''}</div>`;
  h += '<div class="table-wrap"><table class="tbl"><thead><tr><th>品項</th><th>本次</th>';
  if (lastRec) h += '<th>上次</th><th>差異</th>';
  h += '<th>效期</th><th>狀態</th></tr></thead><tbody>';

  // 合併所有品項
  const allItemsMap = new Map();
  entries.forEach(([, item]) => {
    allItemsMap.set(item.name, { now: item.qty, last: 0, expiry: item.expiry });
  });
  if (lastRec) {
    lastRec.items.forEach(i => {
      if (allItemsMap.has(i.name)) {
        allItemsMap.get(i.name).last = i.qty;
      } else {
        allItemsMap.set(i.name, { now: 0, last: i.qty, expiry: '' });
      }
    });
  }

  for (const [name, data] of [...allItemsMap.entries()].sort((a,b) => a[0].localeCompare(b[0], 'zh-TW'))) {
    const diff = data.now - data.last;
    let statusHtml = '', ec = '';
    if (data.expiry) {
      const d = (new Date(data.expiry) - new Date()) / 86400000;
      if (d < 0) { ec = 'expiry-expired'; statusHtml = '<span class="badge badge-down">已過期</span>'; }
      else if (d < 90) { ec = 'expiry-soon'; statusHtml = '<span class="badge badge-same">快到期</span>'; }
      else { statusHtml = '<span class="badge badge-up">正常</span>'; }
    } else { statusHtml = '—'; }

    h += `<tr><td><strong>${name}</strong></td><td>${data.now}</td>`;
    if (lastRec) {
      const diffCls = diff > 0 ? 'badge-up' : diff < 0 ? 'badge-down' : 'badge-same';
      const sign = diff > 0 ? '+' : '';
      h += `<td>${data.last}</td><td><span class="badge ${diffCls}">${sign}${diff}</span></td>`;
    }
    h += `<td class="${ec}">${data.expiry || '—'}</td><td>${statusHtml}</td></tr>`;
  }
  h += '</tbody></table></div>';
  el.innerHTML = h;
}

// ====== 年度分析 ======
async function renderYearly() {
  const el = document.getElementById('yearlyView');
  if (!activeClientId) { el.innerHTML = '<div class="empty"><div class="empty-icon">&#128197;</div><p>請先選擇客戶</p></div>'; return; }

  const client = allClients.find(c => c.id === activeClientId);
  const records = await dbGetByIndex('records', 'clientId', activeClientId);

  if (records.length < 2) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">&#128197;</div><p>${client?.name || ''}</p><span class="sub">需要至少兩筆紀錄才能分析<br>持續使用系統後即可查看年度分析</span></div>`;
    return;
  }

  records.sort((a,b) => b.date.localeCompare(a.date));
  const now = new Date();
  const thisYear = now.getFullYear();
  const lastYear = thisYear - 1;

  const thisYearRecs = records.filter(r => new Date(r.date).getFullYear() === thisYear);
  const lastYearRecs = records.filter(r => new Date(r.date).getFullYear() === lastYear);

  let h = `<div class="yr-badges"><span class="yr-badge now">${thisYear}年</span><span class="yr-badge last">${lastYear}年</span></div>`;
  h += `<div class="stats-row">
    <div class="stat-box"><div class="stat-num orange">${thisYearRecs.length}</div><div class="stat-desc">今年盤點次數</div></div>
    <div class="stat-box"><div class="stat-num blue">${lastYearRecs.length}</div><div class="stat-desc">去年盤點次數</div></div>
  </div>`;

  // 按月比較
  const monthlyThis = {}, monthlyLast = {};
  thisYearRecs.forEach(r => {
    const m = new Date(r.date).getMonth();
    monthlyThis[m] = (monthlyThis[m] || 0) + r.totalQty;
  });
  lastYearRecs.forEach(r => {
    const m = new Date(r.date).getMonth();
    monthlyLast[m] = (monthlyLast[m] || 0) + r.totalQty;
  });

  const maxQty = Math.max(...Object.values(monthlyThis), ...Object.values(monthlyLast), 1);
  const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  h += '<div class="section-title" style="margin-bottom:12px;">月度庫存量比較</div>';
  for (let m = 0; m < 12; m++) {
    const thisVal = monthlyThis[m] || 0;
    const lastVal = monthlyLast[m] || 0;
    if (thisVal === 0 && lastVal === 0) continue;
    h += `<div class="bar-group">
      <div class="bar-name"><span>${months[m]}</span></div>
      <div class="bar-track"><div class="bar-fill yr-now" style="width:${(thisVal/maxQty*100).toFixed(1)}%"></div></div>
      <div class="bar-track"><div class="bar-fill yr-last" style="width:${(lastVal/maxQty*100).toFixed(1)}%"></div></div>
      <div class="bar-legend"><span>今年: ${thisVal}</span><span>去年: ${lastVal}</span></div>
    </div>`;
  }
  el.innerHTML = h;
}

// ====== 歷史紀錄 ======
async function renderHistory() {
  const el = document.getElementById('historyView');
  if (!activeClientId) { el.innerHTML = '<div class="empty"><div class="empty-icon">&#128203;</div><p>請先選擇客戶</p></div>'; return; }

  const client = allClients.find(c => c.id === activeClientId);
  const records = await dbGetByIndex('records', 'clientId', activeClientId);

  if (!records.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">&#128203;</div><p>${client?.name || ''}</p><span class="sub">尚無歷史紀錄<br>點擊右下角儲存盤點後即會出現</span></div>`;
    return;
  }

  records.sort((a,b) => b.date.localeCompare(a.date));

  let h = '<div class="section-title" style="margin-bottom:12px;">歷史盤點紀錄</div>';
  records.forEach((r, i) => {
    let trend = '';
    if (records[i+1]) {
      const d = r.totalQty - records[i+1].totalQty;
      const p = records[i+1].totalQty > 0 ? Math.round((d/records[i+1].totalQty)*100) : 0;
      trend = `<span class="badge ${d>=0?'badge-up':'badge-down'}">${d>=0?'&#8593;':'&#8595;'} ${Math.abs(p)}%</span>`;
    }
    h += `<div class="history-card" data-rid="${r.id}">
      <div class="history-head"><span class="history-date">${r.date}</span>${trend}</div>
      <div class="history-row"><span class="hl">品項數</span><span>${r.items.length} 項</span></div>
      <div class="history-row"><span class="hl">總數量</span><span>${r.totalQty}</span></div>`;
    // 展開明細
    r.items.forEach(item => {
      h += `<div class="history-row"><span>${item.name}</span><span>${item.qty}${item.expiry ? ' | ' + item.expiry : ''}</span></div>`;
    });
    h += '</div>';
  });
  el.innerHTML = h;
}

// ====== 設定 ======
function initSettings() {
  document.getElementById('btnExport').addEventListener('click', async () => {
    const json = await exportAllData();
    downloadFile(json, `inventory-backup-${new Date().toISOString().slice(0,10)}.json`, 'application/json');
    toast('資料已匯出');
  });

  document.getElementById('btnImport').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const ok = await showConfirm('匯入資料', '匯入將覆蓋現有資料，確定要繼續嗎？');
    if (!ok) { e.target.value = ''; return; }
    try {
      await importAllData(await file.text());
      allRegions = await dbGetAll('regions');
      allClients = await dbGetAll('clients');
      allProducts = await dbGetAll('products');
      populateRegionSelects();
      filterClients();
      // 匯入後同步到 Firebase
      if (typeof uploadAllToFirebase === 'function') await uploadAllToFirebase();
      toast('資料已匯入並同步');
    } catch(err) { toast('匯入失敗: ' + err.message); }
    e.target.value = '';
  });

  document.getElementById('btnExportCSV').addEventListener('click', async () => {
    const records = await dbGetAll('records');
    if (!records.length) return toast('沒有盤點紀錄');
    let csv = '\uFEFF區域,客戶名稱,盤點日期,品項,數量,效期,到期天數\n';
    records.forEach(rec => {
      rec.items.forEach(item => {
        const days = item.expiry ? Math.ceil((new Date(item.expiry) - new Date()) / 86400000) : '';
        csv += `${rec.region||''},${rec.clientName},${rec.date},${item.name},${item.qty},${item.expiry||''},${days}\n`;
      });
    });
    downloadFile(csv, `inventory-${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
    toast('CSV 已匯出');
  });

  document.getElementById('btnAddRegion').addEventListener('click', async () => {
    const name = document.getElementById('newRegionName').value.trim();
    if (!name) return toast('請輸入區域名稱');
    try {
      await syncAdd('regions', { name });
      allRegions = await dbGetAll('regions');
      populateRegionSelects();
      document.getElementById('newRegionName').value = '';
      refreshSettingsLists();
      toast('區域已新增');
    } catch(e) { toast('區域名稱已存在'); }
  });

  document.getElementById('btnClearData').addEventListener('click', async () => {
    const ok = await showConfirm('清除所有資料', '此操作無法復原！確定要清除嗎？');
    if (!ok) return;
    await dbClear('regions'); await dbClear('clients'); await dbClear('products'); await dbClear('records'); await dbClear('orders');
    await initData();
    scanned = {};
    activeClientId = null;
    renderScanList();
    closeModal('settingsModal');
    toast('所有資料已清除並重置');
  });
}

function refreshSettingsLists() {
  // 區域列表
  const rl = document.getElementById('regionList');
  rl.innerHTML = allRegions.map(r => `<div class="region-item"><span>${r.name}</span><button class="btn btn-sm btn-danger" data-delrgn="${r.id}">刪除</button></div>`).join('');
  rl.querySelectorAll('[data-delrgn]').forEach(b => b.addEventListener('click', async () => {
    const ok = await showConfirm('刪除區域', '確定刪除此區域嗎？');
    if (!ok) return;
    await syncDelete('regions', parseInt(b.dataset.delrgn));
    allRegions = await dbGetAll('regions');
    populateRegionSelects();
    refreshSettingsLists();
    toast('區域已刪除');
  }));

  // 客戶列表
  const cl = document.getElementById('clientManageList');
  const sortedClients = [...allClients].sort((a,b) => (a.region+a.name).localeCompare(b.region+b.name, 'zh-TW'));
  cl.innerHTML = sortedClients.map(c => `<div class="manage-item"><span class="meta">${c.region}</span><span class="name">${c.name}</span><div class="manage-item-actions"><button class="btn btn-sm btn-secondary" data-editclient="${c.id}">編輯</button><button class="btn btn-sm btn-danger" data-delclient="${c.id}">刪除</button></div></div>`).join('');
  cl.querySelectorAll('[data-editclient]').forEach(b => b.addEventListener('click', () => {
    const c = allClients.find(x => x.id === parseInt(b.dataset.editclient));
    if (!c) return;
    document.getElementById('editClientId').value = c.id;
    document.getElementById('ecName').value = c.name;
    document.getElementById('ecRegion').value = c.region;
    closeModal('settingsModal');
    openModal('editClientModal');
  }));
  cl.querySelectorAll('[data-delclient]').forEach(b => b.addEventListener('click', async () => {
    const c = allClients.find(x => x.id === parseInt(b.dataset.delclient));
    if (!c) return;
    const ok = await showConfirm('刪除客戶', '確定刪除「' + c.name + '」嗎？');
    if (!ok) return;
    await syncDelete('clients', c.id);
    allClients = await dbGetAll('clients');
    populateRegionSelects();
    filterClients();
    refreshSettingsLists();
    toast('已刪除：' + c.name);
  }));

  // 產品列表
  const pl = document.getElementById('productManageList');
  const sortedProducts = [...allProducts].sort((a,b) => a.name.localeCompare(b.name, 'zh-TW'));
  pl.innerHTML = sortedProducts.map(p => `<div class="manage-item"><span class="name">${p.name}</span><span class="meta">${p.barcode||'無條碼'}</span><div class="manage-item-actions"><button class="btn btn-sm btn-secondary" data-editprod="${p.id}">編輯</button><button class="btn btn-sm btn-danger" data-delprod="${p.id}">刪除</button></div></div>`).join('');
  pl.querySelectorAll('[data-editprod]').forEach(b => b.addEventListener('click', () => {
    const p = allProducts.find(x => x.id === parseInt(b.dataset.editprod));
    if (!p) return;
    document.getElementById('editProductId').value = p.id;
    document.getElementById('epName').value = p.name;
    document.getElementById('epBarcode').value = p.barcode || '';
    document.getElementById('epPrice').value = p.price || '';
    closeModal('settingsModal');
    openModal('editProductModal');
  }));
  pl.querySelectorAll('[data-delprod]').forEach(b => b.addEventListener('click', async () => {
    const p = allProducts.find(x => x.id === parseInt(b.dataset.delprod));
    if (!p) return;
    const ok = await showConfirm('刪除產品', '確定刪除「' + p.name + '」嗎？');
    if (!ok) return;
    await syncDelete('products', p.id);
    allProducts = await dbGetAll('products');
    refreshSettingsLists();
    toast('已刪除：' + p.name);
  }));
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
