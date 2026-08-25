/* ============================================================
   DebitHub — Dashboard Module
   Handles: overview stats, creditors view, debts view,
            payments view, settings view, creditor detail panel
   ============================================================ */

window.DH = window.DH || {};

DH.dashboard = (() => {
  let currentView    = 'overview';
  let currentFilter  = 'month';
  let customFrom     = null;
  let customTo       = null;
  let selectedCreditorId = null;

  function T(k) { return DH.i18n.t(k); }
  function C(v, cur) { return DH.currency.format(v, cur); }
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  const CATEGORY_KEYS = {
    food: 'category_food', transport: 'category_transport', health: 'category_health',
    housing: 'category_housing', leisure: 'category_leisure', education: 'category_education',
    investment: 'category_investment', other: 'category_other',
  };
  const CATEGORY_ICONS = {
    food: 'coffee', transport: 'truck', health: 'heart', housing: 'home',
    leisure: 'smile', education: 'book', investment: 'trending-up', other: 'tag',
  };
  function categoryIcon(cat) { return CATEGORY_ICONS[cat] || 'tag'; }
  function categoryChip(cat) {
    if (!cat || !CATEGORY_KEYS[cat]) return '';
    return `<span class="chip"><span data-icon="${categoryIcon(cat)}"></span>${T(CATEGORY_KEYS[cat])}</span>`;
  }

  /* ════════════════════════════════
     VIEW ROUTING
  ════════════════════════════════ */
  function showView(view) {
    currentView = view;
    // Update nav active state
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-view') === view);
    });
    renderAll();
  }

  function renderAll() {
    const userId = DH.state.currentUser?.id;
    if (!userId) return;

    // Update user info in header
    const user = DH.state.currentUser;
    const avatarEl = document.getElementById('user-avatar-btn');
    if (avatarEl) avatarEl.textContent = DH.ui.getInitials(user.name);
    const nameEl = document.getElementById('dropdown-user-name');
    const emailEl = document.getElementById('dropdown-user-email');
    if (nameEl)  nameEl.textContent  = user.name;
    if (emailEl) emailEl.textContent = user.email;

    // Render active view
    const views = {
      overview: renderOverview,
      credores: renderCredores,
      debitos:  renderDebitos,
      payments: renderPayments,
      settings: renderSettings,
    };

    const render = views[currentView] || renderOverview;
    render();
    DH.icons.mount();
  }

  /* ════════════════════════════════
     OVERVIEW
  ════════════════════════════════ */
  function renderOverview() {
    const userId = DH.state.currentUser?.id;
    const main = document.getElementById('main-content');
    if (!main) return;

    const { from, to } = currentFilter === 'custom'
      ? { from: customFrom ? new Date(customFrom) : null, to: customTo ? new Date(customTo + 'T23:59:59') : null }
      : DH.dates.rangeFromFilter(currentFilter);

    const s = DH.data.analytics.summary(userId, from, to);
    const credores = DH.data.credores.getAll(userId);

    main.innerHTML = `
      <div class="animate-in">
        <div class="page-header flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 class="page-title">${T('dash_title')}</h1>
            <p class="page-subtitle">${T('dash_subtitle')}</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-ghost" onclick="DH.credores.openNewModal()">
              ${T('btn_new_credor')}
            </button>
            <button class="btn btn-primary" onclick="DH.debitos.openNewDebitModal()">
              ${T('btn_new_debit')}
            </button>
          </div>
        </div>

        <!-- Filter Bar -->
        <div class="filter-bar">
          <span class="filter-label">${T('filter_label')}</span>
          ${['today','month','3m','6m','1y'].map(f => `
            <button class="filter-btn ${currentFilter === f ? 'active' : ''}"
              onclick="DH.dashboard.setFilter('${f}')">${T('filter_' + f)}</button>
          `).join('')}
          <button class="filter-btn ${currentFilter === 'custom' ? 'active' : ''}"
            onclick="DH.dashboard.setFilter('custom')">${T('filter_custom')}</button>
          ${currentFilter === 'custom' ? `
            <div class="filter-date-range">
              <span>${T('filter_from')}:</span>
              <input type="text" class="form-input" id="filter-from" data-date-field
                onchange="DH.dashboard.setCustomFrom(DH.dateField.getISO(this))">
              <span>${T('filter_to')}:</span>
              <input type="text" class="form-input" id="filter-to" data-date-field
                onchange="DH.dashboard.setCustomTo(DH.dateField.getISO(this))">
            </div>` : ''}
        </div>

        <!-- Stats -->
        <div class="stats-grid" style="margin-bottom:2rem;">
          <div class="stat-card" style="--accent-color: var(--danger)">
            <div class="stat-icon" data-icon="wallet"></div>
            <div class="stat-label">${T('stat_total_debt')}</div>
            <div class="stat-value" style="color:var(--danger)">${C(s.activeDebt, s.currency)}</div>
            <div class="stat-sub">${s.debitCount} ${T('label_active_debits')}</div>
          </div>
          <div class="stat-card" style="--accent-color: var(--success)">
            <div class="stat-icon" data-icon="check-circle"></div>
            <div class="stat-label">${T('stat_total_paid')}</div>
            <div class="stat-value" style="color:var(--success)">${C(s.totalPaid, s.currency)}</div>
            <div class="stat-sub">${s.paymentCount} ${T('label_payments')}</div>
          </div>
          <div class="stat-card" style="--accent-color: var(--warning)">
            <div class="stat-icon" data-icon="calendar"></div>
            <div class="stat-label">${T('stat_this_month')}</div>
            <div class="stat-value" style="color:var(--warning)">${C(s.thisMonth, s.currency)}</div>
            <div class="stat-sub">${new Date().toLocaleDateString(DH.state.language === 'pt' ? 'pt-BR' : 'en-US', {month:'long', year:'numeric'})}</div>
          </div>
          <div class="stat-card" style="--accent-color: var(--accent)">
            <div class="stat-icon" data-icon="users"></div>
            <div class="stat-label">${T('stat_credores')}</div>
            <div class="stat-value">${credores.length}</div>
            <div class="stat-sub">${T('all_credores')}</div>
          </div>
        </div>

        <!-- Credores summary -->
        <div class="section">
          <div class="section-header">
            <h2 class="section-title"><span data-icon="users"></span> ${T('credores_title')}</h2>
            <button class="btn btn-ghost btn-sm" onclick="DH.dashboard.showView('credores')">
              ${T('credor_view')} <span data-icon="arrow-right"></span>
            </button>
          </div>
          ${credores.length === 0
            ? DH.ui.emptyState('users', 'credor_empty', 'credor_empty_sub')
            : `<div class="credores-grid">${credores.map(c => renderCredorCard(c)).join('')}</div>`
          }
        </div>
      </div>
    `;

    DH.dateField.mount();
    const fromEl = document.getElementById('filter-from');
    const toEl   = document.getElementById('filter-to');
    if (fromEl) DH.dateField.setISO(fromEl, customFrom || '');
    if (toEl)   DH.dateField.setISO(toEl, customTo || '');
  }

  function setFilter(f) {
    currentFilter = f;
    renderOverview();
    DH.icons.mount();
  }
  function setCustomFrom(v) { customFrom = v; renderOverview(); DH.icons.mount(); }
  function setCustomTo(v)   { customTo   = v; renderOverview(); DH.icons.mount(); }

  /* ════════════════════════════════
     CREDORES VIEW
  ════════════════════════════════ */
  function renderCredores() {
    const userId  = DH.state.currentUser?.id;
    const main    = document.getElementById('main-content');
    const credores = DH.data.credores.getAll(userId);

    main.innerHTML = `
      <div class="animate-in">
        <div class="page-header flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 class="page-title"><span data-icon="users"></span> ${T('credores_title')}</h1>
            <p class="page-subtitle">${T('credores_subtitle')}</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary" onclick="DH.credores.openNewModal()">
              ${T('btn_new_credor')}
            </button>
          </div>
        </div>

        ${credores.length === 0
          ? DH.ui.emptyState('users', 'credor_empty', 'credor_empty_sub')
          : `<div class="credores-grid">${credores.map(c => renderCredorCard(c)).join('')}</div>`
        }
      </div>
    `;
  }

  function renderCredorCard(credor) {
    const s = DH.data.analytics.creditorSummary(credor.id);
    const pct = s.totalDebt > 0 ? Math.min(100, (s.totalPaid / s.totalDebt) * 100) : 0;
    const barClass = pct >= 100 ? 'success' : pct > 50 ? 'warning' : '';

    return `
      <div class="credor-card" onclick="DH.dashboard.openCredorDetail('${credor.id}')">
        <div class="credor-card-header">
          <div class="credor-avatar">${DH.ui.getInitials(credor.name)}</div>
          <div class="credor-info">
            <div class="credor-name">${credor.name}</div>
            <div class="credor-meta"><span data-icon="map-pin"></span> ${credor.city}/${credor.state} ${credor.phone ? '· <span data-icon=\"phone\"></span> ' + credor.phone : ''}</div>
          </div>
          <div class="credor-actions" onclick="event.stopPropagation()">
            <button class="btn-icon" title="${T('credor_edit')}"
              onclick="DH.credores.openEditModal('${credor.id}')" data-icon="edit-2"></button>
            <button class="btn-icon" title="${T('credor_delete')}"
              onclick="DH.credores.deleteCredor('${credor.id}')" data-icon="trash-2"></button>
          </div>
        </div>

        <div class="credor-card-body">
          <div class="credor-amount-row">
            <div class="credor-total">
              <div class="credor-total-label">${T('credor_balance')}</div>
              <div class="credor-total-value">${C(s.balance, s.currency)}</div>
            </div>
            <div class="credor-paid">
              <div class="credor-paid-label">${T('credor_paid')}</div>
              <div class="credor-paid-value">${C(s.totalPaid, s.currency)}</div>
            </div>
          </div>
          <div class="progress">
            <div class="progress-bar ${barClass}" style="width:${pct.toFixed(1)}%"></div>
          </div>
          <div class="flex justify-between mt-1">
            <span class="text-xs text-muted">${T('credor_total')}: ${C(s.totalDebt, s.currency)}</span>
            <span class="text-xs text-muted">${pct.toFixed(0)}% ${T('label_percent_paid')}</span>
          </div>
        </div>

        <div onclick="event.stopPropagation()">
          <div class="credor-link" onclick="DH.dashboard.copyLink('${credor.id}')">
            <span data-icon="link"></span> <span style="font-size:0.7rem;opacity:.7">${T('credor_copy_link')}</span>
          </div>
        </div>
      </div>
    `;
  }

  function copyLink(creditorId) {
    const link = DH.data.credores.buildShareLink(creditorId);
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      DH.ui.showToast(T('toast_copied'), 'success');
    }).catch(() => {
      prompt('Copy link:', link);
    });
  }

  /* ════════════════════════════════
     CREDITOR DETAIL PANEL
  ════════════════════════════════ */
  function openCredorDetail(creditorId) {
    selectedCreditorId = creditorId;
    const credor = DH.data.credores.getById(creditorId);
    if (!credor) return;

    const panel   = document.getElementById('detail-panel');
    const overlay = document.getElementById('detail-overlay');
    if (!panel) return;

    const s = DH.data.analytics.creditorSummary(creditorId);
    const debits   = DH.data.debitos.getByCreditor(creditorId);
    const payments = DH.data.pagamentos.getByCreditor(creditorId);
    const pct = s.totalDebt > 0 ? Math.min(100, (s.totalPaid / s.totalDebt) * 100) : 0;

    panel.innerHTML = `
      <div class="detail-panel-header">
        <button class="detail-panel-back" onclick="DH.dashboard.closeDetail()" data-icon="arrow-left"></button>
        <div class="detail-panel-title">${credor.name}</div>
        <button class="btn-icon" title="${T('credor_edit')}"
          onclick="DH.credores.openEditModal('${credor.id}')" data-icon="edit-2"></button>
      </div>
      <div class="detail-panel-body">

        <!-- Hero Summary -->
        <div style="text-align:center;padding:1rem;background:var(--surface-2);border-radius:var(--radius-lg);">
          <div class="credor-avatar" style="margin:0 auto 1rem;width:56px;height:56px;font-size:1.5rem;">${DH.ui.getInitials(credor.name)}</div>
          <div style="font-size:1rem;font-weight:700;">${credor.name}</div>
          <div class="text-muted text-small"><span data-icon="map-pin"></span> ${credor.city}/${credor.state}${credor.phone ? ' · <span data-icon=\"phone\"></span> ' + credor.phone : ''}</div>
          <div class="copy-btn" style="margin:.75rem auto 0;display:inline-flex;" onclick="DH.dashboard.copyLink('${creditorId}')">
            <span data-icon="link"></span> ${T('credor_copy_link')}
          </div>
        </div>

        <!-- Stats -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.75rem;text-align:center;">
          <div style="background:var(--danger-dim);border-radius:var(--radius);padding:.85rem;">
            <div class="text-xs text-muted">${T('credor_total')}</div>
            <div style="font-weight:800;color:var(--danger);font-size:1rem;">${C(s.totalDebt, s.currency)}</div>
          </div>
          <div style="background:var(--success-dim);border-radius:var(--radius);padding:.85rem;">
            <div class="text-xs text-muted">${T('credor_paid')}</div>
            <div style="font-weight:800;color:var(--success);font-size:1rem;">${C(s.totalPaid, s.currency)}</div>
          </div>
          <div style="background:var(--warning-dim);border-radius:var(--radius);padding:.85rem;">
            <div class="text-xs text-muted">${T('credor_balance')}</div>
            <div style="font-weight:800;color:var(--warning);font-size:1rem;">${C(s.balance, s.currency)}</div>
          </div>
        </div>

        <!-- Progress -->
        <div>
          <div class="flex justify-between mb-1">
            <span class="text-xs text-muted">${T('stat_total_paid')}</span>
            <span class="text-xs font-semibold">${pct.toFixed(0)}%</span>
          </div>
          <div class="progress">
            <div class="progress-bar ${pct >= 100 ? 'success' : pct > 50 ? 'warning' : ''}" style="width:${pct.toFixed(1)}%"></div>
          </div>
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:.6rem;flex-wrap:wrap;">
          <button class="btn btn-primary" style="flex:1;" onclick="DH.debitos.openNewDebitModal('${creditorId}')">
            ${T('btn_new_debit')}
          </button>
          <button class="btn btn-success" style="flex:1;" onclick="DH.debitos.openPaymentModal('${creditorId}')">
            ${T('btn_new_payment')}
          </button>
        </div>

        <!-- Debits List -->
        <div class="section">
          <div class="section-header">
            <div class="section-title"><span data-icon="list"></span> ${T('debitos_title')}</div>
          </div>
          ${debits.length === 0
            ? DH.ui.emptyState('list', 'debit_empty', 'debit_empty_sub')
            : `<div style="display:flex;flex-direction:column;gap:.6rem;">
                ${debits.map(d => {
                  const paid = DH.data.pagamentos.totalPaidForDebit(d.id);
                  const rem  = Math.max(0, d.amount - paid);
                  const itemIcon = d.category ? categoryIcon(d.category) : (d.type === 'recurring' ? 'repeat' : d.type === 'installment' ? 'calendar' : 'dollar-sign');
                  return `
                    <div class="debit-item" style="cursor:default;">
                      <div class="debit-item-icon" style="background:var(--accent-dim)" data-icon="${itemIcon}"></div>
                      <div class="debit-item-body">
                        <div class="debit-item-desc">${d.description}</div>
                        <div class="debit-item-meta">
                          ${DH.ui.typeChip(d.type, d.installments)} ${categoryChip(d.category)} · ${DH.ui.fmtDate(d.date)}
                          ${d.type === 'installment' ? `<br><span class="text-xs" style="color:var(--success)">${T('debit_paid_amount')}: ${C(paid, d.currency)} · ${T('debit_remaining')}: ${C(rem, d.currency)}</span>` : ''}
                        </div>
                      </div>
                      <div class="debit-item-right">
                        <div class="debit-item-amount ${d.status === 'paid' ? 'text-muted' : ''}" style="${d.status === 'paid' ? 'text-decoration:line-through;' : 'color:var(--danger);'}">
                          ${C(d.amount, d.currency)}
                        </div>
                        ${DH.ui.statusBadge(d.status)}
                        <div style="display:flex;gap:.3rem;margin-top:.4rem;justify-content:flex-end;">
                          <button class="btn-icon" style="width:28px;height:28px;font-size:.8rem;" title="${T('debit_edit')}"
                            onclick="DH.debitos.openEditDebitModal('${d.id}')" data-icon="edit-2"></button>
                          <button class="btn-icon" style="width:28px;height:28px;font-size:.8rem;" title="${T('debit_delete')}"
                            onclick="DH.debitos.deleteDebit('${d.id}')" data-icon="trash-2"></button>
                        </div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>`
          }
        </div>

        <!-- Payments List -->
        <div class="section">
          <div class="section-header">
            <div class="section-title"><span data-icon="credit-card"></span> ${T('payments_title')}</div>
          </div>
          ${payments.length === 0
            ? DH.ui.emptyState('credit-card', 'payment_empty', 'payment_empty_sub')
            : `<div style="display:flex;flex-direction:column;gap:.5rem;">
                ${payments.sort((a,b) => new Date(b.date) - new Date(a.date)).map(p => {
                  const deb = DH.data.debitos.getById(p.debitId);
                  return `
                    <div class="payment-item">
                      <div class="payment-icon" data-icon="dollar-sign"></div>
                      <div class="payment-body">
                        <div class="payment-desc">${deb ? deb.description : '—'}</div>
                        <div class="payment-date">${DH.ui.fmtDate(p.date)}${p.note ? ' · ' + p.note : ''}</div>
                      </div>
                      <div class="payment-amount">+ ${C(p.amount, deb ? deb.currency : 'BRL')}</div>
                      <div style="display:flex;gap:.3rem;">
                        <button class="btn-icon" style="width:28px;height:28px;font-size:.8rem;" title="${T('payment_edit')}"
                          onclick="DH.debitos.openEditPaymentModal('${p.id}')" data-icon="edit-2"></button>
                        <button class="btn-icon" style="width:28px;height:28px;font-size:.8rem;" title="${T('payment_delete')}"
                          onclick="DH.debitos.deletePayment('${p.id}')" data-icon="trash-2"></button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>`
          }
        </div>
      </div>
    `;

    panel.classList.add('open');
    if (overlay) overlay.classList.add('open');
    DH.icons.mount(panel);
  }

  function closeDetail() {
    const panel   = document.getElementById('detail-panel');
    const overlay = document.getElementById('detail-overlay');
    if (panel)   panel.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    selectedCreditorId = null;
  }

  function refreshDetail() {
    if (selectedCreditorId) openCredorDetail(selectedCreditorId);
  }

  /* ════════════════════════════════
     DEBITS VIEW
  ════════════════════════════════ */
  function renderDebitos() {
    const userId = DH.state.currentUser?.id;
    const main = document.getElementById('main-content');
    const debits   = DH.data.debitos.getAll(userId);
    const credores = DH.data.credores.getAll(userId);

    const creditorMap = {};
    credores.forEach(c => { creditorMap[c.id] = c; });

    main.innerHTML = `
      <div class="animate-in">
        <div class="page-header flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 class="page-title"><span data-icon="list"></span> ${T('debitos_title')}</h1>
            <p class="page-subtitle">${T('debitos_subtitle')}</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary" onclick="DH.debitos.openNewDebitModal()">
              ${T('btn_new_debit')}
            </button>
          </div>
        </div>

        ${debits.length === 0
          ? DH.ui.emptyState('list', 'debit_empty', 'debit_empty_sub')
          : `<div class="table-wrapper">
              <table class="table">
                <thead>
                  <tr>
                    <th>${T('debit_description')}</th>
                    <th>${T('debit_creditor')}</th>
                    <th>${T('debit_category')}</th>
                    <th>${T('debit_type')}</th>
                    <th>${T('debit_date')}</th>
                    <th>${T('debit_amount')}</th>
                    <th>${T('debit_paid_amount')}</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${debits.sort((a,b) => new Date(b.date) - new Date(a.date)).map(d => {
                    const paid = DH.data.pagamentos.totalPaidForDebit(d.id);
                    const cred = creditorMap[d.creditorId];
                    return `
                      <tr>
                        <td><strong>${d.description}</strong></td>
                        <td>${cred ? cred.name : '—'}</td>
                        <td>${d.category ? categoryChip(d.category) : '<span class="text-muted">—</span>'}</td>
                        <td>${DH.ui.typeChip(d.type, d.installments)}</td>
                        <td>${DH.ui.fmtDate(d.date)}</td>
                        <td style="color:var(--danger);font-weight:700;">${C(d.amount, d.currency)}</td>
                        <td style="color:var(--success);font-weight:700;">${C(paid, d.currency)}</td>
                        <td>${DH.ui.statusBadge(d.status)}</td>
                        <td>
                          <div style="display:flex;gap:.3rem;">
                            <button class="btn-icon" title="${T('debit_edit')}"
                              onclick="DH.debitos.openEditDebitModal('${d.id}')" data-icon="edit-2"></button>
                            <button class="btn-icon" title="${T('debit_delete')}"
                              onclick="DH.debitos.deleteDebit('${d.id}')" data-icon="trash-2"></button>
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>`
        }
      </div>
    `;
  }

  /* ════════════════════════════════
     PAYMENTS VIEW
  ════════════════════════════════ */
  function renderPayments() {
    const userId = DH.state.currentUser?.id;
    const main = document.getElementById('main-content');
    const payments = DH.data.pagamentos.getAll(userId);
    const credores = DH.data.credores.getAll(userId);
    const creditorMap = {};
    credores.forEach(c => { creditorMap[c.id] = c; });

    main.innerHTML = `
      <div class="animate-in">
        <div class="page-header flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 class="page-title"><span data-icon="credit-card"></span> ${T('payments_title')}</h1>
            <p class="page-subtitle">${T('payments_subtitle')}</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary" onclick="DH.debitos.openPaymentModal()">
              ${T('btn_new_payment')}
            </button>
          </div>
        </div>

        ${payments.length === 0
          ? DH.ui.emptyState('credit-card', 'payment_empty', 'payment_empty_sub')
          : `<div class="table-wrapper">
              <table class="table">
                <thead>
                  <tr>
                    <th>${T('debit_description')}</th>
                    <th>${T('debit_creditor')}</th>
                    <th>${T('payment_date')}</th>
                    <th>${T('payment_amount')}</th>
                    <th>${T('payment_note')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${payments.sort((a,b) => new Date(b.date) - new Date(a.date)).map(p => {
                    const deb  = DH.data.debitos.getById(p.debitId);
                    const cred = creditorMap[p.creditorId];
                    return `
                      <tr>
                        <td><strong>${deb ? deb.description : '—'}</strong></td>
                        <td>${cred ? cred.name : '—'}</td>
                        <td>${DH.ui.fmtDate(p.date)}</td>
                        <td style="color:var(--success);font-weight:700;">${C(p.amount, deb ? deb.currency : 'BRL')}</td>
                        <td class="text-muted">${p.note || '—'}</td>
                        <td>
                          <div style="display:flex;gap:.3rem;">
                            <button class="btn-icon" title="${T('payment_edit')}"
                              onclick="DH.debitos.openEditPaymentModal('${p.id}')" data-icon="edit-2"></button>
                            <button class="btn-icon" title="${T('payment_delete')}"
                              onclick="DH.debitos.deletePayment('${p.id}')" data-icon="trash-2"></button>
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>`
        }
      </div>
    `;
  }

  /* ════════════════════════════════
     SETTINGS VIEW
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

          <!-- Account -->
          <div class="card">
            <h3 style="margin-bottom:1.25rem;display:flex;align-items:center;gap:.5rem;"><span data-icon="user"></span> ${T('settings_account')}</h3>
            <div class="form-group" style="margin-bottom:1rem;">
              <label class="form-label">${T('field_name')}</label>
              <div style="display:flex;gap:.6rem;">
                <input class="form-input" id="settings-name" value="${user.name}" style="flex:1;">
                <button class="btn btn-primary btn-sm" onclick="DH.dashboard.saveProfileName()">
                  ${T('btn_save')}
                </button>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">${T('field_email')}</label>
              <input class="form-input" value="${user.email}" disabled style="opacity:.6;cursor:not-allowed;">
            </div>
          </div>

          <!-- Registration details (editable, except CPF/ID) -->
          <div class="card">
            <h3 style="margin-bottom:1.25rem;display:flex;align-items:center;gap:.5rem;"><span data-icon="file-text"></span> ${T('settings_registration_data')}</h3>

            <div class="form-group" style="margin-bottom:1rem;">
              <label class="form-label" id="settings-doc-label">${T((user.country || 'BR') === 'BR' ? 'field_cpf' : 'field_id_number')}</label>
              <input class="form-input" value="${(user.country || 'BR') === 'BR' ? DH.data.formatCPF(user.cpf || '') : (user.cpf || '')}" disabled style="opacity:.6;cursor:not-allowed;">
              <div class="form-hint">${T('settings_document_readonly_note')}</div>
            </div>

            <div class="form-group" style="margin-bottom:1rem;">
              <label class="form-label">${T('field_phone')}</label>
              <input class="form-input" id="settings-phone" value="${escapeHtml(user.phone || '')}">
            </div>

            <div class="form-group" style="margin-bottom:1rem;">
              <label class="form-label">${T('field_country')}</label>
              <select class="form-select" id="settings-country"></select>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1rem;">
              <div class="form-group" id="settings-state-wrap">
                <label class="form-label">${T('credor_state')}</label>
                <select class="form-select" id="settings-state"></select>
              </div>
              <div class="form-group">
                <label class="form-label">${T('credor_city')}</label>
                <input class="form-input" id="settings-city" list="city-datalist" value="${escapeHtml(user.city || '')}">
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1rem;">
              <div class="form-group">
                <label class="form-label">${T('field_plan')}</label>
                <select class="form-select" id="settings-plan"></select>
              </div>
              <div class="form-group">
                <label class="form-label">${T('field_currency')}</label>
                <select class="form-select" id="settings-currency">
                  <option value="BRL" ${(user.currency || 'BRL') === 'BRL' ? 'selected' : ''}>${T('opt_currency_brl')}</option>
                  <option value="USD" ${user.currency === 'USD' ? 'selected' : ''}>${T('opt_currency_usd')}</option>
                  <option value="EUR" ${user.currency === 'EUR' ? 'selected' : ''}>${T('opt_currency_eur')}</option>
                </select>
              </div>
            </div>

            <div class="form-group" style="margin-bottom:1.25rem;">
              <label class="form-label">${T('field_payment_method')}</label>
              <select class="form-select" id="settings-payment-method">
                <option value="pix" ${user.paymentMethod === 'pix' ? 'selected' : ''}>${T('method_pix')}</option>
                <option value="card" ${user.paymentMethod === 'card' ? 'selected' : ''}>${T('method_card')}</option>
                <option value="boleto" ${user.paymentMethod === 'boleto' ? 'selected' : ''}>${T('method_boleto')}</option>
                <option value="bonus" ${user.paymentMethod === 'bonus' ? 'selected' : ''}>${T('method_bonus')}</option>
              </select>
            </div>

            <button class="btn btn-primary" onclick="DH.dashboard.saveRegistrationData()">${T('btn_save')}</button>
          </div>

          <!-- Change Password -->
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

          <!-- Appearance -->
          <div class="card">
            <h3 style="margin-bottom:1.25rem;display:flex;align-items:center;gap:.5rem;"><span data-icon="palette"></span> ${T('settings_theme')}</h3>
            <div style="display:flex;gap:.75rem;">
              <button class="btn ${DH.state.theme === 'dark' ? 'btn-primary' : 'btn-ghost'}"
                onclick="DH.ui.applyTheme('dark')"><span data-icon="moon"></span> ${T('settings_theme_dark')}</button>
              <button class="btn ${DH.state.theme === 'light' ? 'btn-primary' : 'btn-ghost'}"
                onclick="DH.ui.applyTheme('light')"><span data-icon="sun"></span> ${T('settings_theme_light')}</button>
            </div>
          </div>

          <!-- Language -->
          <div class="card">
            <h3 style="margin-bottom:1.25rem;display:flex;align-items:center;gap:.5rem;"><span data-icon="globe"></span> ${T('settings_language')}</h3>
            <div class="form-group">
              <label class="form-label">${T('lang_label')}</label>
              <select class="form-select" data-lang-select>
                <option value="pt">Português</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

        </div>
      </div>
    `;

    // Re-init after render
    DH.auth.initDashboard();
    DH.ui.initLanguageSelectors();
    initRegistrationFields(user);
  }

  /* ── Registration details: country / state / city cascading + plan list ── */
  function populateSettingsCountrySelect(selected) {
    const sel = document.getElementById('settings-country');
    if (!sel) return;
    const lang = DH.state.language || 'pt';
    sel.innerHTML = DH.geo.countries(lang).map(c => `<option value="${c.code}">${c.name}</option>`).join('');
    sel.value = selected || 'BR';
  }

  function populateSettingsStateField(country, selectedValue) {
    const wrap = document.getElementById('settings-state-wrap');
    if (!wrap) return;
    if (country === 'BR') {
      wrap.innerHTML = `
        <label class="form-label">${T('credor_state')}</label>
        <select class="form-select" id="settings-state"></select>`;
      const sel = document.getElementById('settings-state');
      sel.innerHTML = `<option value="">${T('select_state_placeholder')}</option>` +
        DH.geo.states().map(s => `<option value="${s.uf}">${s.uf} — ${s.name}</option>`).join('');
      if (selectedValue) sel.value = selectedValue;
      sel.onchange = () => updateSettingsCityForState(sel.value);
      updateSettingsCityForState(sel.value);
    } else {
      wrap.innerHTML = `
        <label class="form-label">${T('credor_state')}</label>
        <input type="text" class="form-input" id="settings-state">`;
      if (selectedValue) document.getElementById('settings-state').value = selectedValue;
      const cityInput = document.getElementById('settings-city');
      if (cityInput) cityInput.disabled = false;
      const list = document.getElementById('city-datalist');
      if (list) list.innerHTML = DH.data.distinctCities().map(c => `<option value="${c}"></option>`).join('');
    }
  }

  function updateSettingsCityForState(uf) {
    const list = document.getElementById('city-datalist');
    if (list) list.innerHTML = DH.data.distinctCitiesForState(uf).map(c => `<option value="${c}"></option>`).join('');
    const cityInput = document.getElementById('settings-city');
    if (!cityInput) return;
    cityInput.disabled = !uf;
    if (!uf) cityInput.placeholder = T('city_select_state_first');
  }

  function updateSettingsDocumentLabel(country) {
    const label = document.getElementById('settings-doc-label');
    if (!label) return;
    label.textContent = T((country || 'BR') === 'BR' ? 'field_cpf' : 'field_id_number');
  }

  function populateSettingsPlanSelect(selectedPlanId) {
    const sel = document.getElementById('settings-plan');
    if (!sel) return;
    const planList = DH.data.plans.getAllActive();
    sel.innerHTML = planList.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    if (planList.some(p => p.id === selectedPlanId)) sel.value = selectedPlanId;
  }

  function initRegistrationFields(user) {
    populateSettingsCountrySelect(user.country || 'BR');
    populateSettingsStateField(user.country || 'BR', user.state || '');
    updateSettingsDocumentLabel(user.country || 'BR');
    populateSettingsPlanSelect(user.planId || '');

    const countrySel = document.getElementById('settings-country');
    if (countrySel) {
      countrySel.onchange = () => {
        populateSettingsStateField(countrySel.value, '');
        updateSettingsDocumentLabel(countrySel.value);
      };
    }
  }

  async function saveRegistrationData() {
    const userId = DH.state.currentUser.id;
    const phone         = document.getElementById('settings-phone')?.value?.trim();
    const country       = document.getElementById('settings-country')?.value;
    const state          = document.getElementById('settings-state')?.value?.trim();
    const city           = document.getElementById('settings-city')?.value?.trim();
    const planId         = document.getElementById('settings-plan')?.value;
    const currency       = document.getElementById('settings-currency')?.value;
    const paymentMethod  = document.getElementById('settings-payment-method')?.value;

    await DH.data.users.updateProfile(userId, { phone, country, city, state, planId, currency, paymentMethod });
    DH.state.currentUser.country = country;
    DH.state.currentUser.city = city;
    DH.state.currentUser.state = state;
    DH.state.currentUser.planId = planId;
    DH.state.currentUser.currency = currency;
    DH.state.currentUser.paymentMethod = paymentMethod;
    DH.state.currentUser.phone = phone;
    DH.ui.showToast(T('toast_registration_updated'), 'success');
  }

  async function saveProfileName() {
    const name = document.getElementById('settings-name')?.value?.trim();
    if (!name) return;
    await DH.data.users.updateName(DH.state.currentUser.id, name);
    DH.ui.showToast(T('toast_profile_updated'), 'success');
    // Update header avatar
    const avatarEl = document.getElementById('user-avatar-btn');
    if (avatarEl) avatarEl.textContent = DH.ui.getInitials(name);
    const nameEl = document.getElementById('dropdown-user-name');
    if (nameEl) nameEl.textContent = name;
  }

  /* ── Public API ── */
  return {
    showView,
    renderAll,
    renderOverview,
    renderCredores,
    renderDebitos,
    renderPayments,
    renderSettings,
    renderCredorCard,
    setFilter,
    setCustomFrom,
    setCustomTo,
    openCredorDetail,
    closeDetail,
    refreshDetail,
    copyLink,
    saveProfileName,
    saveRegistrationData,
    get selectedCreditorId() { return selectedCreditorId; },
  };
})();
