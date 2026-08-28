/* ============================================================
   DebitHub — Admin Panel
   Shows registered accounts, revenue, and subscription status.
   Never shows passwords, security codes, or the debt content
   users have written (creditor names, descriptions, amounts).
   Subscription payments are entered manually by the admin —
   any account without a payment in the last 30 days is treated
   as "inadimplente" (past due).
   ============================================================ */

window.DH = window.DH || {};

DH.admin = (() => {
  function T(k) { return DH.i18n.t(k); }
  function C(v) { return DH.currency.format(v, 'BRL'); }

  let currentView   = 'overview';
  let revenueFilter = '30d';
  let revenueFrom   = null;
  let revenueTo     = null;
  let accountSearch = '';
  let billingSearch = '';
  let billingFrom   = null;
  let billingTo     = null;

  const METHOD_KEYS = { pix: 'method_pix', card: 'method_card', boleto: 'method_boleto', bonus: 'method_bonus' };
  function methodLabel(m) { return m && METHOD_KEYS[m] ? T(METHOD_KEYS[m]) : '—'; }

  function statusBadge(current) {
    return current
      ? `<span class="badge badge-active"><span class="badge-dot"></span>${T('admin_status_current')}</span>`
      : `<span class="badge badge-overdue"><span class="badge-dot"></span>${T('admin_status_overdue')}</span>`;
  }

  const ACCOUNT_STATUS_MAP = {
    pending:   ['badge-partial', 'account_status_pending'],
    active:    ['badge-active',  'account_status_active'],
    suspended: ['badge-overdue', 'account_status_suspended'],
  };
  function accountStatusBadge(status) {
    const [cls, key] = ACCOUNT_STATUS_MAP[status] || ACCOUNT_STATUS_MAP.pending;
    return `<span class="badge ${cls}"><span class="badge-dot"></span>${T(key)}</span>`;
  }

  function accountStatusToggleBtn(a) {
    return a.status === 'active'
      ? `<button class="btn-icon btn-icon-danger" title="${T('admin_suspend_account')}" data-icon="alert-circle" onclick="DH.admin.suspendAccount('${a.id}')"></button>`
      : `<button class="btn-icon btn-icon-success" title="${T('admin_activate_account')}" data-icon="check-circle" onclick="DH.admin.activateAccount('${a.id}')"></button>`;
  }

  const PERIOD_KEYS = { monthly: 'plan_period_monthly', quarterly: 'plan_period_quarterly', semiannual: 'plan_period_semiannual', annual: 'plan_period_annual', unlimited: 'plan_period_unlimited' };
  const PERIOD_OPTION_KEYS = { monthly: 'period_option_monthly', quarterly: 'period_option_quarterly', semiannual: 'period_option_semiannual', annual: 'period_option_annual', unlimited: 'period_option_unlimited' };

  function countryName(code) {
    if (!code) return '—';
    const lang = DH.state.language || 'pt';
    const match = DH.geo.countries(lang).find(c => c.code === code);
    return match ? match.name : code;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  /* ════════════════════════════════
     VIEW ROUTING
  ════════════════════════════════ */
  function showView(view) {
    currentView = view;
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-view') === view);
    });
    renderAll();
  }

  function renderAll() {
    const views = { overview: renderOverview, accounts: renderAccounts, billing: renderBilling, plans: renderPlans, settings: renderSettings };
    (views[currentView] || renderOverview)();
    DH.icons.mount();
    DH.dateField.mount();
    DH.moneyField.mount();
  }

  /* ════════════════════════════════
     OVERVIEW
  ════════════════════════════════ */
  function renderOverview() {
    const main = document.getElementById('main-content');
    if (!main) return;

    const accounts = DH.data.users.listForAdmin();
    const currentCount = accounts.filter(a => a.current).length;
    const overdueCount = accounts.length - currentCount;

    const { from, to } = revenueFilter === 'custom'
      ? { from: revenueFrom ? new Date(revenueFrom) : null, to: revenueTo ? new Date(revenueTo + 'T23:59:59') : null }
      : DH.dates.rangeForBilling(revenueFilter);
    const rev = DH.data.billing.summary(from, to);

    main.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <h1 class="page-title"><span data-icon="bar-chart-2"></span> ${T('admin_nav_overview')}</h1>
          <p class="page-subtitle">${T('admin_subtitle')}</p>
        </div>

        <div class="filter-bar">
          <span class="filter-label">${T('filter_label')}</span>
          ${['30d', '3m', '6m', '1y', 'all'].map(f => `
            <button class="filter-btn ${revenueFilter === f ? 'active' : ''}"
              onclick="DH.admin.setRevenueFilter('${f}')">${T('admin_filter_' + f)}</button>
          `).join('')}
          <button class="filter-btn ${revenueFilter === 'custom' ? 'active' : ''}"
            onclick="DH.admin.setRevenueFilter('custom')">${T('filter_custom')}</button>
          ${revenueFilter === 'custom' ? `
            <div class="filter-date-range">
              <span>${T('filter_from')}:</span>
              <input type="text" class="form-input" id="revenue-filter-from" data-date-field
                onchange="DH.admin.setRevenueFrom(DH.dateField.getISO(this))">
              <span>${T('filter_to')}:</span>
              <input type="text" class="form-input" id="revenue-filter-to" data-date-field
                onchange="DH.admin.setRevenueTo(DH.dateField.getISO(this))">
            </div>` : ''}
        </div>

        <div class="stats-grid" style="margin-bottom:1.5rem;">
          <div class="stat-card" style="--accent-color: var(--success)">
            <div class="stat-icon" data-icon="dollar-sign"></div>
            <div class="stat-label">${T('admin_stat_revenue')}</div>
            <div class="stat-value" style="color:var(--success)">${C(rev.revenue)}</div>
            <div class="stat-sub">${rev.paymentCount} ${T('label_payments')}</div>
          </div>
          <div class="stat-card" style="--accent-color: var(--accent)">
            <div class="stat-icon" data-icon="users"></div>
            <div class="stat-label">${T('admin_stat_users')}</div>
            <div class="stat-value">${accounts.length}</div>
          </div>
          <div class="stat-card" style="--accent-color: var(--success)">
            <div class="stat-icon" data-icon="check-circle"></div>
            <div class="stat-label">${T('admin_stat_current')}</div>
            <div class="stat-value" style="color:var(--success)">${currentCount}</div>
          </div>
          <div class="stat-card" style="--accent-color: var(--danger)">
            <div class="stat-icon" data-icon="alert-circle"></div>
            <div class="stat-label">${T('admin_stat_overdue')}</div>
            <div class="stat-value" style="color:var(--danger)">${overdueCount}</div>
          </div>
        </div>

        <div class="card" style="display:flex; align-items:flex-start; gap:.75rem; background:var(--accent-dim); border-color:var(--border);">
          <span data-icon="shield" style="color:var(--accent); margin-top:.15rem;"></span>
          <p class="text-small text-2" style="margin:0;">${T('admin_privacy_note')}</p>
        </div>
      </div>
    `;

    DH.dateField.mount();
    const fromEl = document.getElementById('revenue-filter-from');
    const toEl   = document.getElementById('revenue-filter-to');
    if (fromEl) DH.dateField.setISO(fromEl, revenueFrom || '');
    if (toEl)   DH.dateField.setISO(toEl, revenueTo || '');
  }

  function setRevenueFilter(f) { revenueFilter = f; renderOverview(); DH.icons.mount(); }
  function setRevenueFrom(v) { revenueFrom = v; renderOverview(); DH.icons.mount(); }
  function setRevenueTo(v)   { revenueTo   = v; renderOverview(); DH.icons.mount(); }

  /* ════════════════════════════════
     ACCOUNTS
  ════════════════════════════════ */
  function renderAccounts() {
    const main = document.getElementById('main-content');
    if (!main) return;

    const accounts = DH.data.users.listForAdmin();
    const q = accountSearch.trim().toLowerCase();
    const filtered = q
      ? accounts.filter(a => a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q))
      : accounts;

    main.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <h1 class="page-title"><span data-icon="users"></span> ${T('admin_nav_accounts')}</h1>
          <p class="page-subtitle">${T('admin_subtitle')}</p>
        </div>

        <div class="card" style="margin-bottom:1.25rem; display:flex; align-items:flex-start; gap:.75rem; background:var(--accent-dim); border-color:var(--border);">
          <span data-icon="shield" style="color:var(--accent); margin-top:.15rem;"></span>
          <p class="text-small text-2" style="margin:0;">${T('admin_privacy_note')}</p>
        </div>

        <div class="search-wrapper" style="position:relative; max-width:360px; margin-bottom:1.25rem;">
          <span class="search-icon" data-icon="search"></span>
          <input type="text" class="form-input" id="account-search" style="padding-left:2.4rem;"
            placeholder="${T('admin_search_placeholder')}" value="${escapeHtml(accountSearch)}">
        </div>

        ${filtered.length === 0
          ? DH.ui.emptyState('users', 'admin_empty', 'admin_empty_sub')
          : `<div class="table-wrapper">
              <table class="table table-compact">
                <thead>
                  <tr>
                    <th>${T('admin_col_name')}</th>
                    <th>${T('admin_col_phone')}</th>
                    <th>${T('admin_col_cpf')}</th>
                    <th>${T('admin_col_location')}</th>
                    <th>${T('admin_col_created')}</th>
                    <th>${T('admin_col_account_status')}</th>
                    <th>${T('admin_col_status')}</th>
                    <th title="${T('admin_col_credores')} / ${T('admin_col_debitos')}">${T('admin_col_credores')} / ${T('admin_col_debitos')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${filtered.map(a => `
                    <tr>
                      <td><strong>${escapeHtml(a.name)}</strong><div class="text-xs text-muted">${escapeHtml(a.email)}</div></td>
                      <td class="text-muted">${escapeHtml(a.phone) || '—'}</td>
                      <td class="text-muted">${escapeHtml(a.cpf) || '—'}</td>
                      <td class="text-muted">${a.city ? escapeHtml(a.city) + '/' + escapeHtml(a.state) : '—'}<div class="text-xs text-muted">${countryName(a.country)}</div></td>
                      <td>${DH.ui.fmtDate(a.createdAt.split('T')[0])}</td>
                      <td>${accountStatusBadge(a.status)}</td>
                      <td>${statusBadge(a.current)}</td>
                      <td title="${a.credCount} ${T('admin_col_credores')} · ${a.debitCount} ${T('admin_col_debitos')}">${a.credCount} / ${a.debitCount}</td>
                      <td style="white-space:nowrap;">
                        <div style="display:flex;gap:.3rem;justify-content:flex-end;flex-wrap:nowrap;">
                          <button class="btn-icon btn-icon-success" title="${T('admin_modal_mark_paid')}" data-icon="dollar-sign"
                            onclick="DH.admin.openBillingModal('${a.id}')"></button>
                          ${accountStatusToggleBtn(a)}
                          <button class="btn-icon" title="${T('admin_history_title')}" data-icon="file-text"
                            onclick="DH.admin.openHistoryModal('${a.id}')"></button>
                          <button class="btn-icon" title="${T('admin_edit_account')}" data-icon="edit-2"
                            onclick="DH.admin.openAccountModal('${a.id}')"></button>
                          <button class="btn-icon btn-icon-danger" title="${T('admin_delete_account')}" data-icon="trash-2"
                            onclick="DH.admin.deleteAccount('${a.id}')"></button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>`
        }
      </div>
    `;

    const searchInput = document.getElementById('account-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        accountSearch = searchInput.value;
        const pos = searchInput.selectionStart;
        renderAccounts();
        DH.icons.mount();
        const el = document.getElementById('account-search');
        if (el) { el.focus(); el.setSelectionRange(pos, pos); }
      });
    }
  }

  /* ════════════════════════════════
     BILLING (mark who paid)
  ════════════════════════════════ */
  function renderBilling() {
    const main = document.getElementById('main-content');
    if (!main) return;

    const users = DH.data.users.getAll();
    const userMap = {};
    users.forEach(u => { userMap[u.id] = u; });

    const q = billingSearch.trim().toLowerCase();
    let records = DH.data.billing.getAll().sort((a, b) => new Date(b.date) - new Date(a.date));
    if (q) {
      records = records.filter(r => {
        const u = userMap[r.userId];
        return u && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
      });
    }
    if (billingFrom) records = records.filter(r => r.date >= billingFrom);
    if (billingTo)   records = records.filter(r => r.date <= billingTo);

    main.innerHTML = `
      <div class="animate-in">
        <div class="page-header flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 class="page-title"><span data-icon="credit-card"></span> ${T('admin_nav_billing')}</h1>
            <p class="page-subtitle">${T('admin_billing_subtitle')}</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-success" onclick="DH.admin.openBillingModal()">
              ${T('admin_modal_mark_paid')}
            </button>
          </div>
        </div>

        <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-end;margin-bottom:1.25rem;">
          <div class="search-wrapper" style="position:relative; max-width:360px;">
            <span class="search-icon" data-icon="search"></span>
            <input type="text" class="form-input" id="billing-search" style="padding-left:2.4rem;"
              placeholder="${T('admin_search_placeholder')}" value="${escapeHtml(billingSearch)}">
          </div>
          <div class="filter-date-range">
            <span>${T('filter_from')}:</span>
            <input type="text" class="form-input" id="billing-filter-from" data-date-field
              onchange="DH.admin.setBillingFrom(DH.dateField.getISO(this))">
            <span>${T('filter_to')}:</span>
            <input type="text" class="form-input" id="billing-filter-to" data-date-field
              onchange="DH.admin.setBillingTo(DH.dateField.getISO(this))">
          </div>
        </div>

        <h2 class="section-title" style="margin-bottom:.75rem;"><span data-icon="file-text"></span> ${T('admin_all_payments_title')}</h2>

        ${records.length === 0
          ? DH.ui.emptyState('credit-card', 'admin_empty', 'admin_empty_sub')
          : `<div class="table-wrapper">
              <table class="table">
                <thead>
                  <tr>
                    <th>${T('admin_col_user')}</th>
                    <th>${T('payment_date')}</th>
                    <th>${T('admin_col_plan')}</th>
                    <th>${T('admin_col_method')}</th>
                    <th>${T('payment_amount')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${records.map(r => {
                    const u = userMap[r.userId];
                    return `
                    <tr>
                      <td><strong>${u ? escapeHtml(u.name) : '—'}</strong><div class="text-xs text-muted">${u ? escapeHtml(u.email) : ''}</div></td>
                      <td>${DH.ui.fmtDate(r.date)}</td>
                      <td>${escapeHtml(r.plan) || '—'}</td>
                      <td>${methodLabel(r.method)}</td>
                      <td style="color:var(--success);font-weight:700;">${C(r.amount)}</td>
                      <td>
                        <div style="display:flex;gap:.3rem;justify-content:flex-end;">
                          <button class="btn-icon" title="${T('credor_edit')}" data-icon="edit-2"
                            onclick="DH.admin.openBillingModal('${r.userId}', '${r.id}')"></button>
                          <button class="btn-icon" title="${T('btn_delete')}" data-icon="trash-2"
                            onclick="DH.admin.deleteBillingRecord('${r.id}', '${r.userId}')"></button>
                        </div>
                      </td>
                    </tr>
                  `;}).join('')}
                </tbody>
              </table>
            </div>`
        }
      </div>
    `;

    DH.dateField.mount();
    const fromEl = document.getElementById('billing-filter-from');
    const toEl   = document.getElementById('billing-filter-to');
    if (fromEl) DH.dateField.setISO(fromEl, billingFrom || '');
    if (toEl)   DH.dateField.setISO(toEl, billingTo || '');

    const searchInput = document.getElementById('billing-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        billingSearch = searchInput.value;
        const pos = searchInput.selectionStart;
        renderBilling();
        DH.icons.mount();
        const el = document.getElementById('billing-search');
        if (el) { el.focus(); el.setSelectionRange(pos, pos); }
      });
    }
  }

  function setBillingFrom(v) { billingFrom = v; renderBilling(); DH.icons.mount(); }
  function setBillingTo(v)   { billingTo   = v; renderBilling(); DH.icons.mount(); }

  function populateBillingUserSelect(selectedId) {
    const sel = document.getElementById('billing-user');
    if (!sel) return;
    const accounts = DH.data.users.listForAdmin();
    sel.innerHTML = `<option value="">—</option>` + accounts.map(a =>
      `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${escapeHtml(a.name)} — ${escapeHtml(a.email)}</option>`
    ).join('');
  }

  function populateBillingPlanSelect(selectedPlanId, currency) {
    const sel = document.getElementById('billing-plan');
    if (!sel) return;
    const planList = DH.data.plans.getAll();
    sel.innerHTML = `<option value="">—</option>` + planList.map(p =>
      `<option value="${p.id}">${escapeHtml(p.name)} — ${DH.currency.format(DH.data.plans.priceFor(p, currency), currency)}${T(PERIOD_KEYS[p.period] || 'plan_period_monthly')}</option>`
    ).join('');
    if (planList.some(p => p.id === selectedPlanId)) sel.value = selectedPlanId;
  }

  function openBillingModal(preselectedUserId, editRecordId) {
    const form = document.getElementById('billing-form');
    if (!form) return;
    form.reset();
    document.getElementById('billing-id').value = '';
    document.getElementById('billing-amount').value = '';
    clearBillingErrors();
    populateBillingUserSelect(preselectedUserId || '');

    const account = preselectedUserId
      ? DH.data.users.listForAdmin().find(a => a.id === preselectedUserId)
      : null;
    populateBillingPlanSelect(account ? account.registeredPlanId : '', account ? account.currency : 'BRL');
    const methodSel = document.getElementById('billing-method');
    if (methodSel) methodSel.value = (account && account.registeredMethod) || 'pix';
    document.getElementById('billing-activate').checked = true;
    document.getElementById('billing-modal-title').innerHTML =
      `<span data-icon="credit-card"></span> ${T('admin_modal_mark_paid')}`;

    if (editRecordId) {
      const record = DH.data.billing.getAll().find(r => r.id === editRecordId);
      if (record) {
        document.getElementById('billing-id').value = editRecordId;
        document.getElementById('billing-modal-title').innerHTML =
          `<span data-icon="credit-card"></span> ${T('admin_modal_edit_payment')}`;
        if (methodSel) methodSel.value = record.method || 'pix';
        DH.moneyField.setValue(document.getElementById('billing-amount'), record.amount);
        DH.dateField.setISO(document.getElementById('billing-date'), record.date);
        document.getElementById('billing-note').value = record.note || '';
        const planSel = document.getElementById('billing-plan');
        const matchingPlan = DH.data.plans.getAll().find(p => p.name === record.plan);
        if (planSel && matchingPlan) planSel.value = matchingPlan.id;
        document.getElementById('billing-activate').checked = false;
      }
    } else {
      DH.dateField.setISO(document.getElementById('billing-date'), DH.dates.today());
    }
    DH.icons.mount(document.getElementById('billing-modal-title'));
    DH.ui.openModal('billing-modal-overlay');
  }

  async function saveBilling() {
    clearBillingErrors();
    const id      = document.getElementById('billing-id').value;
    const userId  = document.getElementById('billing-user').value;
    const method  = document.getElementById('billing-method').value;
    const planId  = document.getElementById('billing-plan').value;
    const planObj = planId ? DH.data.plans.getById(planId) : null;
    const plan    = planObj ? planObj.name : '';
    const amount  = DH.moneyField.getValue(document.getElementById('billing-amount'));
    const date    = DH.dateField.getISO(document.getElementById('billing-date'));
    const note    = document.getElementById('billing-note').value;
    const activate = document.getElementById('billing-activate').checked;

    let valid = true;
    if (!userId) { showBillingErr('billing-user', T('err_required')); valid = false; }
    if (!amount || amount <= 0) { showBillingErr('billing-amount', T('err_amount_positive')); valid = false; }
    if (!date) { showBillingErr('billing-date', T('err_required')); valid = false; }
    if (!valid) return;

    if (id) {
      await DH.data.billing.update(id, { method, plan, amount, date, note });
      DH.ui.showToast(T('toast_payment_updated'), 'success');
    } else {
      await DH.data.billing.create({ userId, method, plan, amount, date, note });
      DH.ui.showToast(T('toast_payment_created'), 'success');
    }
    if (activate) await DH.data.users.setStatus(userId, 'active');
    DH.ui.closeModal('billing-modal-overlay');
    renderAll();
  }

  function showBillingErr(id, msg) {
    const el = document.getElementById(id + '-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
    const inp = document.getElementById(id);
    if (inp) inp.style.borderColor = 'var(--danger)';
  }
  function clearBillingErrors() {
    ['billing-user', 'billing-amount', 'billing-date'].forEach(id => {
      const el = document.getElementById(id + '-error');
      if (el) { el.textContent = ''; el.classList.add('hidden'); }
      const inp = document.getElementById(id);
      if (inp) inp.style.borderColor = '';
    });
  }

  function openHistoryModal(userId) {
    const user = DH.data.users.getById(userId);
    const records = DH.data.billing.getByUser(userId).sort((a, b) => new Date(b.date) - new Date(a.date));
    document.getElementById('billing-history-title').innerHTML =
      `<span data-icon="file-text"></span> ${T('admin_history_title')}${user ? ' — ' + escapeHtml(user.name) : ''}`;

    const body = document.getElementById('billing-history-body');
    body.innerHTML = records.length === 0
      ? `<p class="text-small text-muted">${T('admin_history_empty')}</p>`
      : `<div class="table-wrapper">
          <table class="table">
            <thead>
              <tr>
                <th>${T('payment_date')}</th>
                <th>${T('admin_col_plan')}</th>
                <th>${T('admin_col_method')}</th>
                <th>${T('payment_amount')}</th>
                <th>${T('payment_note')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${records.map(r => `
                <tr>
                  <td>${DH.ui.fmtDate(r.date)}</td>
                  <td>${escapeHtml(r.plan) || '—'}</td>
                  <td>${methodLabel(r.method)}</td>
                  <td style="color:var(--success);font-weight:700;">${C(r.amount)}</td>
                  <td class="text-muted">${escapeHtml(r.note) || '—'}</td>
                  <td><button class="btn-icon" data-icon="trash-2" title="${T('btn_delete')}"
                    onclick="DH.admin.deleteBillingRecord('${r.id}', '${userId}')"></button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;

    DH.icons.mount(body);
    DH.ui.openModal('billing-history-modal');
  }

  function deleteBillingRecord(recordId, userId) {
    DH.ui.confirm(T('admin_history_delete_confirm'), async () => {
      await DH.data.billing.delete(recordId);
      DH.ui.showToast(T('toast_payment_deleted'), 'info');
      openHistoryModal(userId);
      if (currentView === 'billing') renderBilling();
      if (currentView === 'overview') renderOverview();
      DH.icons.mount();
    });
  }

  /* ════════════════════════════════
     ACCOUNT ACTIVATION
     New accounts get immediate access ('pending'). If not activated
     within 24h they auto-suspend (see DH.data.users.syncExpiredPending) —
     their debt data is never touched by any of this.
  ════════════════════════════════ */
  async function activateAccount(userId) {
    await DH.data.users.setStatus(userId, 'active');
    DH.ui.showToast(T('toast_account_activated'), 'success');
    renderAll();
  }

  async function suspendAccount(userId) {
    await DH.data.users.setStatus(userId, 'suspended');
    DH.ui.showToast(T('toast_account_suspended'), 'info');
    renderAll();
  }

  /* ════════════════════════════════
     EDIT / DELETE ACCOUNT (admin)
  ════════════════════════════════ */
  function populateAccountCountrySelect(selected) {
    const sel = document.getElementById('account-country');
    if (!sel) return;
    const lang = DH.state.language || 'pt';
    sel.innerHTML = DH.geo.countries(lang).map(c => `<option value="${c.code}">${c.name}</option>`).join('');
    sel.value = selected || 'BR';
  }

  function populateAccountStateField(country, selectedValue) {
    const wrap = document.getElementById('account-state-wrap');
    if (!wrap) return;
    if (country === 'BR') {
      wrap.innerHTML = `
        <label class="form-label" data-i18n="credor_state">Estado</label>
        <select class="form-select" id="account-state"></select>`;
      const sel = document.getElementById('account-state');
      sel.innerHTML = `<option value="">${T('select_state_placeholder')}</option>` +
        DH.geo.states().map(s => `<option value="${s.uf}">${s.uf} — ${s.name}</option>`).join('');
      if (selectedValue) sel.value = selectedValue;
      sel.onchange = () => updateAccountCityForState(sel.value);
      updateAccountCityForState(sel.value);
    } else {
      wrap.innerHTML = `
        <label class="form-label" data-i18n="credor_state">Estado</label>
        <input type="text" class="form-input" id="account-state">`;
      if (selectedValue) document.getElementById('account-state').value = selectedValue;
      updateAccountCityDatalistGlobal();
      const cityInput = document.getElementById('account-city');
      if (cityInput) cityInput.disabled = false;
    }
    DH.i18n.applyTranslations();
  }

  /* City suggestions only appear once a state has been chosen, scoped to that state (BR only). */
  function updateAccountCityForState(uf) {
    const list = document.getElementById('city-datalist');
    if (list) list.innerHTML = DH.data.distinctCitiesForState(uf).map(c => `<option value="${c}"></option>`).join('');
    const cityInput = document.getElementById('account-city');
    if (!cityInput) return;
    cityInput.disabled = !uf;
    cityInput.placeholder = uf ? '' : T('city_select_state_first');
  }

  function updateAccountCityDatalistGlobal() {
    const list = document.getElementById('city-datalist');
    if (list) list.innerHTML = DH.data.distinctCities().map(c => `<option value="${c}"></option>`).join('');
  }

  function updateAccountDocumentLabel(country) {
    const label = document.getElementById('account-cpf-label');
    if (!label) return;
    const isBR = (country || 'BR') === 'BR';
    label.setAttribute('data-i18n', isBR ? 'field_cpf' : 'field_id_number');
    label.textContent = T(isBR ? 'field_cpf' : 'field_id_number');
  }

  function populateAccountPlanSelect(selectedPlanId) {
    const sel = document.getElementById('account-plan');
    if (!sel) return;
    const planList = DH.data.plans.getAll();
    sel.innerHTML = `<option value="">—</option>` + planList.map(p =>
      `<option value="${p.id}">${escapeHtml(p.name)}</option>`
    ).join('');
    if (planList.some(p => p.id === selectedPlanId)) sel.value = selectedPlanId;
  }

  function openAccountModal(userId) {
    const user = DH.data.users.getById(userId);
    if (!user) return;
    const form = document.getElementById('account-form');
    if (!form) return;
    form.reset();
    document.getElementById('account-id').value = userId;
    document.getElementById('account-name').value = user.name;
    document.getElementById('account-phone').value = user.phone || '';
    document.getElementById('account-cpf').value = user.cpf || '';
    populateAccountCountrySelect(user.country || 'BR');
    populateAccountStateField(user.country || 'BR', user.state || '');
    updateAccountDocumentLabel(user.country || 'BR');
    document.getElementById('account-city').value = user.city || '';
    populateAccountPlanSelect(user.planId || '');
    document.getElementById('account-currency').value = user.currency || 'BRL';
    document.getElementById('account-payment-method').value = user.paymentMethod || 'pix';

    const countrySel = document.getElementById('account-country');
    if (countrySel) {
      countrySel.onchange = () => {
        populateAccountStateField(countrySel.value, '');
        updateAccountDocumentLabel(countrySel.value);
      };
    }

    DH.ui.openModal('account-modal-overlay');
  }

  async function saveAccount() {
    const userId = document.getElementById('account-id').value;
    if (!userId) return;
    const name    = document.getElementById('account-name').value.trim();
    const phone   = document.getElementById('account-phone').value.trim();
    const cpf     = document.getElementById('account-cpf').value.trim();
    const country = document.getElementById('account-country').value;
    const city    = document.getElementById('account-city').value.trim();
    const state   = document.getElementById('account-state').value.trim();
    const planId  = document.getElementById('account-plan').value;
    const currency = document.getElementById('account-currency').value;
    const paymentMethod = document.getElementById('account-payment-method').value;

    if (!name) { DH.ui.showToast(T('err_required'), 'error'); return; }

    await DH.data.users.adminUpdate(userId, { name, phone, cpf, country, city, state, planId, currency, paymentMethod });
    DH.ui.showToast(T('toast_account_updated'), 'success');
    DH.ui.closeModal('account-modal-overlay');
    renderAll();
  }

  function deleteAccount(userId) {
    DH.ui.confirm(T('admin_delete_account_confirm'), async () => {
      const result = await DH.data.users.delete(userId);
      if (result.error) { DH.ui.showToast(T('err_generic'), 'error'); return; }
      DH.ui.showToast(T('toast_account_deleted'), 'info');
      renderAll();
    });
  }

  /* ════════════════════════════════
     PLANS
     Whatever is edited here shows up immediately as the plan
     choices on the registration form.
  ════════════════════════════════ */
  function renderPlans() {
    const main = document.getElementById('main-content');
    if (!main) return;

    const planList = DH.data.plans.getAll();

    main.innerHTML = `
      <div class="animate-in">
        <div class="page-header flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 class="page-title"><span data-icon="tag"></span> ${T('admin_nav_plans')}</h1>
            <p class="page-subtitle">${T('admin_plans_subtitle')}</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary" onclick="DH.admin.openPlanModal()">${T('btn_new_plan')}</button>
          </div>
        </div>

        ${planList.length === 0
          ? DH.ui.emptyState('tag', 'admin_plan_empty', 'admin_plan_empty_sub')
          : `<div class="table-wrapper">
              <table class="table">
                <thead>
                  <tr>
                    <th>${T('admin_col_plan_name')}</th>
                    <th>${T('field_plan_price_brl')}</th>
                    <th>${T('field_plan_price_usd')}</th>
                    <th>${T('field_plan_price_eur')}</th>
                    <th>${T('admin_col_plan_period')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${planList.map(p => `
                    <tr>
                      <td><strong>${escapeHtml(p.name)}</strong></td>
                      <td style="font-weight:700;">${DH.currency.format(p.prices.BRL, 'BRL')}</td>
                      <td style="font-weight:700;">${DH.currency.format(p.prices.USD, 'USD')}</td>
                      <td style="font-weight:700;">${DH.currency.format(p.prices.EUR, 'EUR')}</td>
                      <td>${T(PERIOD_OPTION_KEYS[p.period] || 'period_option_monthly')}</td>
                      <td>
                        <div style="display:flex;gap:.3rem;justify-content:flex-end;">
                          <button class="btn-icon" title="${T('credor_edit')}" data-icon="edit-2"
                            onclick="DH.admin.openPlanModal('${p.id}')"></button>
                          <button class="btn-icon" title="${T('btn_delete')}" data-icon="trash-2"
                            onclick="DH.admin.deletePlan('${p.id}')"></button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>`
        }
      </div>
    `;
  }

  function openPlanModal(planId) {
    const form = document.getElementById('plan-form');
    if (!form) return;
    form.reset();
    clearPlanErrors();
    document.getElementById('plan-id').value = '';
    ['plan-price-brl', 'plan-price-usd', 'plan-price-eur'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('plan-modal-title').innerHTML =
      `<span data-icon="tag"></span> ${T('admin_modal_new_plan')}`;

    if (planId) {
      const plan = DH.data.plans.getById(planId);
      if (plan) {
        document.getElementById('plan-id').value = plan.id;
        document.getElementById('plan-name').value = plan.name;
        DH.moneyField.setValue(document.getElementById('plan-price-brl'), plan.prices.BRL);
        DH.moneyField.setValue(document.getElementById('plan-price-usd'), plan.prices.USD);
        DH.moneyField.setValue(document.getElementById('plan-price-eur'), plan.prices.EUR);
        document.getElementById('plan-period').value = plan.period;
        document.getElementById('plan-modal-title').innerHTML =
          `<span data-icon="tag"></span> ${T('admin_modal_edit_plan')}`;
      }
    }
    DH.icons.mount(document.getElementById('plan-modal-title'));
    DH.ui.openModal('plan-modal-overlay');
  }

  async function savePlan() {
    clearPlanErrors();
    const id     = document.getElementById('plan-id').value;
    const name   = document.getElementById('plan-name').value.trim();
    const prices = {
      BRL: DH.moneyField.getValue(document.getElementById('plan-price-brl')),
      USD: DH.moneyField.getValue(document.getElementById('plan-price-usd')),
      EUR: DH.moneyField.getValue(document.getElementById('plan-price-eur')),
    };
    const period = document.getElementById('plan-period').value;

    let valid = true;
    if (!name) { showPlanErr('plan-name', T('err_required')); valid = false; }
    if (!prices.BRL || prices.BRL < 0) { showPlanErr('plan-price-brl', T('err_amount_invalid')); valid = false; }
    if (!valid) return;

    if (id) {
      await DH.data.plans.update(id, { name, prices, period });
      DH.ui.showToast(T('toast_plan_updated'), 'success');
    } else {
      await DH.data.plans.create({ name, prices, period });
      DH.ui.showToast(T('toast_plan_created'), 'success');
    }
    DH.ui.closeModal('plan-modal-overlay');
    renderAll();
  }

  function deletePlan(planId) {
    DH.ui.confirm(T('admin_plan_delete_confirm'), async () => {
      const result = await DH.data.plans.delete(planId);
      if (result && result.error) { DH.ui.showToast(T(result.error), 'error'); return; }
      DH.ui.showToast(T('toast_plan_deleted'), 'info');
      renderAll();
    });
  }

  function showPlanErr(id, msg) {
    const el = document.getElementById(id + '-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
    const inp = document.getElementById(id);
    if (inp) inp.style.borderColor = 'var(--danger)';
  }
  function clearPlanErrors() {
    ['plan-name', 'plan-price-brl'].forEach(id => {
      const el = document.getElementById(id + '-error');
      if (el) { el.textContent = ''; el.classList.add('hidden'); }
      const inp = document.getElementById(id);
      if (inp) inp.style.borderColor = '';
    });
  }

  /* ════════════════════════════════
     SETTINGS (admin's own account)
  ════════════════════════════════ */
  function renderSettings() {
    const main = document.getElementById('main-content');
    const user = DH.state.currentUser;

    main.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <h1 class="page-title"><span data-icon="settings"></span> ${T('settings_title')}</h1>
        </div>

        <div style="display:grid;gap:1.5rem;max-width:600px;">
          <div class="card">
            <h3 style="margin-bottom:1.25rem;display:flex;align-items:center;gap:.5rem;"><span data-icon="user"></span> ${T('settings_account')}</h3>
            <div class="form-group" style="margin-bottom:1rem;">
              <label class="form-label">${T('field_name')}</label>
              <div style="display:flex;gap:.6rem;">
                <input class="form-input" id="settings-name" value="${escapeHtml(user.name)}" style="flex:1;">
                <button class="btn btn-primary btn-sm" onclick="DH.admin.saveProfileName()">${T('btn_save')}</button>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">${T('field_email')}</label>
              <input class="form-input" value="${escapeHtml(user.email)}" disabled style="opacity:.6;cursor:not-allowed;">
            </div>
          </div>

          <div class="card">
            <h3 style="margin-bottom:1.25rem;display:flex;align-items:center;gap:.5rem;"><span data-icon="lock"></span> ${T('change_password_title')}</h3>
            <form id="change-password-form" style="display:flex;flex-direction:column;gap:1rem;">
              <div class="form-group">
                <label class="form-label">${T('field_current_password')}</label>
                <div class="input-group">
                  <input type="password" class="form-input" id="change-current-password" autocomplete="current-password">
                  <button type="button" class="input-action" data-password-toggle="change-current-password" data-icon="eye"></button>
                </div>
                <span class="form-error hidden" id="change-current-password-error"></span>
              </div>
              <div class="form-group">
                <label class="form-label">${T('field_new_password')}</label>
                <div class="input-group">
                  <input type="password" class="form-input" id="change-new-password" autocomplete="new-password">
                  <button type="button" class="input-action" data-password-toggle="change-new-password" data-icon="eye"></button>
                </div>
                <div class="password-strength">
                  <div class="password-strength-bar"><div class="password-strength-fill" id="change-strength-bar"></div></div>
                  <div class="password-strength-text" id="change-strength-text"></div>
                </div>
                <span class="form-error hidden" id="change-new-password-error"></span>
              </div>
              <div class="form-group">
                <label class="form-label">${T('field_confirm_password')}</label>
                <div class="input-group">
                  <input type="password" class="form-input" id="change-confirm-password" autocomplete="new-password">
                  <button type="button" class="input-action" data-password-toggle="change-confirm-password" data-icon="eye"></button>
                </div>
                <span class="form-error hidden" id="change-confirm-password-error"></span>
              </div>
              <button type="submit" class="btn btn-primary">${T('btn_change_password')}</button>
            </form>
          </div>

          <div class="card">
            <h3 style="margin-bottom:1.25rem;display:flex;align-items:center;gap:.5rem;"><span data-icon="palette"></span> ${T('settings_theme')}</h3>
            <div style="display:flex;gap:.75rem;">
              <button class="btn ${DH.state.theme === 'dark' ? 'btn-primary' : 'btn-ghost'}"
                onclick="DH.ui.applyTheme('dark')"><span data-icon="moon"></span> ${T('settings_theme_dark')}</button>
              <button class="btn ${DH.state.theme === 'light' ? 'btn-primary' : 'btn-ghost'}"
                onclick="DH.ui.applyTheme('light')"><span data-icon="sun"></span> ${T('settings_theme_light')}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    DH.auth.initDashboard();
  }

  async function saveProfileName() {
    const name = document.getElementById('settings-name')?.value?.trim();
    if (!name) return;
    await DH.data.users.updateName(DH.state.currentUser.id, name);
    DH.ui.showToast(T('toast_profile_updated'), 'success');
    document.getElementById('user-avatar-btn').textContent = DH.ui.getInitials(name);
    document.getElementById('dropdown-user-name').textContent = name;
  }

  /* ── Init ── */
  function init() {
    DH.moneyField.mount();
    const form = document.getElementById('billing-form');
    if (form) DH.ui.onSubmitOnce(form, saveBilling);
    const planForm = document.getElementById('plan-form');
    if (planForm) DH.ui.onSubmitOnce(planForm, savePlan);
    const accountForm = document.getElementById('account-form');
    if (accountForm) DH.ui.onSubmitOnce(accountForm, saveAccount);
  }

  return {
    init, showView, renderAll,
    setRevenueFilter, setRevenueFrom, setRevenueTo,
    setBillingFrom, setBillingTo,
    openBillingModal, openHistoryModal, deleteBillingRecord,
    activateAccount, suspendAccount,
    openAccountModal, saveAccount, deleteAccount,
    openPlanModal, deletePlan,
    saveProfileName,
  };
})();
