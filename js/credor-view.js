/* ============================================================
   DebitHub — Public Creditor View
   Renders the public-facing page at /credor/<slug>/<public_code>. Only
   the numeric code is actually looked up (get_public_credor RPC) — the
   slug is decorative, so it stays readable even after a credor renames.
   No login required, but it IS a real network call.
   ============================================================ */

window.DH = window.DH || {};

DH.credorView = (() => {
  function T(k) { return DH.i18n.t(k); }
  function C(v, cur) { return DH.currency.format(v, cur); }
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  let currentData   = null; // { credor, debtor, debits, payments }
  let currentFilter = 'month';
  let customFrom    = null;
  let customTo      = null;

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

  function codeFromLocation() {
    const pathMatch = window.location.pathname.match(/\/credor\/[a-z0-9-]+\/(\d+)\/?$/i);
    if (pathMatch) return pathMatch[1];
    // Fallback for local/dev servers that don't apply the .htaccess rewrite.
    return new URLSearchParams(window.location.search).get('code');
  }

  async function init() {
    currentFilter = 'month'; customFrom = null; customTo = null;

    const code = codeFromLocation();
    if (!code) { currentData = null; renderNotFound(); return; }

    renderLoading();
    try {
      const data = await DH.data.credores.fetchPublicByCode(Number(code));
      if (!data || !data.credor) { currentData = null; renderNotFound(); return; }
      currentData = data;
      renderDashboard();
    } catch {
      currentData = null; renderNotFound();
    }
  }

  function renderLoading() {
    const content = document.getElementById('credor-content');
    if (content) content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:3rem;"><div class="spinner"></div></div>`;
  }

  function renderNotFound() {
    const heroName = document.getElementById('hero-name');
    const heroSub  = document.getElementById('hero-sub');
    if (heroName) heroName.textContent = T('pub_not_found');
    if (heroSub)  heroSub.textContent  = '';
    const content = document.getElementById('credor-content');
    if (content) {
      content.innerHTML = `
        <div class="empty-state" style="padding:4rem 2rem;">
          <div class="empty-icon" data-icon="alert-circle"></div>
          <h3>${T('pub_not_found')}</h3>
          <p>${T('pub_not_found_sub')}</p>
        </div>
      `;
    }
    const promo = document.getElementById('credor-promo');
    if (promo) promo.style.display = 'none';
    DH.icons.mount();
  }

  function renderPromo() {
    const promo = document.getElementById('credor-promo');
    if (!promo || !currentData) return;
    const textEl = document.getElementById('credor-promo-text');
    const ctaEl  = document.getElementById('credor-promo-cta');
    if (textEl) textEl.textContent = `${currentData.debtor.name || ''} ${T('pub_ad_text')} DebitHub`.trim();
    if (ctaEl)  ctaEl.textContent  = T('pub_ad_cta');
    promo.style.display = 'flex';
  }

  function rangeForFilter() {
    return currentFilter === 'custom'
      ? { from: customFrom ? new Date(customFrom) : null, to: customTo ? new Date(customTo + 'T23:59:59') : null }
      : DH.dates.rangeFromFilter(currentFilter);
  }

  function inRange(dateStr, from, to) {
    if (!from && !to) return true;
    const dt = new Date(dateStr + 'T00:00:00');
    if (from && dt < from) return false;
    if (to   && dt > to)   return false;
    return true;
  }

  function paidForDebit(debitId) {
    return currentData.payments.filter(p => p.debitId === debitId).reduce((s, p) => s + p.amount, 0);
  }

  function renderFilterBar() {
    return `
      <div class="filter-bar">
        <span class="filter-label">${T('filter_label')}</span>
        ${['today','month','3m','6m','1y'].map(f => `
          <button class="filter-btn ${currentFilter === f ? 'active' : ''}"
            onclick="DH.credorView.setFilter('${f}')">${T('filter_' + f)}</button>
        `).join('')}
        <button class="filter-btn ${currentFilter === 'custom' ? 'active' : ''}"
          onclick="DH.credorView.setFilter('custom')">${T('filter_custom')}</button>
        ${currentFilter === 'custom' ? `
          <div class="filter-date-range">
            <span>${T('filter_from')}:</span>
            <input type="text" class="form-input" id="credor-filter-from" data-date-field
              onchange="DH.credorView.setCustomFrom(DH.dateField.getISO(this))">
            <span>${T('filter_to')}:</span>
            <input type="text" class="form-input" id="credor-filter-to" data-date-field
              onchange="DH.credorView.setCustomTo(DH.dateField.getISO(this))">
          </div>` : ''}
      </div>`;
  }

  function setFilter(f) { currentFilter = f; renderDashboard(); }
  function setCustomFrom(v) { customFrom = v; renderDashboard(); }
  function setCustomTo(v)   { customTo   = v; renderDashboard(); }

  function renderDashboard() {
    if (!currentData) { renderNotFound(); return; }
    const { credor, debtor, debits, payments } = currentData;

    const heroName = document.getElementById('hero-name');
    const heroSub  = document.getElementById('hero-sub');
    if (heroName) heroName.textContent = credor.name;
    if (heroSub) {
      heroSub.innerHTML = debtor.name
        ? `<span class="hero-sub-label">${T('pub_debtor_label')}</span> ${escapeHtml(debtor.name)}`
        : '';
    }

    const { from, to } = rangeForFilter();
    const debitsInRange   = debits.filter(d => inRange(d.date, from, to));
    const paymentsInRange = payments.filter(p => inRange(p.date, from, to));

    const totalDebt = debitsInRange.reduce((s, d) => s + d.amount, 0);
    const totalPaid = paymentsInRange.reduce((s, p) => s + p.amount, 0);
    const balance   = Math.max(0, debitsInRange.reduce((s, d) => s + Math.max(0, d.amount - paidForDebit(d.id)), 0));
    const codes = [...new Set(debitsInRange.map(d => d.currency || 'BRL'))];
    const cur = codes.length === 1 ? codes[0] : 'BRL';

    const content = document.getElementById('credor-content');
    if (!content) return;

    content.innerHTML = `
      ${renderFilterBar()}

      <!-- Summary Cards -->
      <div class="stats-grid">
        <div class="stat-card" style="--accent-color:var(--danger)">
          <div class="stat-icon" data-icon="wallet"></div>
          <div class="stat-label">${T('pub_total')}</div>
          <div class="stat-value" style="color:var(--danger)">${C(balance, cur)}</div>
          <div class="stat-sub">${debitsInRange.length} ${T('label_active_debits')}</div>
        </div>
        <div class="stat-card" style="--accent-color:var(--success)">
          <div class="stat-icon" data-icon="check-circle"></div>
          <div class="stat-label">${T('pub_paid')}</div>
          <div class="stat-value" style="color:var(--success)">${C(totalPaid, cur)}</div>
          <div class="stat-sub">${paymentsInRange.length} ${T('label_payments')}</div>
        </div>
        <div class="stat-card" style="--accent-color:var(--accent)">
          <div class="stat-icon" data-icon="dollar-sign"></div>
          <div class="stat-label">${T('pub_active')}</div>
          <div class="stat-value">${C(totalDebt, cur)}</div>
          <div class="stat-sub">${T('filter_' + (currentFilter === 'custom' ? 'custom' : currentFilter))}</div>
        </div>
      </div>

      <!-- Debits in period -->
      <div class="card">
        <div class="section-header">
          <div class="section-title"><span data-icon="list"></span> ${T('debitos_title')}</div>
        </div>
        ${debitsInRange.length === 0
          ? `<p class="text-muted text-small" style="padding:.5rem 0;">${T('pub_no_debt')}</p>`
          : `<div style="display:flex;flex-direction:column;gap:.6rem;margin-top:.75rem;">
              ${debitsInRange.sort((a, b) => new Date(b.date) - new Date(a.date)).map(d => renderDebitItem(d)).join('')}
            </div>`
        }
      </div>

      <!-- Extrato button -->
      <button class="btn btn-ghost w-full" style="margin-top:.5rem;"
        onclick="DH.credorView.showExtrato()">
        <span data-icon="file-text"></span> ${T('pub_btn_extrato')}
      </button>
    `;
    renderPromo();
    DH.icons.mount();
    DH.dateField.mount();
    const fromEl = document.getElementById('credor-filter-from');
    const toEl   = document.getElementById('credor-filter-to');
    if (fromEl) DH.dateField.setISO(fromEl, customFrom || '');
    if (toEl)   DH.dateField.setISO(toEl, customTo || '');
  }

  function renderDebitItem(d) {
    const paid = paidForDebit(d.id);
    const rem  = Math.max(0, d.amount - paid);
    const itemIcon = d.category ? categoryIcon(d.category) : (d.type === 'recurring' ? 'repeat' : d.type === 'installment' ? 'calendar' : 'dollar-sign');
    return `
      <div class="debit-item" style="cursor:default;">
        <div class="debit-item-icon" style="background:${d.status === 'paid' ? 'var(--success-dim)' : 'var(--danger-dim)'}" data-icon="${itemIcon}"></div>
        <div class="debit-item-body">
          <div class="debit-item-desc">${d.description}</div>
          <div class="debit-item-meta">
            ${DH.ui.typeChip(d.type, d.installments)} ${categoryChip(d.category)}
            · ${DH.dates.formatDate(d.date)}
            ${d.type === 'installment' ? `<br><span class="text-xs" style="color:var(--success)">${T('debit_paid_amount')}: ${C(paid, d.currency)} · ${T('debit_remaining')}: ${C(rem, d.currency)}</span>` : ''}
          </div>
        </div>
        <div class="debit-item-right">
          <div class="debit-item-amount" style="${d.status === 'paid' ? 'text-decoration:line-through;color:var(--text-muted)' : 'color:var(--danger);font-weight:700;'}">
            ${C(d.amount, d.currency)}
          </div>
          ${DH.ui.statusBadge(d.status)}
        </div>
      </div>
    `;
  }

  function showExtrato() {
    if (!currentData) return;
    const { payments, debits } = currentData;
    const debitMap = {};
    debits.forEach(d => { debitMap[d.id] = d; });
    const sorted = payments.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    const content = document.getElementById('credor-content');

    content.innerHTML = `
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;">
        <button class="btn btn-ghost btn-sm" onclick="DH.credorView.renderCurrent()"><span data-icon="arrow-left"></span> ${T('pub_btn_back')}</button>
        <h2 class="section-title"><span data-icon="file-text"></span> ${T('pub_full_statement')}</h2>
      </div>
      ${sorted.length === 0
        ? DH.ui.emptyState('credit-card', 'payment_empty', 'payment_empty_sub')
        : `<div class="table-wrapper">
            <table class="table">
              <thead>
                <tr>
                  <th>${T('debit_description')}</th>
                  <th>${T('payment_date')}</th>
                  <th>${T('payment_amount')}</th>
                  <th>${T('payment_note')}</th>
                </tr>
              </thead>
              <tbody>
                ${sorted.map(p => {
                  const deb = debitMap[p.debitId];
                  return `
                    <tr>
                      <td><strong>${deb ? deb.description : '—'}</strong></td>
                      <td>${DH.dates.formatDate(p.date)}</td>
                      <td style="color:var(--success);font-weight:700;">+ ${C(p.amount, deb ? deb.currency : 'BRL')}</td>
                      <td class="text-muted">${p.note || '—'}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
          <div style="text-align:right;margin-top:1rem;font-weight:700;color:var(--success);">
            ${T('label_total_received')}: ${C(sorted.reduce((s, p) => s + p.amount, 0), (() => { const cs = [...new Set(debits.map(d => d.currency || 'BRL'))]; return cs.length === 1 ? cs[0] : 'BRL'; })())}
          </div>`
      }
    `;
    DH.icons.mount();
  }

  function renderCurrent() { renderDashboard(); }

  return { init, showExtrato, renderCurrent, setFilter, setCustomFrom, setCustomTo };
})();
