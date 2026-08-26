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
  let bulkRowSerial = 0;

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
    gradingRules: 'cap_uniform_demo_grading_rules_v1'
  };

  const memoryStore = {};

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    populateGrades();
    renderCriteria();
    bindUI();
    $('inspectionDate').value = localDateISO();
    $('bulkInspectionDate').value = localDateISO();
    $('modeBadge').textContent = isDemo ? 'Demo / browser-only storage' : 'Supabase shared database';

    if (isDemo) {
      $('demoHint').classList.remove('hidden');
      await ensureDemoAdmin();
    } else {
      if (!CONFIG.supabaseUrl || !CONFIG.supabasePublishableKey) {
        $('loginMessage').textContent = 'Supabase mode is enabled, but config.js is missing the project URL or publishable key.';
        $('loginMessage').className = 'form-message error';
        return;
      }
      sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabasePublishableKey);
    }

    gradingRules = isDemo ? loadDemoGradingRules() : cloneDefaultRules();
    seedBulkRows(8);
    updateGradingRuleForm();
    updateLiveScore();

    // Always require an explicit login when the page is opened. This is safer for
    // shared squadron computers and keeps the initial workflow predictable.
    showLogin();
  }

  function bindUI() {
    $('loginForm').addEventListener('submit', handleLogin);
    $('logoutBtn').addEventListener('click', handleLogout);
    document.querySelectorAll('.main-tab').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
    document.querySelectorAll('.subtab').forEach(btn => btn.addEventListener('click', () => switchReport(btn.dataset.report)));
    $('cadetGrade').addEventListener('change', updateLiveScore);
    $('capid').addEventListener('blur', autofillCadet);
    $('inspectionForm').addEventListener('submit', saveInspectionFromForm);
    $('historyCadetSelect').addEventListener('change', renderSelectedCadetHistory);
    $('printCadetBtn').addEventListener('click', () => window.print());
    $('exportCadetBtn').addEventListener('click', exportSelectedCadetCSV);
    $('exportAllBtn').addEventListener('click', exportAllCSV);
    $('createUserForm').addEventListener('submit', handleCreateUser);
    $('bulkAddRowBtn').addEventListener('click', () => addBulkRow());
    $('bulkAdd10Btn').addEventListener('click', () => seedBulkRows(10));
    $('bulkClearBtn').addEventListener('click', clearBulkTable);
    $('bulkSubmitBtn').addEventListener('click', saveBulkInspections);
    $('gradingRulesForm').addEventListener('submit', handleSaveGradingRules);
    $('resetRulesBtn').addEventListener('click', restoreDefaultGradingRules);
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
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        profile = await loadSupabaseProfile(data.user.id);
      }
      await enterApp(profile);
    } catch (err) {
      setMessage('loginMessage', err.message || String(err), 'error');
    }
  }

  async function handleLogout() {
    if (isDemo) removeSession();
    else await sb.auth.signOut();
    currentProfile = null;
    showLogin();
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

  async function enterApp(profile) {
    currentProfile = profile;
    try { gradingRules = await loadGradingRules(); } catch (err) { console.warn('Could not load grading rules; using defaults.', err); gradingRules = cloneDefaultRules(); }
    updateGradingRuleForm();
    updateLiveScore();
    refreshAllBulkRows();
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('app-locked');
    $('appView').setAttribute('aria-hidden', 'false');
    $('appView').inert = false;
    $('signedInAs').textContent = `${profile.display_name || profile.email} · ${profile.role}`;
    $('usersTab').classList.toggle('admin-disabled', profile.role !== 'admin');
    $('usersTab').setAttribute('aria-disabled', profile.role !== 'admin' ? 'true' : 'false');
    $('usersTab').title = profile.role === 'admin' ? 'Administration' : 'Administrator access required';
    switchView('inspectionView');
    await refreshCadetSelectors();
    if (profile.role === 'admin') await refreshUsers();
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
    if (viewId === 'usersView') { refreshUsers(); updateGradingRuleForm(); }
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
      <td><input class="bulk-name" value="${escapeHtml(data.name || '')}" placeholder="Cadet name"></td>
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
    const name = tr.querySelector('.bulk-name').value.trim();
    const grade = tr.querySelector('.bulk-grade').value;
    const blank = !capid && !name && !grade && [...tr.querySelectorAll('.bulk-rating')].every(s => s.value === '');
    const complete = Boolean(capid && name && grade && scoresComplete);
    const total = Object.values(scores).reduce((a,b) => a + Number(b), 0);
    const group = gradeGroup(grade);
    const result = calculateRating(group, total);
    return { capid, name, grade, scores, blank, complete, total, group, result };
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
        tr.querySelector('.bulk-name').value = cadet.name;
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
    button.textContent = `Saving ${ready.length}...`;
    let saved = 0;
    try {
      for (const { row } of ready) {
        const cadet = await upsertCadet({ capid: row.capid, name: row.name, grade: row.grade });
        await insertInspection({
          cadet_id: cadet.id,
          inspection_date: date,
          grade_at_inspection: row.grade,
          grade_group: row.group,
          ...row.scores,
          notes: null,
          evaluator_id: currentProfile.id,
          total_score: row.total,
          overall_rating: row.result.rating,
          passed: row.result.passed
        });
        saved++;
      }
      setMessage('bulkMessage', `Saved ${saved} inspection${saved === 1 ? '' : 's'}.`, 'success');
      toast(`${saved} inspections saved`);
      $('bulkTableBody').innerHTML = '';
      bulkRowSerial = 0;
      seedBulkRows(8);
      await refreshCadetSelectors();
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
    const { data, error } = await sb.from('grading_rules').select('grade_group,passing_min,excellent_min');
    if (error) throw error;
    const rules = cloneDefaultRules();
    (data || []).forEach(r => { rules[r.grade_group] = { passing_min: Number(r.passing_min), excellent_min: Number(r.excellent_min) }; });
    return rules;
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
    try {
      if (isDemo) {
        saveLS(LS.gradingRules, candidate);
      } else {
        const rows = Object.entries(candidate).map(([grade_group, r]) => ({ grade_group, passing_min: r.passing_min, excellent_min: r.excellent_min, updated_by: currentProfile.id, updated_at: new Date().toISOString() }));
        const { error } = await sb.from('grading_rules').upsert(rows, { onConflict: 'grade_group' });
        if (error) throw error;
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
      $('cadetName').value = cadet.name;
      $('cadetGrade').value = cadet.grade;
      updateLiveScore();
      toast(`Loaded ${cadet.name}`);
    }
  }

  async function saveInspectionFromForm(e) {
    e.preventDefault();
    setMessage('inspectionMessage', '', '');
    const button = $('saveInspectionBtn');
    const { scores, complete } = getScoresFromForm();
    if (!complete) {
      setMessage('inspectionMessage', 'Score all five inspection categories before saving.', 'error');
      return;
    }

    const capid = $('capid').value.trim();
    const name = $('cadetName').value.trim();
    const grade = $('cadetGrade').value;
    const date = $('inspectionDate').value;
    if (!capid || !name || !grade || !date) return;

    const group = gradeGroup(grade);
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    const result = calculateRating(group, total);
    button.disabled = true;
    button.textContent = 'Saving...';

    try {
      const cadet = await upsertCadet({ capid, name, grade });
      await insertInspection({
        cadet_id: cadet.id,
        inspection_date: date,
        grade_at_inspection: grade,
        grade_group: group,
        ...scores,
        notes: $('notes').value.trim() || null,
        evaluator_id: currentProfile.id,
        total_score: total,
        overall_rating: result.rating,
        passed: result.passed
      });
      setMessage('inspectionMessage', `Saved: ${name} — ${total}/10, ${result.rating}, ${result.passed ? 'Passing' : 'Not Passing'}.`, 'success');
      toast('Inspection saved');
      clearInspectionForm();
      await refreshCadetSelectors();
    } catch (err) {
      setMessage('inspectionMessage', err.message || String(err), 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Submit Inspection';
    }
  }

  function clearInspectionForm() {
    $('capid').value = '';
    $('cadetName').value = '';
    $('cadetGrade').value = '';
    $('notes').value = '';
    document.querySelectorAll('.inspection-rating').forEach(i => i.value = '');
    $('inspectionDate').value = localDateISO();
    updateLiveScore();
  }

  async function refreshCadetSelectors() {
    const cadets = await listCadets();
    const sel = $('historyCadetSelect');
    const prior = sel.value;
    sel.innerHTML = '<option value="">Select cadet...</option>' + cadets
      .sort((a,b) => a.name.localeCompare(b.name))
      .map(c => `<option value="${c.id}">${escapeHtml(c.name)} — ${escapeHtml(c.grade)} — ${escapeHtml(c.capid)}</option>`).join('');
    if ([...sel.options].some(o => o.value === prior)) sel.value = prior;
  }

  async function renderSelectedCadetHistory() {
    const cadetId = $('historyCadetSelect').value;
    if (!cadetId) {
      $('historyEmpty').classList.remove('hidden');
      $('historyContent').classList.add('hidden');
      return;
    }
    const [cadets, inspections] = await Promise.all([listCadets(), listInspections()]);
    const cadet = cadets.find(c => String(c.id) === String(cadetId));
    const rows = inspections.filter(i => String(i.cadet_id) === String(cadetId)).sort((a,b) => a.inspection_date.localeCompare(b.inspection_date));

    $('historyEmpty').classList.add('hidden');
    $('historyContent').classList.remove('hidden');
    const avg = rows.length ? average(rows.map(r => r.total_score)) : 0;
    const passRate = rows.length ? Math.round(rows.filter(r => r.passed).length / rows.length * 100) : 0;
    const latest = rows.length ? rows[rows.length - 1] : null;
    $('cadetStats').innerHTML = [
      statCard('Cadet', cadet?.name || '', `${cadet?.grade || ''} · CAPID ${cadet?.capid || ''}`),
      statCard('Inspections', rows.length, 'Recorded inspections'),
      statCard('Average Score', avg.toFixed(1), 'Out of 10'),
      statCard('Pass Rate', `${passRate}%`, latest ? `Latest: ${latest.total_score}/10 ${latest.overall_rating}` : 'No inspections')
    ].join('');

    $('historyTableBody').innerHTML = rows.slice().reverse().map(r => `
      <tr>
        <td>${formatDate(r.inspection_date)}</td><td>${escapeHtml(r.grade_at_inspection)}</td>
        <td>${r.personal_appearance}</td><td>${r.garments}</td><td>${r.accoutrements}</td><td>${r.footwear}</td><td>${r.military_bearing}</td>
        <td><strong>${r.total_score}/10</strong></td><td>${escapeHtml(r.overall_rating)}</td><td>${r.passed ? 'Pass' : 'Not Pass'}</td>
      </tr>`).join('') || '<tr><td colspan="10">No inspections recorded.</td></tr>';

    if (globalThis.Chart) {
      if (chartCadet) chartCadet.destroy();
      chartCadet = new Chart($('cadetTrendChart'), {
        type: 'line',
        data: { labels: rows.map(r => shortDate(r.inspection_date)), datasets: [{ label: 'Overall score', data: rows.map(r => r.total_score), tension: .25 }] },
        options: { responsive: true, maintainAspectRatio: true, scales: { y: { min: 0, max: 10, ticks: { stepSize: 1 } } } }
      });
    }
  }

  async function renderDashboard() {
    const inspections = await listInspections();
    const cadets = await listCadets();
    const total = inspections.length;
    const avgScore = total ? average(inspections.map(i => i.total_score)) : 0;
    const passRate = total ? Math.round(inspections.filter(i => i.passed).length / total * 100) : 0;
    $('dashboardStats').innerHTML = [
      statCard('Total Inspections', total, 'All recorded inspections'),
      statCard('Cadets Inspected', new Set(inspections.map(i => i.cadet_id)).size, `${cadets.length} cadets in roster`),
      statCard('Average Score', avgScore.toFixed(1), 'Out of 10'),
      statCard('Pass Rate', `${passRate}%`, `${inspections.filter(i => i.passed).length} passing inspections`)
    ].join('');

    const categoryAverages = CRITERIA.map(c => total ? average(inspections.map(i => Number(i[c.key]))) : 0);
    const weakestIndex = categoryAverages.indexOf(Math.min(...categoryAverages));
    const ratings = {
      'Needs Improvement': inspections.filter(i => i.overall_rating === 'Needs Improvement').length,
      'Satisfactory': inspections.filter(i => i.overall_rating === 'Satisfactory').length,
      'Excellent': inspections.filter(i => i.overall_rating === 'Excellent').length
    };

    const months = {};
    inspections.forEach(i => {
      const month = i.inspection_date.slice(0, 7);
      (months[month] ||= []).push(i.total_score);
    });
    const monthKeys = Object.keys(months).sort();

    if (globalThis.Chart) {
      destroyChart(chartMonthly); destroyChart(chartCategory); destroyChart(chartRating);
      chartMonthly = new Chart($('monthlyTrendChart'), {
        type: 'line', data: { labels: monthKeys.map(formatMonth), datasets: [{ label: 'Average total', data: monthKeys.map(m => average(months[m])), tension: .25 }] },
        options: { responsive: true, scales: { y: { min: 0, max: 10 } } }
      });
      chartCategory = new Chart($('categoryChart'), {
        type: 'bar', data: { labels: CRITERIA.map(c => c.title), datasets: [{ label: 'Average (0–2)', data: categoryAverages }] },
        options: { responsive: true, scales: { y: { min: 0, max: 2 } } }
      });
      chartRating = new Chart($('ratingChart'), {
        type: 'doughnut', data: { labels: Object.keys(ratings), datasets: [{ data: Object.values(ratings) }] },
        options: { responsive: true }
      });
    }

    const last30 = new Date(); last30.setDate(last30.getDate() - 30);
    const recent30 = inspections.filter(i => new Date(`${i.inspection_date}T12:00:00`) >= last30);
    const prior = inspections.slice().sort((a,b) => a.inspection_date.localeCompare(b.inspection_date));
    const firstHalf = prior.slice(0, Math.floor(prior.length / 2));
    const secondHalf = prior.slice(Math.floor(prior.length / 2));
    const trendDelta = firstHalf.length && secondHalf.length ? average(secondHalf.map(i => i.total_score)) - average(firstHalf.map(i => i.total_score)) : 0;

    const insights = [];
    if (!total) insights.push('No inspections have been recorded yet. Add inspections to build unit trends.');
    else {
      insights.push(`<strong>Most common improvement area:</strong> ${CRITERIA[weakestIndex].title} has the lowest average score at ${categoryAverages[weakestIndex].toFixed(2)}/2.`);
      insights.push(`<strong>Current pass rate:</strong> ${passRate}% across ${total} inspections.`);
      insights.push(`<strong>Recent activity:</strong> ${recent30.length} inspection${recent30.length === 1 ? '' : 's'} recorded in the last 30 days.`);
      if (firstHalf.length && secondHalf.length) insights.push(`<strong>Long-term score trend:</strong> the newer half of inspections averages ${Math.abs(trendDelta).toFixed(1)} points ${trendDelta >= 0 ? 'higher' : 'lower'} than the older half.`);
    }
    $('programInsights').innerHTML = insights.map(i => `<div class="insight">${i}</div>`).join('');

    $('recentTableBody').innerHTML = inspections.slice().sort((a,b) => b.inspection_date.localeCompare(a.inspection_date)).slice(0, 15).map(i => {
      const c = i.cadets || cadets.find(x => String(x.id) === String(i.cadet_id)) || {};
      return `<tr><td>${formatDate(i.inspection_date)}</td><td>${escapeHtml(c.capid || '')}</td><td>${escapeHtml(c.name || '')}</td><td>${escapeHtml(i.grade_at_inspection)}</td><td><strong>${i.total_score}/10</strong></td><td>${escapeHtml(i.overall_rating)}</td><td>${i.passed ? 'Pass' : 'Not Pass'}</td></tr>`;
    }).join('') || '<tr><td colspan="7">No inspections recorded.</td></tr>';
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
    const cadetId = $('historyCadetSelect').value;
    if (!cadetId) return toast('Select a cadet first');
    const [cadets, inspections] = await Promise.all([listCadets(), listInspections()]);
    const cadet = cadets.find(c => String(c.id) === String(cadetId));
    const rows = inspections.filter(i => String(i.cadet_id) === String(cadetId));
    downloadCSV(rowsToCSV(rows, cadets), `CAP_uniform_${safeFilename(cadet?.name || 'cadet')}.csv`);
  }

  async function exportAllCSV() {
    const [cadets, inspections] = await Promise.all([listCadets(), listInspections()]);
    downloadCSV(rowsToCSV(inspections, cadets), `CAP_uniform_inspections_${localDateISO()}.csv`);
  }

  function rowsToCSV(rows, cadets) {
    const headers = ['Inspection Date','CAPID','Name','Grade','Personal Appearance','Garments','Accoutrements','Footwear','Military Bearing','Total Score','Overall Rating','Passed','Notes'];
    const data = rows.map(i => {
      const c = i.cadets || cadets.find(x => String(x.id) === String(i.cadet_id)) || {};
      return [i.inspection_date,c.capid,c.name,i.grade_at_inspection,i.personal_appearance,i.garments,i.accoutrements,i.footwear,i.military_bearing,i.total_score,i.overall_rating,i.passed ? 'Yes' : 'No',i.notes || ''];
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
    if (isDemo) return loadLS(LS.cadets, []);
    const { data, error } = await sb.from('cadets').select('*').order('name');
    if (error) throw error;
    return data || [];
  }

  async function upsertCadet(cadet) {
    if (isDemo) {
      const rows = loadLS(LS.cadets, []);
      let existing = rows.find(r => r.capid === cadet.capid);
      if (existing) {
        existing.name = cadet.name; existing.grade = cadet.grade; existing.updated_at = new Date().toISOString();
      } else {
        existing = { id: nextNumericId(rows), ...cadet, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        rows.push(existing);
      }
      saveLS(LS.cadets, rows);
      return existing;
    }
    const { data, error } = await sb.from('cadets').upsert(cadet, { onConflict: 'capid' }).select().single();
    if (error) throw error;
    return data;
  }

  async function insertInspection(row) {
    if (isDemo) {
      const rows = loadLS(LS.inspections, []);
      rows.push({ id: nextNumericId(rows), ...row, created_at: new Date().toISOString() });
      saveLS(LS.inspections, rows);
      return;
    }
    const clean = { ...row };
    delete clean.total_score; delete clean.overall_rating; delete clean.passed;
    const { error } = await sb.from('inspections').insert(clean);
    if (error) throw error;
  }

  async function listInspections() {
    if (isDemo) {
      const cadets = loadLS(LS.cadets, []);
      return loadLS(LS.inspections, []).map(i => ({ ...i, cadets: cadets.find(c => String(c.id) === String(i.cadet_id)) || null }));
    }
    const { data, error } = await sb.from('inspections').select('*, cadets(capid,name,grade)').order('inspection_date', { ascending: true });
    if (error) throw error;
    return data || [];
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
    const { data, error } = await sb.functions.invoke('create-user', { body: payload });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
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
