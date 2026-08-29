(() => {
  'use strict';

  const CONFIG = window.CAP_APP_CONFIG || { mode: 'demo' };
  const isDemo = CONFIG.mode !== 'supabase';
  let sb = null;
  let currentProfile = null;
  let chartCadet = null;
  let chartMonthly = null;
  let chartCategory = null;
  let chartRating = null;
  let gradingRules = null;
  let unitsCache = [];
  let inspectorDirectory = [];
  let bulkRowSerial = 0;
  const offlineStore = window.CAPOfflineStore || null;
  let syncInProgress = false;
  let deferredInstallPrompt = null;
  let offlineSession = false;

  const GRADES = [
    { value: 'C/AB', label: 'C/AB — Cadet Airman Basic', group: 'airman' },
    { value: 'C/Amn', label: 'C/Amn — Cadet Airman', group: 'airman' },
    { value: 'C/A1C', label: 'C/A1C — Cadet Airman First Class', group: 'airman' },
    { value: 'C/SrA', label: 'C/SrA — Cadet Senior Airman', group: 'airman' },
    { value: 'C/SSgt', label: 'C/SSgt — Cadet Staff Sergeant', group: 'nco_officer' },
    { value: 'C/TSgt', label: 'C/TSgt — Cadet Technical Sergeant', group: 'nco_officer' },
    { value: 'C/MSgt', label: 'C/MSgt — Cadet Master Sergeant', group: 'nco_officer' },
    { value: 'C/SMSgt', label: 'C/SMSgt — Cadet Senior Master Sergeant', group: 'nco_officer' },
    { value: 'C/CMSgt', label: 'C/CMSgt — Cadet Chief Master Sergeant', group: 'nco_officer' },
    { value: 'C/2d Lt', label: 'C/2d Lt — Cadet Second Lieutenant', group: 'nco_officer' },
    { value: 'C/1st Lt', label: 'C/1st Lt — Cadet First Lieutenant', group: 'nco_officer' },
    { value: 'C/Capt', label: 'C/Capt — Cadet Captain', group: 'nco_officer' },
    { value: 'C/Maj', label: 'C/Maj — Cadet Major', group: 'nco_officer' },
    { value: 'C/Lt Col', label: 'C/Lt Col — Cadet Lieutenant Colonel', group: 'nco_officer' },
    { value: 'C/Col', label: 'C/Col — Cadet Colonel', group: 'nco_officer' }
  ];

  const CRITERIA = [
    { key: 'personal_appearance', title: 'Personal Appearance', description: 'Haircut, tapered appearance, sideburns, clean overall appearance, cosmetics, and shave.' },
    { key: 'garments', title: 'Garments', description: 'Clean, sized appropriately, pressed/ironed, free of lint and loose strings, and shirt properly tucked.' },
    { key: 'accoutrements', title: 'Accoutrements', description: 'Patches, insignia, ribbon order, placement, and gig line.' },
    { key: 'footwear', title: 'Footwear', description: 'Shined or brushed as appropriate, free of mud/debris, and pants properly bloused when required.' },
    { key: 'military_bearing', title: 'Military Bearing', description: 'Posture, military courtesies, focus on task, and attentiveness to the evaluator.' }
  ];

  const SCORE_LABELS = ['Needs Improvement', 'Satisfactory', 'Excellent'];
  const DEFAULT_GRADING_RULES = {
    airman: { passing_min: 4, excellent_min: 6 },
    nco_officer: { passing_min: 5, excellent_min: 8 }
  };
  const $ = (id) => document.getElementById(id);

  const LS = {
    users: 'cap_uniform_demo_users_v1',
    session: 'cap_uniform_demo_session_v1',
    cadets: 'cap_uniform_demo_cadets_v1',
    inspections: 'cap_uniform_demo_inspections_v1',
    gradingRules: 'cap_uniform_demo_grading_rules_v1',
    units: 'cap_uniform_demo_units_v1'
  };

  const memoryStore = {};

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    populateGrades();
    renderCriteria();
    bindUI();
    $('inspectionDate').value = localDateISO();
    $('bulkInspectionDate').value = localDateISO();
    $('modeBadge').textContent = isDemo ? 'Demo / browser-only storage' : 'Supabase + offline tablet storage';

    setupPWA();

    if (offlineStore) {
      try {
        await offlineStore.init();
        await requestPersistentStorage();
      } catch (err) {
        console.warn('Offline storage unavailable:', err);
      }
    }

    if (isDemo) {
      $('demoHint').classList.remove('hidden');
      await ensureDemoAdmin();
      await ensureDemoUnit();
    } else {
      if (!CONFIG.supabaseUrl || !CONFIG.supabasePublishableKey) {
        $('loginMessage').textContent = 'Supabase mode is enabled, but config.js is missing the project URL or publishable key.';
        $('loginMessage').className = 'form-message error';
        return;
      }
      if (window.supabase?.createClient) {
        sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabasePublishableKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
      } else {
        sb = null;
        console.warn('Supabase library is not currently available. Offline cached mode can still be used.');
      }
    }

    gradingRules = isDemo ? loadDemoGradingRules() : ((offlineStore && await offlineStore.getCachedGradingRules().catch(() => null)) || cloneDefaultRules());
    seedBulkRows(8);
    updateGradingRuleForm();
    updateLiveScore();

    window.addEventListener('online', handleConnectionRestored);
    window.addEventListener('offline', updateSyncStatus);

    // The login overlay still appears every time. If this tablet has previously
    // authenticated, an offline continuation button is offered when no network exists.
    showLogin();
    await updateOfflineLoginOption();
    await updateSyncStatus();
  }

  function bindUI() {
    $('loginForm').addEventListener('submit', handleLogin);
    $('offlineContinueBtn')?.addEventListener('click', handleOfflineContinue);
    $('logoutBtn').addEventListener('click', handleLogout);
    $('syncNowBtn')?.addEventListener('click', () => syncPendingInspections({ showToast: true, refreshAfter: true }));
    $('installPwaBtn')?.addEventListener('click', installPWA);
    $('refreshOfflineBtn')?.addEventListener('click', refreshOfflineCacheFromServer);
    document.querySelectorAll('.main-tab').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
    document.querySelectorAll('.subtab').forEach(btn => btn.addEventListener('click', () => switchReport(btn.dataset.report)));
    $('cadetGrade').addEventListener('change', updateLiveScore);
    $('capid').addEventListener('blur', autofillCadet);
    $('inspectionForm').addEventListener('submit', saveInspectionFromForm);
    $('historyCadetSelect').addEventListener('change', renderSelectedCadetHistory);
    $('historyUnitFilter').addEventListener('change', async () => { await refreshCadetSelectors(); await renderSelectedCadetHistory(); });
    $('historyDateRange').addEventListener('change', () => { toggleCustomDates('history'); renderSelectedCadetHistory(); });
    $('historyStartDate').addEventListener('change', renderSelectedCadetHistory);
    $('historyEndDate').addEventListener('change', renderSelectedCadetHistory);
    $('dashboardUnitFilter').addEventListener('change', renderDashboard);
    $('dashboardDateRange').addEventListener('change', () => { toggleCustomDates('dashboard'); renderDashboard(); });
    $('dashboardStartDate').addEventListener('change', renderDashboard);
    $('dashboardEndDate').addEventListener('change', renderDashboard);
    $('inspectorUnitFilter').addEventListener('change', renderInspectorAnalysis);
    $('inspectorDateRange').addEventListener('change', () => { toggleCustomDates('inspector'); renderInspectorAnalysis(); });
    $('inspectorStartDate').addEventListener('change', renderInspectorAnalysis);
    $('inspectorEndDate').addEventListener('change', renderInspectorAnalysis);
    $('printCadetBtn').addEventListener('click', () => window.print());
    $('exportCadetBtn').addEventListener('click', exportSelectedCadetCSV);
    $('exportAllBtn').addEventListener('click', exportAllCSV);
    $('exportInspectorBtn').addEventListener('click', exportInspectorAnalysisCSV);
    $('createUserForm').addEventListener('submit', handleCreateUser);
    $('bulkAddRowBtn').addEventListener('click', () => addBulkRow());
    $('bulkAdd10Btn').addEventListener('click', () => seedBulkRows(10));
    $('bulkClearBtn').addEventListener('click', clearBulkTable);
    $('bulkSubmitBtn').addEventListener('click', saveBulkInspections);
    $('gradingRulesForm').addEventListener('submit', handleSaveGradingRules);
    $('resetRulesBtn').addEventListener('click', restoreDefaultGradingRules);
    $('unitForm').addEventListener('submit', handleSaveUnit);
    $('cancelUnitEditBtn').addEventListener('click', resetUnitForm);
    $('assignLegacyBtn').addEventListener('click', assignLegacyRecords);
    ['airmanPassMin','airmanExcellentMin','ncoPassMin','ncoExcellentMin'].forEach(id => $(id).addEventListener('input', previewGradingRules));
  }

  function populateGrades() {
    // The complete grade list is written directly into index.html so the
    // dropdown is visible even before JavaScript executes. Repair it only
    // if a customized page removed the options.
    const sel = $('cadetGrade');
    if (!sel) return;
    if (sel.options.length <= 1) {
      sel.innerHTML = '<option value="">Select cadet grade...</option>' +
        GRADES.map(g => `<option value="${g.value}">${g.label}</option>`).join('');
    }
  }

  function renderCriteria() {
    // Inspection controls are also explicit HTML dropdowns. JavaScript only
    // wires them to the live score calculator.
    document.querySelectorAll('.inspection-rating').forEach(el => {
      el.addEventListener('change', updateLiveScore);
    });
    updateLiveScore();
  }

  function localDateISO(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function gradeGroup(grade) {
    return GRADES.find(g => g.value === grade)?.group || 'airman';
  }

  function calculateRating(group, total) {
    const rules = (gradingRules && gradingRules[group]) || DEFAULT_GRADING_RULES[group] || DEFAULT_GRADING_RULES.airman;
    if (total < Number(rules.passing_min)) return { rating: 'Needs Improvement', passed: false };
    if (total < Number(rules.excellent_min)) return { rating: 'Satisfactory', passed: true };
    return { rating: 'Excellent', passed: true };
  }

  function cloneDefaultRules() {
    return JSON.parse(JSON.stringify(DEFAULT_GRADING_RULES));
  }

  function ruleText(group, prefix = '') {
    const r = (gradingRules && gradingRules[group]) || DEFAULT_GRADING_RULES[group];
    const failMax = Math.max(0, Number(r.passing_min) - 1);
    const satMax = Math.max(Number(r.passing_min), Number(r.excellent_min) - 1);
    return `${prefix}0–${failMax} Needs Improvement (not passing), ${r.passing_min}–${satMax} Satisfactory (passing), ${r.excellent_min}–10 Excellent (passing).`;
  }


  function getScoresFromForm() {
    const scores = {};
    let complete = true;
    for (const c of CRITERIA) {
      const selected = document.querySelector(`select[name="${c.key}"]`);
      const hasValue = selected && selected.value !== '';
      if (!hasValue) complete = false;
      scores[c.key] = hasValue ? Number(selected.value) : 0;
    }
    return { scores, complete };
  }

  function updateLiveScore() {
    const { scores, complete } = getScoresFromForm();
    const total = Object.values(scores).reduce((a, b) => a + b, 0);

    // Show the numeric point value beside every inspection dropdown.
    for (const c of CRITERIA) {
      const select = document.querySelector(`select[name="${c.key}"]`);
      const output = document.querySelector(`[data-score-output="${c.key}"]`);
      const row = document.querySelector(`[data-criterion="${c.key}"]`);
      if (output) output.textContent = select && select.value !== '' ? select.value : '—';
      if (row) {
        if (select && select.value !== '') row.dataset.score = select.value;
        else row.removeAttribute('data-score');
      }
    }

    const group = gradeGroup($('cadetGrade').value);
    const result = calculateRating(group, total);
    $('totalScore').textContent = String(total);

    const rating = $('overallRating');
    const pass = $('passStatus');
    if (!complete) {
      rating.textContent = 'Incomplete';
      rating.className = 'status-badge neutral';
      pass.textContent = 'NOT SCORED';
      pass.className = 'status-badge neutral';
    } else {
      rating.textContent = result.rating;
      rating.className = `status-badge ${ratingClass(result.rating)}`;
      pass.textContent = result.passed ? 'PASSING' : 'NOT PASSING';
      pass.className = `status-badge ${result.passed ? 'pass' : 'fail'}`;
    }

    const grade = $('cadetGrade').value;
    if (!grade) {
      $('gradeRule').textContent = 'Select a grade to display the applicable passing standard.';
    } else if (group === 'airman') {
      $('gradeRule').innerHTML = `<strong>Airman standard:</strong> ${ruleText('airman')}`;
    } else {
      $('gradeRule').innerHTML = `<strong>NCO / Officer standard:</strong> ${ruleText('nco_officer')}`;
    }
  }

  function ratingClass(rating) {
    if (rating === 'Excellent') return 'excellent';
    if (rating === 'Satisfactory') return 'satisfactory';
    return 'needs';
  }

  async function handleLogin(e) {
    e.preventDefault();
    setMessage('loginMessage', '', '');
    const email = $('loginEmail').value.trim().toLowerCase();
    const password = $('loginPassword').value;
    try {
      let profile;
      if (isDemo) {
        const users = loadLS(LS.users, []);
        const hash = await hashPassword(password);
        const user = users.find(u => u.email.toLowerCase() === email && u.password_hash === hash);
        if (!user) throw new Error('Invalid username or password.');
        saveSession(user.id);
        profile = stripPassword(user);
      } else {
        if (!navigator.onLine) throw new Error('No internet connection. Use Continue Offline if this tablet has been signed in before.');
        if (!sb) throw new Error('The Supabase connection library is not loaded. Refresh this page while online, then try again.');
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        profile = await loadSupabaseProfile(data.user.id);
        if (offlineStore) await offlineStore.cacheProfile(profile).catch(console.warn);
      }
      offlineSession = false;
      await enterApp(profile, { onlineLogin: !isDemo });
    } catch (err) {
      setMessage('loginMessage', err.message || String(err), 'error');
      await updateOfflineLoginOption();
    }
  }

  async function handleOfflineContinue() {
    if (isDemo || !offlineStore) return;
    const profile = await offlineStore.getCachedProfile().catch(() => null);
    if (!profile) return setMessage('loginMessage', 'This tablet does not have a previously authorized user cached yet. Connect to the internet and sign in once.', 'error');
    offlineSession = true;
    await enterApp(profile, { onlineLogin: false });
    toast('Offline mode — inspections will queue on this tablet');
  }

  async function handleLogout() {
    if (isDemo) removeSession();
    else if (navigator.onLine) await sb.auth.signOut().catch(() => {});
    currentProfile = null;
    offlineSession = false;
    showLogin();
    await updateOfflineLoginOption();
    await updateSyncStatus();
  }


  async function getCurrentProfile() {
    if (isDemo) {
      const id = loadSession();
      if (!id) return null;
      const user = loadLS(LS.users, []).find(u => u.id === id);
      return user ? stripPassword(user) : null;
    }
    const { data } = await sb.auth.getSession();
    if (!data.session?.user) return null;
    return loadSupabaseProfile(data.session.user.id);
  }

  async function loadSupabaseProfile(id) {
    const { data, error } = await sb.from('profiles').select('*').eq('id', id).single();
    if (error) throw new Error(`Signed in, but no authorized profile was found: ${error.message}`);
    return data;
  }

  async function enterApp(profile, { onlineLogin = false } = {}) {
    currentProfile = profile;
    if (offlineStore && !isDemo) await offlineStore.cacheProfile(profile).catch(console.warn);

    try {
      gradingRules = await loadGradingRules();
    } catch (err) {
      console.warn('Could not load grading rules; using cached/default rules.', err);
      gradingRules = (offlineStore && await offlineStore.getCachedGradingRules().catch(() => null)) || cloneDefaultRules();
    }
    try { unitsCache = await listUnits(); } catch (err) { console.warn('Could not load units.', err); unitsCache = []; }
    try { inspectorDirectory = await listInspectorDirectory(); } catch (err) { console.warn('Could not load inspector directory.', err); inspectorDirectory = []; }
    populateUnitSelectors();
    updateGradingRuleForm();
    updateLiveScore();
    refreshAllBulkRows();
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('app-locked');
    $('appView').setAttribute('aria-hidden', 'false');
    $('appView').inert = false;
    $('signedInAs').textContent = `${profile.display_name || profile.email} · ${profile.role}${offlineSession ? ' · Offline' : ''}`;
    $('usersTab').classList.toggle('admin-disabled', profile.role !== 'admin');
    $('usersTab').setAttribute('aria-disabled', profile.role !== 'admin' ? 'true' : 'false');
    $('usersTab').title = profile.role === 'admin' ? 'Administration' : 'Administrator access required';
    switchView('inspectionView');

    if (!isDemo && navigator.onLine && onlineLogin) {
      await syncPendingInspections({ showToast: false, refreshAfter: false });
      await refreshOfflineCacheFromServer({ quiet: true });
    }

    await refreshCadetSelectors();
    if (profile.role === 'admin') {
      if (navigator.onLine || isDemo) await refreshUsers();
      await refreshUnitsAdmin();
    }
    await updateSyncStatus();
    setTimeout(() => $('capid').focus(), 0);
  }

  function showLogin() {
    $('appView').classList.add('app-locked');
    $('appView').setAttribute('aria-hidden', 'true');
    $('appView').inert = true;
    $('loginView').classList.remove('hidden');
    $('signedInAs').textContent = 'Not signed in';
    $('loginPassword').value = '';
    setTimeout(() => $('loginEmail').focus(), 0);
  }


  function switchView(viewId) {
    if (viewId === 'usersView' && currentProfile?.role !== 'admin') {
      toast('Administrator access required');
      return;
    }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
    document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
    $(viewId).classList.add('active-view');
    document.querySelector(`.main-tab[data-view="${viewId}"]`)?.classList.add('active');
    if (viewId === 'bulkView') {
      if (!$('bulkTableBody').children.length) seedBulkRows(8);
      refreshAllBulkRows();
      setTimeout(() => $('bulkTableBody').querySelector('.bulk-capid')?.focus(), 0);
    }
    if (viewId === 'reportsView') switchReport('historyView');
    if (viewId === 'usersView') { refreshUsers(); updateGradingRuleForm(); refreshUnitsAdmin(); }
  }

  function switchReport(reportId) {
    document.querySelectorAll('.report-panel').forEach(v => v.classList.remove('active-report-panel'));
    document.querySelectorAll('.subtab').forEach(t => t.classList.remove('active'));
    $(reportId)?.classList.add('active-report-panel');
    document.querySelector(`.subtab[data-report="${reportId}"]`)?.classList.add('active');
    if (reportId === 'historyView') {
      refreshCadetSelectors();
      if ($('historyCadetSelect').value) renderSelectedCadetHistory();
    }
    if (reportId === 'dashboardView') renderDashboard();
    if (reportId === 'inspectorView') renderInspectorAnalysis();
  }

  function gradeOptionsHtml(selected = '') {
    return '<option value="">Select grade...</option>' + GRADES.map(g => `<option value="${escapeHtml(g.value)}" ${g.value === selected ? 'selected' : ''}>${escapeHtml(g.value)}</option>`).join('');
  }

  function ratingOptionsHtml(selected = '') {
    return '<option value="">Select...</option>' + SCORE_LABELS.map((label, score) => `<option value="${score}" ${String(score) === String(selected) ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  }

  function seedBulkRows(count = 8) {
    for (let i = 0; i < count; i++) addBulkRow();
    updateBulkSummary();
  }

  function addBulkRow(data = {}) {
    const tbody = $('bulkTableBody');
    const tr = document.createElement('tr');
    tr.className = 'bulk-entry-row';
    tr.dataset.rowId = String(++bulkRowSerial);
    tr.innerHTML = `
      <td><input class="bulk-capid" inputmode="numeric" maxlength="12" value="${escapeHtml(data.capid || '')}" placeholder="CAPID"></td>
      <td><input class="bulk-last-name" value="${escapeHtml(data.last_name || '')}" placeholder="Last"></td>
      <td><input class="bulk-first-name" value="${escapeHtml(data.first_name || '')}" placeholder="First"></td>
      <td><select class="bulk-grade">${gradeOptionsHtml(data.grade || '')}</select></td>
      ${CRITERIA.map(c => `<td><select class="bulk-rating" data-key="${c.key}" title="${escapeHtml(c.title + ': ' + c.description)}">${ratingOptionsHtml(data[c.key] ?? '')}</select></td>`).join('')}
      <td><span class="bulk-score">0/10</span></td>
      <td><span class="bulk-result incomplete">Incomplete</span></td>
      <td><button class="bulk-remove" type="button" title="Remove row">×</button></td>`;
    tbody.appendChild(tr);
    tr.querySelectorAll('input,select').forEach(el => el.addEventListener('input', () => { tr.classList.remove('bulk-row-error'); updateBulkRow(tr); }));
    tr.querySelector('.bulk-capid').addEventListener('blur', () => autofillBulkCadet(tr));
    tr.querySelector('.bulk-remove').addEventListener('click', () => { tr.remove(); updateBulkSummary(); });
    updateBulkRow(tr);
    return tr;
  }

  function getBulkRowData(tr) {
    const scores = {};
    let scoresComplete = true;
    tr.querySelectorAll('.bulk-rating').forEach(sel => {
      if (sel.value === '') scoresComplete = false;
      scores[sel.dataset.key] = sel.value === '' ? 0 : Number(sel.value);
    });
    const capid = tr.querySelector('.bulk-capid').value.trim();
    const last_name = tr.querySelector('.bulk-last-name').value.trim();
    const first_name = tr.querySelector('.bulk-first-name').value.trim();
    const grade = tr.querySelector('.bulk-grade').value;
    const blank = !capid && !last_name && !first_name && !grade && [...tr.querySelectorAll('.bulk-rating')].every(s => s.value === '');
    const complete = Boolean(capid && last_name && first_name && grade && scoresComplete);
    const total = Object.values(scores).reduce((a,b) => a + Number(b), 0);
    const group = gradeGroup(grade);
    const result = calculateRating(group, total);
    return { capid, last_name, first_name, name: `${first_name} ${last_name}`.trim(), grade, scores, blank, complete, total, group, result };
  }

  function updateBulkRow(tr) {
    const row = getBulkRowData(tr);
    tr.querySelector('.bulk-score').textContent = `${row.total}/10`;
    const resultEl = tr.querySelector('.bulk-result');
    if (!row.complete) {
      resultEl.textContent = 'Incomplete';
      resultEl.className = 'bulk-result incomplete';
    } else {
      resultEl.textContent = row.result.passed ? 'PASS' : 'FAIL';
      resultEl.className = `bulk-result ${row.result.passed ? 'pass' : 'fail'}`;
      resultEl.title = row.result.rating;
    }
    updateBulkSummary();
  }

  function refreshAllBulkRows() {
    document.querySelectorAll('.bulk-entry-row').forEach(updateBulkRow);
  }

  function updateBulkSummary() {
    const rows = [...document.querySelectorAll('.bulk-entry-row')].map(getBulkRowData);
    const ready = rows.filter(r => r.complete).length;
    const partial = rows.filter(r => !r.blank && !r.complete).length;
    $('bulkRowCount').textContent = `${ready} inspection${ready === 1 ? '' : 's'} ready${partial ? ` · ${partial} incomplete row${partial === 1 ? '' : 's'}` : ''}`;
  }

  async function autofillBulkCadet(tr) {
    const capid = tr.querySelector('.bulk-capid').value.trim();
    if (!capid) return;
    try {
      const cadets = await listCadets();
      const cadet = cadets.find(c => c.capid === capid);
      if (cadet) {
        tr.querySelector('.bulk-last-name').value = cadet.last_name || splitLegacyName(cadet.name).last_name;
        tr.querySelector('.bulk-first-name').value = cadet.first_name || splitLegacyName(cadet.name).first_name;
        tr.querySelector('.bulk-grade').value = cadet.grade;
        updateBulkRow(tr);
      }
    } catch (err) { console.warn(err); }
  }

  function clearBulkTable() {
    if ([...document.querySelectorAll('.bulk-entry-row input,.bulk-entry-row select')].some(el => el.value)) {
      if (!confirm('Clear all bulk-entry rows? Unsaved entries will be lost.')) return;
    }
    $('bulkTableBody').innerHTML = '';
    bulkRowSerial = 0;
    $('bulkInspectionDate').value = localDateISO();
    setMessage('bulkMessage', '', '');
    seedBulkRows(8);
  }

  async function saveBulkInspections() {
    setMessage('bulkMessage', '', '');
    const date = $('bulkInspectionDate').value;
    const unitId = $('bulkUnit').value;
    if (!unitId) return setMessage('bulkMessage', 'Select the unit for this inspection group.', 'error');
    if (!date) return setMessage('bulkMessage', 'Choose an inspection date.', 'error');
    const trs = [...document.querySelectorAll('.bulk-entry-row')];
    const parsed = trs.map(tr => ({ tr, row: getBulkRowData(tr) }));
    const partial = parsed.filter(x => !x.row.blank && !x.row.complete);
    trs.forEach(tr => tr.classList.remove('bulk-row-error'));
    partial.forEach(x => x.tr.classList.add('bulk-row-error'));
    if (partial.length) {
      setMessage('bulkMessage', `Complete or clear ${partial.length} highlighted row${partial.length === 1 ? '' : 's'} before submitting.`, 'error');
      partial[0].tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const ready = parsed.filter(x => x.row.complete);
    if (!ready.length) return setMessage('bulkMessage', 'There are no completed inspections to submit.', 'error');

    const button = $('bulkSubmitBtn');
    button.disabled = true;
    button.textContent = `Saving ${ready.length} to tablet...`;
    let saved = 0;
    try {
      for (const { row } of ready) {
        await saveInspectionLocalFirst({ capid: row.capid, first_name: row.first_name, last_name: row.last_name, name: row.name, grade: row.grade, current_unit_id: Number(unitId) }, {
          unit_id: Number(unitId), inspection_date: date, grade_at_inspection: row.grade, grade_group: row.group,
          ...row.scores, notes: null, evaluator_id: currentProfile.id, total_score: row.total,
          overall_rating: row.result.rating, passed: row.result.passed
        });
        saved++;
      }

      if (!isDemo && navigator.onLine) await syncPendingInspections({ showToast: false, refreshAfter: true });
      const queued = await getPendingCount();
      const message = queued
        ? `Saved ${saved} inspection${saved === 1 ? '' : 's'} on this tablet. ${queued} waiting to sync.`
        : `Saved and synchronized ${saved} inspection${saved === 1 ? '' : 's'}.`;
      setMessage('bulkMessage', message, 'success');
      toast(queued ? `${saved} saved · ${queued} pending sync` : `${saved} inspections synced`);
      $('bulkTableBody').innerHTML = '';
      bulkRowSerial = 0;
      seedBulkRows(8);
      await refreshCadetSelectors();
      await updateSyncStatus();
    } catch (err) {
      setMessage('bulkMessage', `Saved ${saved} before an error occurred: ${err.message || err}`, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Submit All Inspections';
    }
  }

  function loadDemoGradingRules() {
    const stored = loadLS(LS.gradingRules, null);
    if (!stored?.airman || !stored?.nco_officer) return cloneDefaultRules();
    return stored;
  }

  async function loadGradingRules() {
    if (isDemo) return loadDemoGradingRules();
    if (navigator.onLine) {
      try {
        const { data, error } = await sb.from('grading_rules').select('grade_group,passing_min,excellent_min');
        if (error) throw error;
        const rules = cloneDefaultRules();
        (data || []).forEach(r => { rules[r.grade_group] = { passing_min: Number(r.passing_min), excellent_min: Number(r.excellent_min) }; });
        if (offlineStore) await offlineStore.cacheGradingRules(rules).catch(console.warn);
        return rules;
      } catch (err) {
        console.warn('Using cached grading rules because the server could not be reached.', err);
      }
    }
    return (offlineStore && await offlineStore.getCachedGradingRules().catch(() => null)) || cloneDefaultRules();
  }

  function updateGradingRuleForm() {
    const rules = gradingRules || cloneDefaultRules();
    if (!$('airmanPassMin')) return;
    $('airmanPassMin').value = rules.airman.passing_min;
    $('airmanExcellentMin').value = rules.airman.excellent_min;
    $('ncoPassMin').value = rules.nco_officer.passing_min;
    $('ncoExcellentMin').value = rules.nco_officer.excellent_min;
    previewGradingRules();
  }

  function readRulesFromAdminForm() {
    return {
      airman: { passing_min: Number($('airmanPassMin').value), excellent_min: Number($('airmanExcellentMin').value) },
      nco_officer: { passing_min: Number($('ncoPassMin').value), excellent_min: Number($('ncoExcellentMin').value) }
    };
  }

  function validateRule(rule) {
    return Number.isInteger(rule.passing_min) && Number.isInteger(rule.excellent_min) && rule.passing_min >= 0 && rule.excellent_min <= 10 && rule.passing_min <= rule.excellent_min;
  }

  function previewGradingRules() {
    if (!$('airmanRulePreview')) return;
    const candidate = readRulesFromAdminForm();
    const textFor = (r) => {
      if (!validateRule(r)) return '<strong>Invalid:</strong> passing must be 0–10 and cannot be higher than Excellent.';
      return `Needs Improvement: 0–${Math.max(0,r.passing_min-1)} · Satisfactory: ${r.passing_min}–${Math.max(r.passing_min,r.excellent_min-1)} · Excellent: ${r.excellent_min}–10`;
    };
    $('airmanRulePreview').innerHTML = textFor(candidate.airman);
    $('ncoRulePreview').innerHTML = textFor(candidate.nco_officer);
  }

  async function handleSaveGradingRules(e) {
    e.preventDefault();
    if (currentProfile?.role !== 'admin') return;
    const candidate = readRulesFromAdminForm();
    if (!validateRule(candidate.airman) || !validateRule(candidate.nco_officer)) {
      return setMessage('gradingRulesMessage', 'Correct the grading thresholds before saving.', 'error');
    }
    if (!isDemo && !navigator.onLine) {
      return setMessage('gradingRulesMessage', 'Changing grading standards requires an internet connection so every device receives the same rules.', 'error');
    }
    try {
      if (isDemo) {
        saveLS(LS.gradingRules, candidate);
      } else {
        const rows = Object.entries(candidate).map(([grade_group, r]) => ({ grade_group, passing_min: r.passing_min, excellent_min: r.excellent_min, updated_by: currentProfile.id, updated_at: new Date().toISOString() }));
        const { error } = await sb.from('grading_rules').upsert(rows, { onConflict: 'grade_group' });
        if (error) throw error;
        if (offlineStore) await offlineStore.cacheGradingRules(candidate).catch(console.warn);
      }
      gradingRules = candidate;
      updateLiveScore();
      refreshAllBulkRows();
      setMessage('gradingRulesMessage', 'Grading standards saved.', 'success');
      toast('Grading standards updated');
    } catch (err) {
      setMessage('gradingRulesMessage', err.message || String(err), 'error');
    }
  }

  function restoreDefaultGradingRules() {
    gradingRules = cloneDefaultRules();
    updateGradingRuleForm();
    setMessage('gradingRulesMessage', 'Default values loaded. Click Save Grading Standards to apply them.', '');
  }

  async function autofillCadet() {
    const capid = $('capid').value.trim();
    if (!capid) return;
    const cadets = await listCadets();
    const cadet = cadets.find(c => c.capid === capid);
    if (cadet) {
      const legacy = splitLegacyName(cadet.name);
      $('cadetFirstName').value = cadet.first_name || legacy.first_name;
      $('cadetLastName').value = cadet.last_name || legacy.last_name;
      $('cadetGrade').value = cadet.grade;
      if (cadet.current_unit_id && [...$('inspectionUnit').options].some(o => o.value === String(cadet.current_unit_id))) $('inspectionUnit').value = String(cadet.current_unit_id);
      updateLiveScore();
      toast(`Loaded ${cadetDisplayName(cadet)}`);
    }
  }

  async function saveInspectionFromForm(e) {
    e.preventDefault();
    setMessage('inspectionMessage', '', '');
    const button = $('saveInspectionBtn');
    const { scores, complete } = getScoresFromForm();
    if (!complete) return setMessage('inspectionMessage', 'Score all five inspection categories before saving.', 'error');

    const capid = $('capid').value.trim();
    const first_name = $('cadetFirstName').value.trim();
    const last_name = $('cadetLastName').value.trim();
    const grade = $('cadetGrade').value;
    const date = $('inspectionDate').value;
    const unitId = $('inspectionUnit').value;
    if (!capid || !first_name || !last_name || !grade || !date || !unitId) return setMessage('inspectionMessage', 'Complete the unit, cadet information, and date.', 'error');
    const name = `${first_name} ${last_name}`.trim();

    const group = gradeGroup(grade);
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    const result = calculateRating(group, total);
    button.disabled = true;
    button.textContent = 'Saving to tablet...';

    try {
      await saveInspectionLocalFirst({ capid, first_name, last_name, name, grade, current_unit_id: Number(unitId) }, {
        unit_id: Number(unitId), inspection_date: date, grade_at_inspection: grade, grade_group: group,
        ...scores, notes: $('notes').value.trim() || null, evaluator_id: currentProfile.id,
        total_score: total, overall_rating: result.rating, passed: result.passed
      });

      if (!isDemo && navigator.onLine) await syncPendingInspections({ showToast: false, refreshAfter: true });
      const pending = await getPendingCount();
      const syncText = pending ? ` Saved on this tablet; ${pending} inspection${pending === 1 ? '' : 's'} waiting to sync.` : ' Synchronized with Supabase.';
      setMessage('inspectionMessage', `Saved: ${last_name}, ${first_name} — ${total}/10, ${result.rating}, ${result.passed ? 'Passing' : 'Not Passing'}.${syncText}`, 'success');
      toast(pending ? 'Inspection saved offline' : 'Inspection saved and synced');
      clearInspectionForm();
      await refreshCadetSelectors();
      await updateSyncStatus();
    } catch (err) {
      setMessage('inspectionMessage', err.message || String(err), 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Submit Inspection';
    }
  }

  function clearInspectionForm() {
    $('capid').value = '';
    $('cadetFirstName').value = '';
    $('cadetLastName').value = '';
    $('cadetGrade').value = '';
    $('notes').value = '';
    document.querySelectorAll('.inspection-rating').forEach(i => i.value = '');
    $('inspectionDate').value = localDateISO();
    updateLiveScore();
  }

  async function refreshCadetSelectors() {
    const [cadets, inspections] = await Promise.all([listCadets(), listInspections()]);
    const sel = $('historyCadetSelect');
    const prior = sel.value;
    const unitFilter = $('historyUnitFilter')?.value || 'all';
    let filtered = cadets;
    if (unitFilter !== 'all') {
      const idsWithHistory = new Set(inspections.filter(i => unitMatches(i, unitFilter)).map(i => inspectionCadetKey(i)));
      filtered = cadets.filter(c => unitFilter === 'unassigned'
        ? !c.current_unit_id || idsWithHistory.has(cadetKey(c))
        : String(c.current_unit_id || '') === String(unitFilter) || idsWithHistory.has(cadetKey(c)));
    }
    sel.innerHTML = '<option value="">Select cadet...</option>' + filtered
      .sort((a,b) => cadetSortName(a).localeCompare(cadetSortName(b)))
      .map(c => `<option value="${escapeHtml(cadetKey(c))}">${escapeHtml(cadetDisplayName(c))} — ${escapeHtml(c.grade)} — ${escapeHtml(c.capid)}</option>`).join('');
    if ([...sel.options].some(o => o.value === prior)) sel.value = prior;
  }

  async function renderSelectedCadetHistory() {
    const selectedKey = $('historyCadetSelect').value;
    if (!selectedKey) {
      $('historyEmpty').classList.remove('hidden');
      $('historyContent').classList.add('hidden');
      $('historyFilterSummary').textContent = reportFilterSummary('history');
      return;
    }
    const [cadets, inspections] = await Promise.all([listCadets(), listInspections()]);
    const cadet = cadets.find(c => cadetKey(c) === selectedKey);
    const range = getReportDateRange('history');
    const unitFilter = $('historyUnitFilter').value;
    const rows = inspections.filter(i => inspectionBelongsToCadet(i, cadet, selectedKey) && unitMatches(i, unitFilter) && dateMatches(i.inspection_date, range))
      .sort((a,b) => a.inspection_date.localeCompare(b.inspection_date));

    $('historyFilterSummary').textContent = reportFilterSummary('history');
    $('historyEmpty').classList.add('hidden');
    $('historyContent').classList.remove('hidden');
    const avg = rows.length ? average(rows.map(r => r.total_score)) : 0;
    const passRate = rows.length ? Math.round(rows.filter(r => r.passed).length / rows.length * 100) : 0;
    const latest = rows.length ? rows[rows.length - 1] : null;
    const highest = rows.length ? Math.max(...rows.map(r => Number(r.total_score))) : 0;
    const lowest = rows.length ? Math.min(...rows.map(r => Number(r.total_score))) : 0;
    $('cadetStats').innerHTML = [
      statCard('Cadet', cadetDisplayName(cadet || {}), `${cadet?.grade || ''} · CAPID ${cadet?.capid || ''}`),
      statCard('Inspections', rows.length, rows.length ? `Range ${formatRange(range)}` : 'No inspections in selected range'),
      statCard('Average Score', avg.toFixed(1), rows.length ? `High ${highest} · Low ${lowest}` : 'Out of 10'),
      statCard('Pass Rate', `${passRate}%`, latest ? `Latest: ${latest.total_score}/10 ${latest.overall_rating}` : 'No inspections')
    ].join('');

    $('historyTableBody').innerHTML = rows.slice().reverse().map(r => `
      <tr><td>${formatDate(r.inspection_date)}</td><td>${escapeHtml(unitLabelForInspection(r))}</td><td>${escapeHtml(r.grade_at_inspection)}</td>
      <td>${r.personal_appearance}</td><td>${r.garments}</td><td>${r.accoutrements}</td><td>${r.footwear}</td><td>${r.military_bearing}</td>
      <td><strong>${r.total_score}/10</strong></td><td>${escapeHtml(r.overall_rating)}</td><td>${r.passed ? 'Pass' : 'Not Pass'}</td></tr>`).join('') || '<tr><td colspan="11">No inspections in this date/unit range.</td></tr>';

    if (globalThis.Chart) {
      if (chartCadet) chartCadet.destroy();
      chartCadet = new Chart($('cadetTrendChart'), {
        type: 'line', data: { labels: rows.map(r => shortDate(r.inspection_date)), datasets: [{ label: 'Overall score', data: rows.map(r => r.total_score), tension: .25 }] },
        options: { responsive: true, maintainAspectRatio: true, scales: { y: { min: 0, max: 10, ticks: { stepSize: 1 } } } }
      });
    }
  }

  async function renderDashboard() {
    const allInspections = await listInspections();
    const cadets = await listCadets();
    const range = getReportDateRange('dashboard');
    const unitFilter = $('dashboardUnitFilter').value;
    const inspections = allInspections.filter(i => unitMatches(i, unitFilter) && dateMatches(i.inspection_date, range));
    $('dashboardFilterSummary').textContent = reportFilterSummary('dashboard');
    const total = inspections.length;
    const avgScore = total ? average(inspections.map(i => i.total_score)) : 0;
    const passRate = total ? Math.round(inspections.filter(i => i.passed).length / total * 100) : 0;
    const medianScore = total ? median(inspections.map(i => Number(i.total_score))) : 0;
    $('dashboardStats').innerHTML = [
      statCard('Total Inspections', total, formatRange(range)),
      statCard('Cadets Inspected', new Set(inspections.map(i => inspectionCadetKey(i))).size, unitFilter === 'all' ? 'Across all units' : unitLabelFromFilter(unitFilter)),
      statCard('Average Score', avgScore.toFixed(1), `Median ${medianScore.toFixed(1)} · out of 10`),
      statCard('Pass Rate', `${passRate}%`, `${inspections.filter(i => i.passed).length} passing inspections`)
    ].join('');

    const categoryAverages = CRITERIA.map(c => total ? average(inspections.map(i => Number(i[c.key]))) : 0);
    const weakestIndex = total ? categoryAverages.indexOf(Math.min(...categoryAverages)) : 0;
    const ratings = {
      'Needs Improvement': inspections.filter(i => i.overall_rating === 'Needs Improvement').length,
      'Satisfactory': inspections.filter(i => i.overall_rating === 'Satisfactory').length,
      'Excellent': inspections.filter(i => i.overall_rating === 'Excellent').length
    };
    const months = {};
    inspections.forEach(i => { const month = i.inspection_date.slice(0, 7); (months[month] ||= []).push(i.total_score); });
    const monthKeys = Object.keys(months).sort();

    if (globalThis.Chart) {
      destroyChart(chartMonthly); destroyChart(chartCategory); destroyChart(chartRating);
      chartMonthly = new Chart($('monthlyTrendChart'), { type: 'line', data: { labels: monthKeys.map(formatMonth), datasets: [{ label: 'Average total', data: monthKeys.map(m => average(months[m])), tension: .25 }] }, options: { responsive: true, scales: { y: { min: 0, max: 10 } } } });
      chartCategory = new Chart($('categoryChart'), { type: 'bar', data: { labels: CRITERIA.map(c => c.title), datasets: [{ label: 'Average (0–2)', data: categoryAverages }] }, options: { responsive: true, scales: { y: { min: 0, max: 2 } } } });
      chartRating = new Chart($('ratingChart'), { type: 'doughnut', data: { labels: Object.keys(ratings), datasets: [{ data: Object.values(ratings) }] }, options: { responsive: true } });
    }

    const prior = inspections.slice().sort((a,b) => a.inspection_date.localeCompare(b.inspection_date));
    const firstHalf = prior.slice(0, Math.floor(prior.length / 2));
    const secondHalf = prior.slice(Math.floor(prior.length / 2));
    const trendDelta = firstHalf.length && secondHalf.length ? average(secondHalf.map(i => i.total_score)) - average(firstHalf.map(i => i.total_score)) : 0;
    const insights = [];
    if (!total) insights.push('No inspections match the selected unit and date range.');
    else {
      insights.push(`<strong>Most common improvement area:</strong> ${CRITERIA[weakestIndex].title} has the lowest average score at ${categoryAverages[weakestIndex].toFixed(2)}/2.`);
      insights.push(`<strong>Current pass rate:</strong> ${passRate}% across ${total} inspections.`);
      insights.push(`<strong>Median score:</strong> ${medianScore.toFixed(1)}/10; average is ${avgScore.toFixed(1)}/10.`);
      if (firstHalf.length && secondHalf.length) insights.push(`<strong>Within-range trend:</strong> the newer half averages ${Math.abs(trendDelta).toFixed(1)} points ${trendDelta >= 0 ? 'higher' : 'lower'} than the older half.`);
    }
    $('programInsights').innerHTML = insights.map(i => `<div class="insight">${i}</div>`).join('');

    $('recentTableBody').innerHTML = inspections.slice().sort((a,b) => b.inspection_date.localeCompare(a.inspection_date)).slice(0, 15).map(i => {
      const c = inspectionCadet(i, cadets);
      return `<tr><td>${formatDate(i.inspection_date)}</td><td>${escapeHtml(unitLabelForInspection(i))}</td><td>${escapeHtml(c.capid || '')}</td><td>${escapeHtml(cadetDisplayName(c))}</td><td>${escapeHtml(i.grade_at_inspection)}</td><td><strong>${i.total_score}/10</strong></td><td>${escapeHtml(i.overall_rating)}</td><td>${i.passed ? 'Pass' : 'Not Pass'}</td></tr>`;
    }).join('') || '<tr><td colspan="8">No inspections recorded for this filter.</td></tr>';
  }

  function splitLegacyName(name = '') {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return { first_name: parts[0] || '', last_name: '' };
    return { first_name: parts.slice(0, -1).join(' '), last_name: parts.at(-1) };
  }

  function normalizeCadet(c = {}) {
    const legacy = splitLegacyName(c.name);
    const first_name = c.first_name || legacy.first_name;
    const last_name = c.last_name || legacy.last_name;
    return { ...c, first_name, last_name, name: `${first_name} ${last_name}`.trim() || c.name || '' };
  }

  function cadetDisplayName(c = {}) {
    c = normalizeCadet(c);
    return [c.last_name, c.first_name].filter(Boolean).join(', ') || c.name || '';
  }
  function cadetSortName(c = {}) { return cadetDisplayName(c).toLowerCase(); }
  function cadetKey(c = {}) { return String(c.id ?? `capid:${c.capid || ''}`); }
  function inspectionCadetKey(i = {}) { return String(i.cadet_id ?? (i.capid ? `capid:${i.capid}` : '')); }
  function inspectionCadet(i, cadets = []) { return normalizeCadet(i.cadets || cadets.find(c => String(c.id) === String(i.cadet_id)) || cadets.find(c => c.capid && c.capid === i.capid) || { capid: i.capid, first_name: i.cadet_first_name, last_name: i.cadet_last_name, name: i.cadet_name, grade: i.cadet_grade }); }
  function inspectionBelongsToCadet(i, cadet, selectedKey) { return inspectionCadetKey(i) === selectedKey || (!!cadet?.capid && (i.capid === cadet.capid || i.cadets?.capid === cadet.capid)); }

  async function listUnits() {
    if (isDemo) return loadLS(LS.units, []);
    if (navigator.onLine && sb) {
      try {
        const { data, error } = await sb.from('units').select('*').order('charter_number');
        if (error) throw error;
        unitsCache = data || [];
        if (offlineStore) await offlineStore.cacheUnits(unitsCache);
        return unitsCache;
      } catch (err) { console.warn('Unit server read failed; using tablet cache.', err); }
    }
    return offlineStore ? await offlineStore.getUnits() : unitsCache;
  }

  async function listInspectorDirectory() {
    if (isDemo) return loadLS(LS.users, []).map(u => ({ id: u.id, display_name: u.display_name }));
    if (navigator.onLine && sb) {
      try {
        const { data, error } = await sb.rpc('list_inspectors');
        if (error) throw error;
        inspectorDirectory = data || [];
        if (offlineStore) await offlineStore.cacheInspectorDirectory(inspectorDirectory);
        return inspectorDirectory;
      } catch (err) { console.warn('Inspector directory read failed; using cache.', err); }
    }
    return offlineStore ? await offlineStore.getInspectorDirectory() : inspectorDirectory;
  }

  function unitOptionLabel(u) { return `${u.charter_number} — ${u.name}${u.active === false ? ' (Inactive)' : ''}`; }
  function populateUnitSelectors() {
    const prior = {};
    ['inspectionUnit','bulkUnit','historyUnitFilter','dashboardUnitFilter','inspectorUnitFilter','legacyUnitSelect'].forEach(id => { if ($(id)) prior[id] = $(id).value; });
    const activeOptions = unitsCache.map(u => `<option value="${u.id}" ${u.active === false ? 'disabled' : ''}>${escapeHtml(unitOptionLabel(u))}</option>`).join('');
    ['inspectionUnit','bulkUnit','legacyUnitSelect'].forEach(id => { if ($(id)) $(id).innerHTML = '<option value="">Select unit...</option>' + activeOptions; });
    const reportOptions = '<option value="all">All Units</option><option value="unassigned">Unassigned / Legacy</option>' + unitsCache.map(u => `<option value="${u.id}">${escapeHtml(unitOptionLabel(u))}</option>`).join('');
    ['historyUnitFilter','dashboardUnitFilter','inspectorUnitFilter'].forEach(id => { if ($(id)) $(id).innerHTML = reportOptions; });
    Object.entries(prior).forEach(([id, value]) => { if ($(id) && [...$(id).options].some(o => o.value === value)) $(id).value = value; });
    const active = unitsCache.filter(u => u.active !== false);
    if (active.length === 1) {
      if (!$('inspectionUnit').value) $('inspectionUnit').value = String(active[0].id);
      if (!$('bulkUnit').value) $('bulkUnit').value = String(active[0].id);
    }
  }

  function unitLabelFromFilter(value) {
    if (value === 'all') return 'All Units';
    if (value === 'unassigned') return 'Unassigned / Legacy';
    const u = unitsCache.find(x => String(x.id) === String(value));
    return u ? `${u.charter_number} — ${u.name}` : 'Selected Unit';
  }
  function unitLabelForInspection(i) {
    if (i.units?.charter_number) return `${i.units.charter_number} — ${i.units.name}`;
    const u = unitsCache.find(x => String(x.id) === String(i.unit_id));
    return u ? `${u.charter_number} — ${u.name}` : 'Unassigned';
  }
  function unitMatches(i, filter) { if (!filter || filter === 'all') return true; if (filter === 'unassigned') return !i.unit_id; return String(i.unit_id) === String(filter); }

  function toggleCustomDates(prefix) {
    const custom = $(`${prefix}DateRange`).value === 'custom';
    document.querySelectorAll(`.custom-${prefix}-date`).forEach(el => el.classList.toggle('hidden', !custom));
  }
  function monthsAgoISO(months) { const d = new Date(); d.setHours(12,0,0,0); d.setMonth(d.getMonth() - months); return localDateISO(d); }
  function getReportDateRange(prefix) {
    const choice = $(`${prefix}DateRange`)?.value || 'all';
    const today = localDateISO();
    if (choice === '1m') return { start: monthsAgoISO(1), end: today, label: 'Last Month' };
    if (choice === '3m') return { start: monthsAgoISO(3), end: today, label: 'Last 3 Months' };
    if (choice === '6m') return { start: monthsAgoISO(6), end: today, label: 'Last 6 Months' };
    if (choice === '12m') return { start: monthsAgoISO(12), end: today, label: 'Last 12 Months' };
    if (choice === 'ytd') return { start: `${new Date().getFullYear()}-01-01`, end: today, label: 'Year to Date' };
    if (choice === 'previous_year') { const y = new Date().getFullYear() - 1; return { start: `${y}-01-01`, end: `${y}-12-31`, label: `Calendar Year ${y}` }; }
    if (choice === 'custom') {
      const start = $(`${prefix}StartDate`)?.value || null, end = $(`${prefix}EndDate`)?.value || null;
      return { start, end, label: start || end ? `${start ? formatDate(start) : 'Beginning'} to ${end ? formatDate(end) : 'Today'}` : 'Custom Range' };
    }
    return { start: null, end: null, label: 'All Time' };
  }
  function dateMatches(date, range) { if (!date) return false; if (range.start && date < range.start) return false; if (range.end && date > range.end) return false; return true; }
  function formatRange(range) { return range?.label || 'All Time'; }
  function reportFilterSummary(prefix) { return `${unitLabelFromFilter($(`${prefix}UnitFilter`)?.value || 'all')} · ${formatRange(getReportDateRange(prefix))}`; }

  function median(values) { if (!values.length) return 0; const a = values.slice().map(Number).sort((x,y) => x-y); const m = Math.floor(a.length/2); return a.length % 2 ? a[m] : (a[m-1]+a[m])/2; }
  function sampleSD(values) { if (values.length < 2) return 0; const m = average(values); return Math.sqrt(values.reduce((sum,v) => sum + (Number(v)-m)**2,0)/(values.length-1)); }
  function signed(value, digits=2) { const n=Number(value)||0; return `${n>=0?'+':''}${n.toFixed(digits)}`; }
  function deviationClass(value) { return value > .15 ? 'metric-positive' : value < -.15 ? 'metric-negative' : 'metric-neutral'; }

  async function renderInspectorAnalysis() {
    const [allInspections, cadets] = await Promise.all([listInspections(), listCadets()]);
    if (!inspectorDirectory.length) inspectorDirectory = await listInspectorDirectory();
    const range = getReportDateRange('inspector');
    const unitFilter = $('inspectorUnitFilter').value;
    const rows = allInspections.filter(i => unitMatches(i, unitFilter) && dateMatches(i.inspection_date, range));
    $('inspectorFilterSummary').textContent = reportFilterSummary('inspector');
    const scores = rows.map(r => Number(r.total_score));
    const overallMean = average(scores), overallSD = sampleSD(scores);
    const inspectors = [...new Set(rows.map(r => r.evaluator_id).filter(Boolean))];
    const cadetId = i => inspectionCadetKey(i) || i.capid;
    const gradeBaseline = {};
    rows.forEach(r => { (gradeBaseline[r.grade_group] ||= []).push(Number(r.total_score)); });
    const catGradeBaseline = {};
    for (const c of CRITERIA) { catGradeBaseline[c.key] = {}; rows.forEach(r => (catGradeBaseline[c.key][r.grade_group] ||= []).push(Number(r[c.key]))); }

    const analysis = inspectors.map(id => {
      const mine = rows.filter(r => String(r.evaluator_id) === String(id));
      const residuals = mine.map(r => {
        const othersSameCadet = rows.filter(o => String(o.evaluator_id) !== String(id) && cadetId(o) === cadetId(r));
        const expected = othersSameCadet.length ? average(othersSameCadet.map(o => Number(o.total_score))) : average(gradeBaseline[r.grade_group] || scores);
        return Number(r.total_score) - expected;
      });
      const adjusted = average(residuals), rawAvg = average(mine.map(r => Number(r.total_score))), rawDiff = rawAvg - overallMean;
      const residualSD = sampleSD(residuals), se = residuals.length ? residualSD / Math.sqrt(residuals.length) : 0;
      const ciLow = adjusted - 1.96*se, ciHigh = adjusted + 1.96*se;
      const effect = overallSD ? adjusted / overallSD : 0;
      let assessment = 'Typical range';
      if (mine.length < 10) assessment = 'Insufficient data';
      else if (mine.length < 20) assessment = adjusted <= -.35 ? 'Preliminary: stricter' : adjusted >= .35 ? 'Preliminary: more lenient' : 'Preliminary: typical';
      else if (ciHigh < -.25) assessment = 'Likely stricter';
      else if (ciLow > .25) assessment = 'Likely more lenient';
      else if (adjusted <= -.35) assessment = 'Tends stricter';
      else if (adjusted >= .35) assessment = 'Tends more lenient';
      const categories = {};
      for (const c of CRITERIA) {
        const res = mine.map(r => {
          const other = rows.filter(o => String(o.evaluator_id) !== String(id) && cadetId(o) === cadetId(r));
          const expected = other.length ? average(other.map(o => Number(o[c.key]))) : average(catGradeBaseline[c.key][r.grade_group] || rows.map(x => Number(x[c.key])));
          return Number(r[c.key]) - expected;
        });
        categories[c.key] = average(res);
      }
      const profile = inspectorDirectory.find(p => String(p.id) === String(id));
      return { id, name: profile?.display_name || `Inspector ${String(id).slice(0,8)}`, n: mine.length, rawAvg, rawDiff, adjusted, effect, ciLow, ciHigh, assessment, categories };
    }).sort((a,b) => a.adjusted - b.adjusted);

    const matched = rows.filter(r => rows.some(o => String(o.evaluator_id) !== String(r.evaluator_id) && cadetId(o) === cadetId(r))).length;
    $('inspectorStats').innerHTML = [
      statCard('Inspectors', analysis.length, `${rows.length} inspections analyzed`),
      statCard('Overall Mean', overallMean.toFixed(2), 'Score out of 10'),
      statCard('Score SD', overallSD.toFixed(2), 'Overall score spread'),
      statCard('Matched-Cadet Coverage', rows.length ? `${Math.round(matched/rows.length*100)}%` : '0%', `${matched} inspections have cross-inspector comparison`)
    ].join('');
    $('inspectorTableBody').innerHTML = analysis.map(a => `<tr><td>${escapeHtml(a.name)}</td><td>${a.n}</td><td>${a.rawAvg.toFixed(2)}</td><td class="${deviationClass(a.rawDiff)}">${signed(a.rawDiff)}</td><td class="${deviationClass(a.adjusted)}">${signed(a.adjusted)}</td><td>${signed(a.effect)} SD</td><td>${a.n > 1 ? `${signed(a.ciLow)} to ${signed(a.ciHigh)}` : '—'}</td><td><strong>${escapeHtml(a.assessment)}</strong>${a.n < 20 ? '<div class="confidence-note">Use cautiously; small sample</div>' : ''}</td></tr>`).join('') || '<tr><td colspan="8">No inspections match this filter.</td></tr>';
    $('inspectorCategoryBody').innerHTML = analysis.map(a => `<tr><td>${escapeHtml(a.name)}</td>${CRITERIA.map(c => `<td class="${deviationClass(a.categories[c.key])}">${signed(a.categories[c.key])}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="6">No inspection data.</td></tr>';
    window.__lastInspectorAnalysis = analysis;
  }

  async function exportInspectorAnalysisCSV() {
    await renderInspectorAnalysis();
    const rows = window.__lastInspectorAnalysis || [];
    const header = ['Inspector','Inspections','Average Score','Raw Difference','Adjusted Difference','Standardized Effect SD','CI Low','CI High','Assessment',...CRITERIA.map(c => `${c.title} Adjusted Difference`)];
    const data = rows.map(a => [a.name,a.n,a.rawAvg.toFixed(3),a.rawDiff.toFixed(3),a.adjusted.toFixed(3),a.effect.toFixed(3),a.ciLow.toFixed(3),a.ciHigh.toFixed(3),a.assessment,...CRITERIA.map(c => a.categories[c.key].toFixed(3))]);
    downloadCSV([header,...data].map(r => r.map(csvCell).join(',')).join('\n'), `CAP_inspector_analysis_${localDateISO()}.csv`);
  }

  async function refreshUnitsAdmin() {
    if (currentProfile?.role !== 'admin') return;
    try { unitsCache = await listUnits(); populateUnitSelectors(); } catch (err) { console.warn(err); }
    $('unitsTableBody').innerHTML = unitsCache.map(u => `<tr><td>${escapeHtml(u.charter_number)}</td><td>${escapeHtml(u.name)}</td><td class="${u.active === false ? 'unit-status-inactive' : 'unit-status-active'}">${u.active === false ? 'Inactive' : 'Active'}</td><td><button class="secondary small-action edit-unit-btn" type="button" data-id="${u.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="4">No units configured yet.</td></tr>';
    document.querySelectorAll('.edit-unit-btn').forEach(btn => btn.addEventListener('click', () => editUnit(btn.dataset.id)));
    await updateLegacyCount();
  }

  async function handleSaveUnit(e) {
    e.preventDefault();
    if (currentProfile?.role !== 'admin') return;
    const payload = { charter_number: $('unitCharterNumber').value.trim().toUpperCase(), name: $('unitName').value.trim(), active: $('unitActive').checked };
    if (!payload.charter_number || !payload.name) return;
    if (!isDemo && !navigator.onLine) return setMessage('unitMessage', 'Unit changes require an internet connection.', 'error');
    try {
      const editId = $('editUnitId').value;
      if (isDemo) {
        const rows = loadLS(LS.units, []);
        if (editId) Object.assign(rows.find(u => String(u.id) === String(editId)), payload, { updated_at: new Date().toISOString() });
        else rows.push({ id: nextNumericId(rows), ...payload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        saveLS(LS.units, rows);
      } else {
        const query = editId ? sb.from('units').update(payload).eq('id', editId) : sb.from('units').insert(payload);
        const { error } = await query; if (error) throw error;
      }
      setMessage('unitMessage', editId ? 'Unit updated.' : 'Unit added.', 'success'); resetUnitForm(); await refreshUnitsAdmin(); await refreshCadetSelectors();
    } catch (err) { setMessage('unitMessage', err.message || String(err), 'error'); }
  }
  function editUnit(id) { const u=unitsCache.find(x=>String(x.id)===String(id)); if(!u)return; $('editUnitId').value=u.id; $('unitCharterNumber').value=u.charter_number; $('unitName').value=u.name; $('unitActive').checked=u.active!==false; $('cancelUnitEditBtn').classList.remove('hidden'); $('unitCharterNumber').focus(); }
  function resetUnitForm() { $('editUnitId').value=''; $('unitCharterNumber').value=''; $('unitName').value=''; $('unitActive').checked=true; $('cancelUnitEditBtn').classList.add('hidden'); }
  async function updateLegacyCount() {
    const [cadets, inspections] = await Promise.all([listCadets(), listInspections()]);
    const c = cadets.filter(x => !x.current_unit_id).length, i = inspections.filter(x => !x.unit_id).length;
    $('legacyRecordCount').textContent = `${c} cadet${c===1?'':'s'} and ${i} inspection${i===1?'':'s'} are currently unassigned.`;
    $('assignLegacyBtn').disabled = !(c || i) || !unitsCache.length;
  }
  async function assignLegacyRecords() {
    const unitId = $('legacyUnitSelect').value; if(!unitId) return setMessage('unitMessage','Select a destination unit first.','error');
    if (!confirm('Assign every currently unassigned cadet and historical inspection to this unit?')) return;
    if (!isDemo && !navigator.onLine) return setMessage('unitMessage','This operation requires an internet connection.','error');
    try {
      if (isDemo) {
        const cadets=loadLS(LS.cadets,[]); cadets.forEach(c=>{if(!c.current_unit_id)c.current_unit_id=Number(unitId)}); saveLS(LS.cadets,cadets);
        const inspections=loadLS(LS.inspections,[]); inspections.forEach(i=>{if(!i.unit_id)i.unit_id=Number(unitId)}); saveLS(LS.inspections,inspections);
      } else {
        const { data, error } = await sb.rpc('assign_unassigned_records',{p_unit_id:Number(unitId)}); if(error)throw error;
        toast(`Assigned ${data?.cadets||0} cadets and ${data?.inspections||0} inspections`);
        await refreshOfflineCacheFromServer({quiet:true});
      }
      setMessage('unitMessage','Unassigned records were assigned successfully.','success'); await refreshUnitsAdmin(); await refreshCadetSelectors();
    } catch(err){ setMessage('unitMessage',err.message||String(err),'error'); }
  }

  async function refreshUsers() {
    if (currentProfile?.role !== 'admin') return;
    try {
      const users = await listProfiles();
      $('usersTableBody').innerHTML = users.map(u => `<tr><td>${escapeHtml(u.display_name || '')}</td><td>${escapeHtml(u.email || '')}</td><td>${escapeHtml(u.role)}</td><td>${formatDateTime(u.created_at)}</td></tr>`).join('');
    } catch (err) {
      $('usersTableBody').innerHTML = `<tr><td colspan="4">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    if (currentProfile?.role !== 'admin') return;
    const payload = {
      display_name: $('newUserName').value.trim(),
      email: $('newUserEmail').value.trim().toLowerCase(),
      password: $('newUserPassword').value,
      role: $('newUserRole').value
    };
    setMessage('userMessage', '', '');
    try {
      await createUser(payload);
      setMessage('userMessage', `Created ${payload.email}.`, 'success');
      $('createUserForm').reset();
      await refreshUsers();
    } catch (err) {
      setMessage('userMessage', err.message || String(err), 'error');
    }
  }

  async function exportSelectedCadetCSV() {
    const selectedKey = $('historyCadetSelect').value;
    if (!selectedKey) return toast('Select a cadet first');
    const [cadets, inspections] = await Promise.all([listCadets(), listInspections()]);
    const cadet = cadets.find(c => cadetKey(c) === selectedKey);
    const range = getReportDateRange('history');
    const rows = inspections.filter(i => inspectionBelongsToCadet(i, cadet, selectedKey) && unitMatches(i, $('historyUnitFilter').value) && dateMatches(i.inspection_date, range));
    downloadCSV(rowsToCSV(rows, cadets), `CAP_uniform_${safeFilename(cadetDisplayName(cadet || {}) || 'cadet')}.csv`);
  }

  async function exportAllCSV() {
    const [cadets, inspections] = await Promise.all([listCadets(), listInspections()]);
    const range = getReportDateRange('dashboard');
    const rows = inspections.filter(i => unitMatches(i, $('dashboardUnitFilter').value) && dateMatches(i.inspection_date, range));
    downloadCSV(rowsToCSV(rows, cadets), `CAP_uniform_inspections_${localDateISO()}.csv`);
  }

  function rowsToCSV(rows, cadets) {
    const headers = ['Inspection Date','Unit','CAPID','Last Name','First Name','Cadet Grade','Personal Appearance','Garments','Accoutrements','Footwear','Military Bearing','Total Score','Overall Rating','Passed','Inspector','Notes'];
    const data = rows.map(i => {
      const c = inspectionCadet(i, cadets);
      const legacy = splitLegacyName(c.name);
      const inspector = inspectorDirectory.find(p => String(p.id) === String(i.evaluator_id));
      return [i.inspection_date,unitLabelForInspection(i),c.capid,c.last_name || legacy.last_name,c.first_name || legacy.first_name,i.grade_at_inspection,i.personal_appearance,i.garments,i.accoutrements,i.footwear,i.military_bearing,i.total_score,i.overall_rating,i.passed ? 'Yes' : 'No',inspector?.display_name || i.evaluator_id || '',i.notes || ''];
    });
    return [headers, ...data].map(row => row.map(csvCell).join(',')).join('\n');
  }

  function downloadCSV(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function listCadets() {
    if (isDemo) return loadLS(LS.cadets, []).map(normalizeCadet);
    if (navigator.onLine && sb) {
      try {
        const { data, error } = await sb.from('cadets').select('*').order('last_name', { ascending: true, nullsFirst: false }).order('first_name', { ascending: true, nullsFirst: false });
        if (error) throw error;
        if (offlineStore) { await offlineStore.cacheCadets(data || []); return (await offlineStore.getCadets()).map(normalizeCadet); }
        return (data || []).map(normalizeCadet);
      } catch (err) { console.warn('Cadet roster server read failed; using tablet cache.', err); }
    }
    return offlineStore ? (await offlineStore.getCadets()).map(normalizeCadet) : [];
  }

  async function upsertCadet(cadet) {
    cadet = normalizeCadet(cadet);
    if (isDemo) {
      const rows = loadLS(LS.cadets, []);
      let existing = rows.find(r => r.capid === cadet.capid);
      if (existing) Object.assign(existing, cadet, { updated_at: new Date().toISOString() });
      else { existing = { id: nextNumericId(rows), ...cadet, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; rows.push(existing); }
      saveLS(LS.cadets, rows); return existing;
    }
    if (offlineStore) return offlineStore.upsertLocalCadet(cadet);
    const { data, error } = await sb.from('cadets').upsert(cadet, { onConflict: 'capid' }).select().single();
    if (error) throw error; return data;
  }

  async function insertInspection(row) {
    if (isDemo) {
      const rows = loadLS(LS.inspections, []);
      rows.push({ id: nextNumericId(rows), ...row, created_at: new Date().toISOString() });
      saveLS(LS.inspections, rows);
      return;
    }
    throw new Error('Direct inspection inserts are disabled in offline-first mode.');
  }

  async function listInspections() {
    if (isDemo) {
      const cadets = loadLS(LS.cadets, []).map(normalizeCadet);
      const units = loadLS(LS.units, []);
      return loadLS(LS.inspections, []).map(i => ({ ...i, cadets: cadets.find(c => String(c.id) === String(i.cadet_id)) || null, units: units.find(u => String(u.id) === String(i.unit_id)) || null }));
    }
    if (navigator.onLine && sb) {
      try {
        const { data, error } = await sb.from('inspections').select('*, cadets(capid,first_name,last_name,name,grade,current_unit_id), units(id,charter_number,name,active)').order('inspection_date', { ascending: true });
        if (error) throw error;
        if (offlineStore) { await offlineStore.cacheServerInspections(data || []); return await offlineStore.getInspections(); }
        return data || [];
      } catch (err) { console.warn('Inspection history server read failed; using tablet cache.', err); }
    }
    return offlineStore ? await offlineStore.getInspections() : [];
  }

  async function listProfiles() {
    if (isDemo) return loadLS(LS.users, []).map(stripPassword).sort((a,b) => (a.display_name || '').localeCompare(b.display_name || ''));
    const { data, error } = await sb.from('profiles').select('*').order('display_name');
    if (error) throw error;
    return data || [];
  }

  async function createUser(payload) {
    if (isDemo) {
      const users = loadLS(LS.users, []);
      if (users.some(u => u.email.toLowerCase() === payload.email.toLowerCase())) throw new Error('That email already exists.');
      users.push({ id: makeUUID(), email: payload.email, display_name: payload.display_name, role: payload.role, password_hash: await hashPassword(payload.password), created_at: new Date().toISOString() });
      saveLS(LS.users, users);
      return;
    }
    if (!navigator.onLine) throw new Error('Creating users requires an internet connection.');
    const { data, error } = await sb.functions.invoke('create-user', { body: payload });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  }

  async function saveInspectionLocalFirst(cadet, row) {
    if (isDemo) {
      const savedCadet = await upsertCadet(cadet);
      await insertInspection({ ...row, cadet_id: savedCadet.id });
      return { local_id: null, sync_status: 'synced' };
    }
    if (!offlineStore) throw new Error('Offline storage is not available in this browser.');
    const clientUUID = makeUUID();
    return offlineStore.queueInspection(cadet, {
      ...row,
      client_uuid: clientUUID,
      local_id: clientUUID,
      created_at: new Date().toISOString()
    });
  }

  async function getPendingCount() {
    if (isDemo || !offlineStore) return 0;
    return offlineStore.pendingCount().catch(() => 0);
  }

  async function syncPendingInspections({ showToast = false, refreshAfter = true } = {}) {
    if (isDemo || !offlineStore || !sb) return { synced: 0, failed: 0, pending: 0 };
    if (syncInProgress) return { synced: 0, failed: 0, pending: await getPendingCount() };
    if (!navigator.onLine) { await updateSyncStatus(); if (showToast) toast('Offline — records remain safely stored on this tablet'); return { synced: 0, failed: 0, pending: await getPendingCount() }; }
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData?.session?.user) { await updateSyncStatus('signin'); if (showToast) toast('Sign in online before synchronizing'); return { synced: 0, failed: 0, pending: await getPendingCount() }; }

    syncInProgress = true; await updateSyncStatus('syncing');
    let synced = 0, failed = 0;
    try {
      const pendingRows = await offlineStore.getPendingInspections();
      for (const localRow of pendingRows) {
        try {
          const legacy = splitLegacyName(localRow.cadet_name);
          const first_name = localRow.cadet_first_name || localRow.cadets?.first_name || legacy.first_name;
          const last_name = localRow.cadet_last_name || localRow.cadets?.last_name || legacy.last_name;
          const currentUnit = localRow.unit_id ?? localRow.cadets?.current_unit_id ?? null;
          const cadetPayload = { capid: localRow.capid, first_name, last_name, name: `${first_name} ${last_name}`.trim() || localRow.cadet_name || localRow.capid, grade: localRow.cadet_grade, current_unit_id: currentUnit };
          const { data: cadet, error: cadetError } = await sb.from('cadets').upsert(cadetPayload, { onConflict: 'capid' }).select().single();
          if (cadetError) throw cadetError;
          const payload = {
            client_uuid: localRow.client_uuid, cadet_id: cadet.id, unit_id: localRow.unit_id ?? null,
            inspection_date: localRow.inspection_date, grade_at_inspection: localRow.grade_at_inspection, grade_group: localRow.grade_group,
            personal_appearance: Number(localRow.personal_appearance), garments: Number(localRow.garments), accoutrements: Number(localRow.accoutrements), footwear: Number(localRow.footwear), military_bearing: Number(localRow.military_bearing),
            notes: localRow.notes || null, evaluator_id: localRow.evaluator_id
          };
          const { data: serverRow, error: inspectionError } = await sb.from('inspections')
            .upsert(payload, { onConflict: 'client_uuid' })
            .select('*, cadets(capid,first_name,last_name,name,grade,current_unit_id), units(id,charter_number,name,active)').single();
          if (inspectionError) throw inspectionError;
          await offlineStore.markInspectionSynced(localRow.local_id, serverRow, cadet); synced++;
        } catch (err) {
          failed++; await offlineStore.markInspectionError(localRow.local_id, err.message || String(err)).catch(() => {}); console.warn('Inspection sync failed:', err);
          if (/jwt|auth|session|401|403/i.test(String(err.message || err))) break;
        }
      }
      if (!failed) await offlineStore.noteSyncSuccess(); else await offlineStore.noteSyncError(`${failed} inspection${failed === 1 ? '' : 's'} could not synchronize.`);
      if (refreshAfter && navigator.onLine) await refreshOfflineCacheFromServer({ quiet: true });
      const pending = await getPendingCount(); if (showToast) toast(pending ? `${synced} synced · ${pending} still pending` : 'All inspections synchronized');
      return { synced, failed, pending };
    } finally { syncInProgress = false; await updateSyncStatus(); }
  }

  async function refreshOfflineCacheFromServer({ quiet = false } = {}) {
    if (isDemo || !offlineStore || !sb) return;
    if (!navigator.onLine) { if (!quiet) toast('Offline — cannot refresh server data'); return; }
    try {
      const [cadetsResult, inspectionsResult, rulesResult, unitsResult, inspectorsResult] = await Promise.all([
        sb.from('cadets').select('*').order('last_name', { ascending: true, nullsFirst: false }),
        sb.from('inspections').select('*, cadets(capid,first_name,last_name,name,grade,current_unit_id), units(id,charter_number,name,active)').order('inspection_date', { ascending: true }),
        sb.from('grading_rules').select('grade_group,passing_min,excellent_min'),
        sb.from('units').select('*').order('charter_number'),
        sb.rpc('list_inspectors')
      ]);
      for (const result of [cadetsResult, inspectionsResult, rulesResult, unitsResult, inspectorsResult]) if (result.error) throw result.error;
      await offlineStore.cacheCadets(cadetsResult.data || []);
      await offlineStore.cacheServerInspections(inspectionsResult.data || []);
      await offlineStore.cacheUnits(unitsResult.data || []);
      await offlineStore.cacheInspectorDirectory(inspectorsResult.data || []);
      unitsCache = unitsResult.data || [];
      inspectorDirectory = inspectorsResult.data || [];
      const rules = cloneDefaultRules();
      (rulesResult.data || []).forEach(r => { rules[r.grade_group] = { passing_min: Number(r.passing_min), excellent_min: Number(r.excellent_min) }; });
      gradingRules = rules; await offlineStore.cacheGradingRules(rules); await offlineStore.markServerRefresh();
      populateUnitSelectors(); updateGradingRuleForm(); updateLiveScore(); refreshAllBulkRows();
      if (currentProfile) await refreshCadetSelectors();
      if (currentProfile?.role === 'admin') await refreshUnitsAdmin();
      if (!quiet) toast('Offline tablet data refreshed');
    } catch (err) { console.warn('Offline cache refresh failed:', err); if (!quiet) toast(`Refresh failed: ${err.message || err}`); }
    finally { await updateSyncStatus(); }
  }

  async function updateSyncStatus(forcedState = '') {
    const chip = $('syncStatus');
    const button = $('syncNowBtn');
    if (!chip) return;
    if (isDemo) {
      chip.textContent = 'Demo storage';
      chip.className = 'sync-chip demo';
      if (button) button.classList.add('hidden');
      return;
    }
    const pending = await getPendingCount();
    const online = navigator.onLine;
    if (button) {
      button.classList.remove('hidden');
      button.disabled = syncInProgress || !online || !currentProfile;
      button.textContent = syncInProgress ? 'Syncing…' : 'Sync Now';
    }
    if (forcedState === 'syncing' || syncInProgress) {
      chip.textContent = `Syncing${pending ? ` · ${pending} queued` : ''}`;
      chip.className = 'sync-chip syncing';
    } else if (forcedState === 'signin') {
      chip.textContent = `${pending} pending · sign in to sync`;
      chip.className = 'sync-chip warning';
    } else if (!online) {
      chip.textContent = pending ? `Offline · ${pending} pending` : 'Offline · ready';
      chip.className = 'sync-chip offline';
    } else if (pending) {
      chip.textContent = `Online · ${pending} pending`;
      chip.className = 'sync-chip warning';
    } else {
      chip.textContent = 'Online · synced';
      chip.className = 'sync-chip online';
    }

    const info = offlineStore ? await offlineStore.getSyncInfo().catch(() => null) : null;
    if ($('offlineStatusDetail') && info) {
      $('offlineStatusDetail').textContent = `${pending} pending inspection${pending === 1 ? '' : 's'} · Last sync: ${info.last_sync ? formatDateTime(info.last_sync) : 'not yet'} · Cached data refresh: ${info.last_server_refresh ? formatDateTime(info.last_server_refresh) : 'not yet'}`;
    }
  }

  async function handleConnectionRestored() {
    if (!isDemo && !sb) {
      location.reload();
      return;
    }
    await updateSyncStatus();
    if (currentProfile) {
      const result = await syncPendingInspections({ showToast: true, refreshAfter: true });
      if (!result.pending) offlineSession = false;
    }
    await updateOfflineLoginOption();
  }

  async function updateOfflineLoginOption() {
    const btn = $('offlineContinueBtn');
    const hint = $('offlineLoginHint');
    if (!btn || isDemo || !offlineStore) return;
    const profile = await offlineStore.getCachedProfile().catch(() => null);
    if (profile) {
      btn.classList.toggle('hidden', navigator.onLine);
      btn.textContent = `Continue Offline as ${profile.display_name || profile.email}`;
      if (hint) {
        hint.classList.toggle('hidden', navigator.onLine);
        hint.textContent = 'This tablet was previously authorized. Offline inspections will stay on this device until a connection returns.';
      }
    } else {
      btn.classList.add('hidden');
      hint?.classList.add('hidden');
    }
  }

  function setupPWA() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(err => console.warn('Service worker registration failed:', err)));
    }
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      $('installPwaBtn')?.classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      $('installPwaBtn')?.classList.add('hidden');
      toast('CAP Inspection app installed');
    });
  }

  async function installPWA() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    $('installPwaBtn')?.classList.add('hidden');
  }

  async function requestPersistentStorage() {
    if (!navigator.storage?.persist) return;
    try { await navigator.storage.persist(); } catch {}
  }

  async function ensureDemoAdmin() {
    const users = loadLS(LS.users, []);
    if (users.length) return;
    users.push({
      id: makeUUID(), email: 'admin@cap.local', display_name: 'CAP Administrator', role: 'admin',
      password_hash: await hashPassword('CAPinspect2026!'), created_at: new Date().toISOString()
    });
    saveLS(LS.users, users);
  }

  async function ensureDemoUnit() {
    const units = loadLS(LS.units, []);
    if (units.length) return;
    units.push({ id: 1, charter_number: 'DEMO-001', name: 'Demo Composite Squadron', active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    saveLS(LS.units, units);
  }

  function makeUUID() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    // Demo/local-file fallback. Supabase mode uses server-generated auth IDs.
    return 'demo-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  async function hashPassword(password) {
    if (globalThis.crypto?.subtle) {
      const bytes = new TextEncoder().encode(password);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Only used as a compatibility fallback in browser-only demo mode.
    let hash = 2166136261;
    for (let i = 0; i < password.length; i++) {
      hash ^= password.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `demo-${(hash >>> 0).toString(16)}`;
  }

  function loadLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) ?? fallback;
    } catch {}
    return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : fallback;
  }
  function saveLS(key, value) {
    memoryStore[key] = value;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
  function saveSession(id) {
    memoryStore[LS.session] = id;
    try { localStorage.setItem(LS.session, id); } catch {}
  }
  function loadSession() {
    try { return localStorage.getItem(LS.session) || memoryStore[LS.session] || null; }
    catch { return memoryStore[LS.session] || null; }
  }
  function removeSession() {
    delete memoryStore[LS.session];
    try { localStorage.removeItem(LS.session); } catch {}
  }
  function nextNumericId(rows) { return rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1; }
  function stripPassword(user) { const { password_hash, ...safe } = user; return safe; }

  function statCard(label, value, detail) {
    return `<div class="stat-card"><div class="stat-label">${escapeHtml(String(label))}</div><div class="stat-value">${escapeHtml(String(value))}</div><div class="stat-detail">${escapeHtml(String(detail || ''))}</div></div>`;
  }
  function average(values) { return values.length ? values.reduce((a,b) => a + Number(b), 0) / values.length : 0; }
  function formatDate(iso) { if (!iso) return ''; return new Date(`${iso}T12:00:00`).toLocaleDateString(); }
  function shortDate(iso) { return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  function formatMonth(yyyyMM) { return new Date(`${yyyyMM}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }); }
  function formatDateTime(iso) { if (!iso) return ''; return new Date(iso).toLocaleString(); }
  function destroyChart(chart) { if (chart) chart.destroy(); }
  function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s; }
  function safeFilename(s) { return String(s).replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, ''); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function setMessage(id, text, type) { const el = $(id); el.textContent = text; el.className = `form-message ${type || ''}`.trim(); }
  function toast(text) { const el = $('toast'); el.textContent = text; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2200); }
})();
