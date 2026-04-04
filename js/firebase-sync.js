// ====== Firebase 初始化 ======
const firebaseConfig = {
  apiKey: "AIzaSyC0h7yR0g6J3WwBH5gkVgmutbtTqdRhhnc",
  authDomain: "inventory-app-b6042.firebaseapp.com",
  projectId: "inventory-app-b6042",
  storageBucket: "inventory-app-b6042.firebasestorage.app",
  messagingSenderId: "793890823645",
  appId: "1:793890823645:web:cffb11c05710feb5372a34",
  measurementId: "G-XJ0XMEDHZ9",
  databaseURL: "https://inventory-app-b6042-default-rtdb.firebaseio.com"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const rtdb = firebase.database();

let currentUser = null;
let userDbRef = null;
let syncListeners = [];

// ====== 登入/登出 ======
async function googleLogin() {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(provider);
  } catch (e) {
    // popup 失敗時用 redirect
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user') {
      await auth.signInWithRedirect(provider);
    } else {
      console.error('Login error:', e);
      if (typeof toast === 'function') toast('登入失敗: ' + e.message);
    }
  }
}

function logout() {
  auth.signOut();
}

// ====== 監聽登入狀態 ======
auth.onAuthStateChanged(user => {
  currentUser = user;
  if (user) {
    userDbRef = rtdb.ref('users/' + user.uid);
    // 啟用離線持久化
    rtdb.goOnline();
    showApp(user);
    syncFromFirebase();
  } else {
    userDbRef = null;
    detachListeners();
    showLogin();
  }
});

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('userBar').style.display = 'none';
  // 隱藏主要 UI
  document.querySelector('.app-header').style.display = 'none';
  document.querySelector('.info-bar').style.display = 'none';
  document.querySelector('.tab-nav').style.display = 'none';
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  document.querySelector('.save-float').style.display = 'none';
}

function showApp(user) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('userBar').style.display = 'flex';
  document.getElementById('userName').innerHTML = user.displayName + ' <span class="sync-status">● 已同步</span>';
  // 顯示主要 UI
  document.querySelector('.app-header').style.display = 'flex';
  document.querySelector('.info-bar').style.display = 'grid';
  document.querySelector('.tab-nav').style.display = 'flex';
  document.querySelector('.tab-content.active').style.display = 'block';
  document.querySelector('.save-float').style.display = 'flex';
}

// ====== Firebase 同步 ======
// 寫入 Firebase
async function firebaseSet(path, data) {
  if (!userDbRef) return;
  try {
    await userDbRef.child(path).set(data);
  } catch (e) {
    console.error('Firebase write error:', e);
  }
}

async function firebasePush(path, data) {
  if (!userDbRef) return null;
  try {
    const ref = await userDbRef.child(path).push(data);
    return ref.key;
  } catch (e) {
    console.error('Firebase push error:', e);
    return null;
  }
}

async function firebaseRemove(path) {
  if (!userDbRef) return;
  try {
    await userDbRef.child(path).remove();
  } catch (e) {
    console.error('Firebase remove error:', e);
  }
}

// 從 Firebase 同步所有資料到 IndexedDB
async function syncFromFirebase() {
  if (!userDbRef) return;

  try {
    const snapshot = await userDbRef.once('value');
    const data = snapshot.val();

    if (data) {
      // 同步區域
      if (data.regions) {
        await dbClear('regions');
        for (const [key, val] of Object.entries(data.regions)) {
          await dbPut('regions', { ...val, _fbKey: key });
        }
      }
      // 同步產品
      if (data.products) {
        await dbClear('products');
        for (const [key, val] of Object.entries(data.products)) {
          await dbPut('products', { ...val, _fbKey: key });
        }
      }
      // 同步客戶
      if (data.clients) {
        await dbClear('clients');
        for (const [key, val] of Object.entries(data.clients)) {
          await dbPut('clients', { ...val, _fbKey: key });
        }
      }
      // 同步盤點紀錄
      if (data.records) {
        await dbClear('records');
        for (const [key, val] of Object.entries(data.records)) {
          await dbPut('records', { ...val, _fbKey: key });
        }
      }

      // 重新載入全域資料
      allRegions = await dbGetAll('regions');
      allProducts = await dbGetAll('products');
      allClients = await dbGetAll('clients');
      populateRegionSelects();
      filterClients();
      renderScanList();
      updateSyncStatus('已同步');
    } else {
      // Firebase 沒資料，把本地資料上傳
      await uploadAllToFirebase();
    }
  } catch (e) {
    console.error('Sync error:', e);
    updateSyncStatus('同步失敗');
  }

  // 即時監聽變更
  attachListeners();
}

