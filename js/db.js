// IndexedDB 資料庫模組
const DB_NAME = 'InventoryDB';
const DB_VERSION = 2;

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      // 區域
      if (!d.objectStoreNames.contains('regions')) {
        d.createObjectStore('regions', { keyPath: 'id', autoIncrement: true })
          .createIndex('name', 'name', { unique: true });
      }
      // 客戶
      if (!d.objectStoreNames.contains('clients')) {
        const cs = d.createObjectStore('clients', { keyPath: 'id', autoIncrement: true });
        cs.createIndex('name', 'name', { unique: false });
        cs.createIndex('region', 'region', { unique: false });
      }
      // 產品
      if (!d.objectStoreNames.contains('products')) {
        const ps = d.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
        ps.createIndex('name', 'name', { unique: false });
        ps.createIndex('barcode', 'barcode', { unique: false });
      }
      // 盤點紀錄
      if (!d.objectStoreNames.contains('records')) {
        const rs = d.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
        rs.createIndex('clientId', 'clientId', { unique: false });
        rs.createIndex('date', 'date', { unique: false });
        rs.createIndex('client_date', ['clientId', 'date'], { unique: false });
      }
      // 訂貨紀錄（用於比較）
      if (!d.objectStoreNames.contains('orders')) {
        const os = d.createObjectStore('orders', { keyPath: 'id', autoIncrement: true });
        os.createIndex('clientId', 'clientId', { unique: false });
        os.createIndex('date', 'date', { unique: false });
        os.createIndex('client_date', ['clientId', 'date'], { unique: false });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

// 通用 CRUD
async function dbAdd(store, data) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    const req = s.add(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(store, data) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(store, id) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(store) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(store, id) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetByIndex(store, indexName, value) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readonly');
    const idx = tx.objectStore(store).index(indexName);
    const req = idx.getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbClear(store) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// 取得特定客戶的上次盤點紀錄
async function getLastRecord(clientId, beforeDate) {
  const records = await dbGetByIndex('records', 'clientId', clientId);
  const filtered = records
    .filter(r => r.date < beforeDate)
    .sort((a, b) => b.date.localeCompare(a.date));
  return filtered[0] || null;
}

// 取得去年同月盤點紀錄
async function getLastYearRecord(clientId, date) {
  const records = await dbGetByIndex('records', 'clientId', clientId);
  const d = new Date(date);
  const targetYear = d.getFullYear() - 1;
  const targetMonth = d.getMonth();
  const matched = records.filter(r => {
    const rd = new Date(r.date);
    return rd.getFullYear() === targetYear && rd.getMonth() === targetMonth;
  }).sort((a, b) => b.date.localeCompare(a.date));
  return matched[0] || null;
}

// 取得特定客戶的上次訂貨紀錄
async function getLastOrder(clientId, beforeDate) {
  const orders = await dbGetByIndex('orders', 'clientId', clientId);
  const filtered = orders
    .filter(o => o.date < beforeDate)
    .sort((a, b) => b.date.localeCompare(a.date));
  return filtered[0] || null;
}

// 取得去年同月訂貨紀錄
async function getLastYearOrder(clientId, date) {
  const orders = await dbGetByIndex('orders', 'clientId', clientId);
  const d = new Date(date);
  const targetYear = d.getFullYear() - 1;
  const targetMonth = d.getMonth();
  const matched = orders.filter(o => {
    const od = new Date(o.date);
    return od.getFullYear() === targetYear && od.getMonth() === targetMonth;
  }).sort((a, b) => b.date.localeCompare(a.date));
  return matched[0] || null;
}

// 匯出全部資料
async function exportAllData() {
  const data = {
    exportDate: new Date().toISOString(),
    regions: await dbGetAll('regions'),
    clients: await dbGetAll('clients'),
    products: await dbGetAll('products'),
    records: await dbGetAll('records'),
    orders: await dbGetAll('orders')
  };
  return JSON.stringify(data, null, 2);
}

// 匯入資料
async function importAllData(jsonStr) {
  const data = JSON.parse(jsonStr);
  if (data.regions) { await dbClear('regions'); for (const r of data.regions) await dbPut('regions', r); }
  if (data.clients) { await dbClear('clients'); for (const c of data.clients) await dbPut('clients', c); }
  if (data.products) { await dbClear('products'); for (const p of data.products) await dbPut('products', p); }
  if (data.records) { await dbClear('records'); for (const r of data.records) await dbPut('records', r); }
  if (data.orders) { await dbClear('orders'); for (const o of data.orders) await dbPut('orders', o); }
}
