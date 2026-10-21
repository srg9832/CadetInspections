(() => {
  'use strict';

  const style = document.createElement('style');
  style.textContent = `
    .working-unit-control {
      min-width: min(420px, 38vw);
      display: grid;
      grid-template-columns: minmax(190px, 1fr) auto;
      gap: 8px 10px;
      align-items: end;
      padding: 8px 10px;
      border: 1px solid rgba(255,255,255,.22);
      border-radius: 7px;
      background: rgba(255,255,255,.08);
    }
    .working-unit-control label { display: grid; gap: 3px; min-width: 0; }
    .working-unit-control label > span { color: #d9e4ed; font-size: .66rem; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; }
    .working-unit-control label small { font-weight: 600; text-transform: none; letter-spacing: 0; opacity: .78; }
    .working-unit-control select { min-width: 0; min-height: 34px; padding: 5px 30px 5px 8px; border-radius: 5px; }
    .working-unit-actions { display: grid; gap: 4px; justify-items: end; }
    .working-unit-actions span { max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #d9e4ed; font-size: .68rem; }
    .header-button.compact { padding: 5px 9px; min-height: 30px; font-size: .72rem; }
    .field-link-button { justify-self: start; border: 0; padding: 3px 0 0; background: transparent; color: var(--navy-800); font-size: .72rem; font-weight: 800; text-decoration: underline; cursor: pointer; }
    .field-link-button:disabled { color: var(--muted); text-decoration: none; cursor: default; opacity: .7; }
    .admin-access-toolbar { display: grid; grid-template-columns: minmax(280px, .9fr) minmax(240px, 1.1fr); gap: 12px; margin-bottom: 12px; }
    .permission-key { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 4px 0 12px; color: var(--muted); font-size: .76rem; line-height: 1.4; }
    .permission-key strong { color: var(--navy-900); }
    .permission-table select { min-width: 150px; min-height: 34px; }
    .permission-table td:nth-child(3) select { min-width: 220px; }
    .permission-toggle { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; }
    .permission-toggle input { width: auto; min-height: auto; }
    .permission-badge { display: inline-block; padding: 4px 7px; border-radius: 999px; background: #e9eef3; font-size: .7rem; font-weight: 900; }
    .permission-badge.app-admin { color: #4d2d78; background: #f1eafd; }
    .create-user-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
    @media (max-width: 1080px) {
      .app-header { flex-wrap: wrap; }
      .working-unit-control { order: 3; width: 100%; min-width: 0; grid-template-columns: 1fr auto; }
    }
    @media (max-width: 760px) {
      .working-unit-control { grid-template-columns: 1fr; }
      .working-unit-actions { justify-items: start; grid-template-columns: 1fr auto; align-items: center; }
      .admin-access-toolbar, .create-user-grid { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);

  const headerUser = document.querySelector('.app-header .header-user');
  if (headerUser && !document.getElementById('workingUnitControl')) {
    const control = document.createElement('div');
    control.id = 'workingUnitControl';
    control.className = 'working-unit-control hidden';
    control.innerHTML = `
      <label>
        <span>Working Unit <small>(this session)</small></span>
        <select id="workingUnitSelect" aria-label="Working Unit"></select>
      </label>
      <div class="working-unit-actions">
        <span id="homeUnitCaption">Home unit not set</span>
        <button id="returnHomeUnitBtn" class="header-button compact" type="button">Use Home</button>
      </div>
    `;
    headerUser.before(control);
  }

  const inspectionUnit = document.getElementById('inspectionUnit');
  if (inspectionUnit && !document.getElementById('inspectionSetWorkingUnitBtn')) {
    const button = document.createElement('button');
    button.id = 'inspectionSetWorkingUnitBtn';
    button.className = 'field-link-button';
    button.type = 'button';
    button.textContent = 'Use as Working Unit';
    inspectionUnit.insertAdjacentElement('afterend', button);
  }

  const bulkUnit = document.getElementById('bulkUnit');
  if (bulkUnit && !document.getElementById('bulkSetWorkingUnitBtn')) {
    const button = document.createElement('button');
    button.id = 'bulkSetWorkingUnitBtn';
    button.className = 'field-link-button';
    button.type = 'button';
    button.textContent = 'Use as Working Unit';
    bulkUnit.insertAdjacentElement('afterend', button);
  }

  const admin = document.getElementById('usersView');
  if (admin) {
    admin.innerHTML = `
      <div class="page-title-row">
        <div>
          <div class="page-kicker">ADMINISTRATION</div>
          <h1>Administration</h1>
          <p>Manage Uniform Inspection access. Unit Admins manage Inspectors for their assigned units; Application Admins manage all access, home units, users, and grading standards.</p>
        </div>
      </div>

      <div class="admin-stack">
        <section class="app-panel access-management-panel">
          <div class="panel-heading">
            <div>
              <h2>User & Unit Access</h2>
              <p id="adminManagedUnitCaption">Loading your administration scope…</p>
            </div>
          </div>

          <div class="admin-access-toolbar">
            <label class="field">
              <span>Manage access for unit</span>
              <select id="adminManagedUnitFilter"></select>
            </label>
            <label class="field">
              <span>Find user</span>
              <input id="adminUserSearch" type="search" placeholder="Name or email" />
            </label>
          </div>

          <div class="permission-key">
            <span><strong>Inspector</strong> can inspect and report on that unit.</span>
            <span><strong>Unit Admin</strong> can also grant or remove Inspector access for that unit.</span>
            <span><strong>Application Admin</strong> has full access to every unit.</span>
          </div>

          <div class="table-wrap permission-table-wrap">
            <table class="permission-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Home Unit</th>
                  <th>Selected Unit Access</th>
                  <th>Application Admin</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="usersTableBody">
                <tr><td colspan="6">Loading users…</td></tr>
              </tbody>
            </table>
          </div>
          <p id="adminAccessMessage" class="form-message"></p>
        </section>

        <form id="createUserForm" class="app-panel stack app-admin-only">
          <div class="panel-heading">
            <div>
              <h2>Add / Authorize User</h2>
              <p>Create a new shared CAP Applications account or authorize an existing account for Uniform Inspections.</p>
            </div>
          </div>
          <div class="create-user-grid">
            <label class="field"><span>Display Name</span><input id="newUserName" required /></label>
            <label class="field"><span>Email</span><input id="newUserEmail" type="email" required /></label>
            <label class="field"><span>Temporary Password <small>(new shared accounts only)</small></span><input id="newUserPassword" type="password" minlength="8" /><small>Leave blank when the shared CAP account already exists.</small></label>
            <label class="field">
              <span>Initial Access Level</span>
              <select id="newUserRole">
                <option value="inspector">Inspector</option>
                <option value="unit_admin">Unit Admin</option>
                <option value="application_admin">Application Admin</option>
              </select>
            </label>
            <label class="field">
              <span>Home Unit *</span>
              <select id="newUserHomeUnit" required><option value="">Select unit...</option></select>
              <small>This permanent unit is selected whenever the user opens the application.</small>
            </label>
            <label class="field">
              <span>Initial Unit Access</span>
              <select id="newUserUnit"><option value="">Select unit...</option></select>
              <small id="newUserUnitHint">Choose the unit where this user will initially be authorized.</small>
            </label>
          </div>
          <div class="admin-form-actions">
            <button class="primary" type="submit">Create / Authorize User</button>
            <span id="userMessage" class="form-message"></span>
          </div>
        </form>

        <form id="gradingRulesForm" class="app-panel grading-panel app-admin-only">
          <div class="panel-heading">
            <div>
              <h2>Inspection Grading Standards</h2>
              <p>Application Admins can change the score thresholds without editing the application.</p>
            </div>
          </div>
          <div class="grading-rule-grid">
            <div class="grading-rule-card">
              <div class="grading-rule-title">Cadet Airmen <small>C/AB through C/SrA</small></div>
              <div class="threshold-grid">
                <label class="field"><span>Minimum Passing Score</span><input id="airmanPassMin" type="number" min="0" max="10" required /></label>
                <label class="field"><span>Minimum Excellent Score</span><input id="airmanExcellentMin" type="number" min="0" max="10" required /></label>
              </div>
              <div id="airmanRulePreview" class="rule-preview"></div>
            </div>
            <div class="grading-rule-card">
              <div class="grading-rule-title">Cadet NCOs & Officers <small>C/SSgt through C/Col</small></div>
              <div class="threshold-grid">
                <label class="field"><span>Minimum Passing Score</span><input id="ncoPassMin" type="number" min="0" max="10" required /></label>
                <label class="field"><span>Minimum Excellent Score</span><input id="ncoExcellentMin" type="number" min="0" max="10" required /></label>
              </div>
              <div id="ncoRulePreview" class="rule-preview"></div>
            </div>
          </div>
          <div class="admin-form-actions">
            <button class="primary" type="submit">Save Grading Standards</button>
            <button id="resetRulesBtn" class="secondary" type="button">Restore Original App Defaults</button>
            <span id="gradingRulesMessage" class="form-message"></span>
          </div>
        </form>

        <section class="app-panel">
          <div class="panel-heading">
            <div>
              <h2>Shared CAP Unit Directory</h2>
              <p>The units below come from the shared CAP Applications backend. Entry and report unit lists are limited to the units you are authorized to use.</p>
            </div>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Charter</th><th>Unit Name</th><th>Status</th><th>Source</th></tr></thead>
            <tbody id="unitsTableBody"></tbody>
          </table></div>
        </section>

        <section class="app-panel offline-panel">
          <div class="offline-panel-row">
            <div class="offline-panel-copy">
              <h2>Offline Tablet & Synchronization</h2>
              <p id="offlineStatusDetail">Checking local tablet storage…</p>
              <p>Inspections are saved on this device first, then synchronized with Supabase when an internet connection is available. Permission changes always require an online connection.</p>
            </div>
            <button id="refreshOfflineBtn" class="secondary" type="button">Refresh Offline Cache</button>
          </div>
        </section>
      </div>
    `;
  }
})();
