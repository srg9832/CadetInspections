(() => {
  'use strict';

  const DB_NAME = 'cap_uniform_inspection_pwa';
  const DB_VERSION = 1;
  let dbPromise = null;

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
    });
  }

  function transactionPromise(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction was aborted.'));
    });
  }

  async function openDB() {
    if (!('indexedDB' in window)) throw new Error('This browser does not support IndexedDB.');
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('cadets')) {
          const store = db.createObjectStore('cadets', { keyPath: 'capid' });
          store.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains('inspections')) {
          const store = db.createObjectStore('inspections', { keyPath: 'local_id' });
          store.createIndex('sync_status', 'sync_status', { unique: false });
          store.createIndex('inspection_date', 'inspection_date', { unique: false });
          store.createIndex('capid', 'capid', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open the local inspection database.'));
    });
    return dbPromise;
  }

  async function get(storeName, key) {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readonly');
    return requestPromise(tx.objectStore(storeName).get(key));
  }

  async function getAll(storeName) {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readonly');
    return requestPromise(tx.objectStore(storeName).getAll());
  }

  async function put(storeName, value) {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    await transactionPromise(tx);
    return value;
  }

  async function putMany(storeName, values) {
    if (!values?.length) return;
    const db = await openDB();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    values.forEach(v => store.put(v));
    await transactionPromise(tx);
  }

  async function clear(storeName) {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    await transactionPromise(tx);
  }

  function normalizeServerInspection(row) {
    const cadet = row.cadets || {};
    return {
      ...row,
      local_id: row.client_uuid || `server:${row.id}`,
      server_id: row.id,
      client_uuid: row.client_uuid || null,
      capid: cadet.capid || row.capid || '',
      cadet_name: cadet.name || row.cadet_name || '',
      cadet_grade: cadet.grade || row.cadet_grade || row.grade_at_inspection || '',
      sync_status: 'synced',
      sync_error: null,
      synced_at: new Date().toISOString(),
      cadets: {
        capid: cadet.capid || row.capid || '',
        name: cadet.name || row.cadet_name || '',
        grade: cadet.grade || row.cadet_grade || row.grade_at_inspection || ''
      }
    };
  }

  async function init() {
    await openDB();
    return true;
  }

  async function setMeta(key, value) {
    return put('meta', { key, value, updated_at: new Date().toISOString() });
  }

  async function getMeta(key, fallback = null) {
    const row = await get('meta', key);
    return row ? row.value : fallback;
  }

  async function cacheProfile(profile) {
    if (!profile) return;
    await setMeta('last_profile', profile);
  }

  async function getCachedProfile() {
    return getMeta('last_profile', null);
  }

  async function cacheGradingRules(rules) {
    if (!rules) return;
    await setMeta('grading_rules', rules);
  }

  async function getCachedGradingRules() {
    return getMeta('grading_rules', null);
  }

  async function cacheCadets(rows) {
    if (!rows?.length) return;
    await putMany('cadets', rows.map(c => ({
      ...c,
      id: c.id ?? `local:${c.capid}`,
      sync_status: c.sync_status || 'synced'
    })));
  }

  async function getCadets() {
    const rows = await getAll('cadets');
    return rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  async function upsertLocalCadet(cadet) {
    const existing = await get('cadets', cadet.capid);
    const row = {
      ...(existing || {}),
      ...cadet,
      id: existing?.id ?? `local:${cadet.capid}`,
      updated_at: new Date().toISOString(),
      sync_status: existing?.sync_status === 'synced' ? 'synced' : 'pending'
    };
    if (!row.created_at) row.created_at = new Date().toISOString();
    await put('cadets', row);
    return row;
  }

  async function cacheServerInspections(rows) {
    if (!rows?.length) return;
    await putMany('inspections', rows.map(normalizeServerInspection));
  }

  async function queueInspection(cadet, inspection) {
    const localCadet = await upsertLocalCadet(cadet);
    const clientUUID = inspection.client_uuid || inspection.local_id;
    if (!clientUUID) throw new Error('Offline inspection is missing its unique ID.');
    const record = {
      ...inspection,
      local_id: clientUUID,
      client_uuid: clientUUID,
      server_id: null,
      cadet_id: localCadet.id,
      capid: cadet.capid,
      cadet_name: cadet.name,
      cadet_grade: cadet.grade,
      cadets: { capid: cadet.capid, name: cadet.name, grade: cadet.grade },
      sync_status: 'pending',
      sync_error: null,
      created_at: inspection.created_at || new Date().toISOString(),
      queued_at: new Date().toISOString()
    };
    await put('inspections', record);
    return record;
  }

  async function getInspections() {
    const rows = await getAll('inspections');
    return rows.sort((a, b) => {
      const d = String(a.inspection_date || '').localeCompare(String(b.inspection_date || ''));
      return d || String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
  }

  async function getPendingInspections() {
    const rows = await getAll('inspections');
    return rows.filter(r => r.sync_status === 'pending' || r.sync_status === 'error')
      .sort((a, b) => String(a.queued_at || a.created_at || '').localeCompare(String(b.queued_at || b.created_at || '')));
  }

  async function pendingCount() {
    const rows = await getPendingInspections();
    return rows.length;
  }

  async function markInspectionSynced(localId, serverRow, serverCadet) {
    if (serverCadet) await cacheCadets([{ ...serverCadet, sync_status: 'synced' }]);
    const normalized = normalizeServerInspection({
      ...serverRow,
      client_uuid: serverRow.client_uuid || localId,
      cadets: serverRow.cadets || (serverCadet ? { capid: serverCadet.capid, name: serverCadet.name, grade: serverCadet.grade } : undefined)
    });
    normalized.local_id = localId;
    await put('inspections', normalized);
    return normalized;
  }

  async function markInspectionError(localId, message) {
    const row = await get('inspections', localId);
    if (!row) return;
    row.sync_status = 'error';
    row.sync_error = String(message || 'Synchronization failed.');
    row.last_sync_attempt = new Date().toISOString();
    await put('inspections', row);
  }

  async function markInspectionPending(localId) {
    const row = await get('inspections', localId);
    if (!row) return;
    row.sync_status = 'pending';
    row.sync_error = null;
    await put('inspections', row);
  }

  async function noteSyncSuccess() {
    await setMeta('last_sync', new Date().toISOString());
    await setMeta('last_sync_error', null);
  }

  async function noteSyncError(error) {
    await setMeta('last_sync_error', String(error || 'Synchronization failed.'));
  }

  async function getSyncInfo() {
    return {
      pending: await pendingCount(),
      last_sync: await getMeta('last_sync', null),
      last_sync_error: await getMeta('last_sync_error', null),
      last_server_refresh: await getMeta('last_server_refresh', null)
    };
  }

  async function markServerRefresh() {
    await setMeta('last_server_refresh', new Date().toISOString());
  }

  async function clearOfflineData({ keepProfile = true } = {}) {
    const profile = keepProfile ? await getCachedProfile() : null;
    await clear('cadets');
    await clear('inspections');
    await clear('meta');
    if (profile) await cacheProfile(profile);
  }

  window.CAPOfflineStore = {
    init,
    setMeta,
    getMeta,
    cacheProfile,
    getCachedProfile,
    cacheGradingRules,
    getCachedGradingRules,
    cacheCadets,
    getCadets,
    upsertLocalCadet,
    cacheServerInspections,
    queueInspection,
    getInspections,
    getPendingInspections,
    pendingCount,
    markInspectionSynced,
    markInspectionError,
    markInspectionPending,
    noteSyncSuccess,
    noteSyncError,
    getSyncInfo,
    markServerRefresh,
    clearOfflineData
  };
})();