// 上傳所有本地資料到 Firebase
async function uploadAllToFirebase() {
  if (!userDbRef) return;

  const regions = await dbGetAll('regions');
  const products = await dbGetAll('products');
  const clients = await dbGetAll('clients');
  const records = await dbGetAll('records');

  const data = {};

  regions.forEach((r, i) => { data['regions/' + (r._fbKey || 'r' + i)] = { id: r.id, name: r.name }; });
  products.forEach((p, i) => { data['products/' + (p._fbKey || 'p' + i)] = { id: p.id, name: p.name, barcode: p.barcode || '', price: p.price || 0 }; });
  clients.forEach((c, i) => { data['clients/' + (c._fbKey || 'c' + i)] = { id: c.id, name: c.name, region: c.region }; });
  records.forEach((r, i) => { data['records/' + (r._fbKey || 'rec' + i)] = r; });

  try {
    await userDbRef.update(data);
    updateSyncStatus('已同步');
  } catch (e) {
    console.error('Upload error:', e);
    updateSyncStatus('上傳失敗');
  }
}

// 即時監聽 Firebase 變更
function attachListeners() {
  if (!userDbRef) return;
  detachListeners();

  const stores = ['regions', 'products', 'clients', 'records'];
  stores.forEach(store => {
    const ref = userDbRef.child(store);
    const listener = ref.on('value', async snapshot => {
      const data = snapshot.val();
      if (!data) return;

      await dbClear(store);
      for (const [key, val] of Object.entries(data)) {
        await dbPut(store, { ...val, _fbKey: key });
      }

      // 更新全域資料
      if (store === 'regions') { allRegions = await dbGetAll('regions'); populateRegionSelects(); }
      if (store === 'products') { allProducts = await dbGetAll('products'); }
      if (store === 'clients') { allClients = await dbGetAll('clients'); populateRegionSelects(); filterClients(); }
      if (store === 'records') { /* records 更新不需要即時刷新 UI */ }

      updateSyncStatus('已同步');
    });
    syncListeners.push({ ref, listener });
  });
}

function detachListeners() {
  syncListeners.forEach(({ ref, listener }) => ref.off('value', listener));
  syncListeners = [];
}

function updateSyncStatus(text) {
  const el = document.querySelector('.sync-status');
  if (el) el.textContent = '● ' + text;
}

// ====== 同步包裝函式（給 db.js 和 app.js 使用）======
async function syncAdd(store, data) {
  const id = await dbAdd(store, data);
  const item = await dbGet(store, id);
  if (userDbRef) {
    const key = await firebasePush(store, { ...data, id });
    item._fbKey = key;
    await dbPut(store, item);
  }
  return id;
}

async function syncPut(store, data) {
  await dbPut(store, data);
  if (userDbRef && data._fbKey) {
    const clean = { ...data };
    delete clean._fbKey;
    await firebaseSet(store + '/' + data._fbKey, clean);
  } else if (userDbRef) {
    const key = await firebasePush(store, data);
    data._fbKey = key;
    await dbPut(store, data);
  }
}

async function syncDelete(store, id) {
  const item = await dbGet(store, id);
  await dbDelete(store, id);
  if (userDbRef && item && item._fbKey) {
    await firebaseRemove(store + '/' + item._fbKey);
  }
}
