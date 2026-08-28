/* ============================================================
   DebitHub — UI Utilities & Global App Shell
   ============================================================ */

window.DH = window.DH || {};

DH.ui = (() => {
  const TOAST_ICONS = { success: 'check-circle', error: 'alert-circle', warning: 'alert-triangle', info: 'check-circle' };

  /* ── Toast ── */
  function showToast(msg, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="toast-icon" data-icon="${TOAST_ICONS[type] || 'check-circle'}"></span><span>${msg}</span>`;
    container.appendChild(el);
    DH.icons.mount(el);
    setTimeout(() => {
      el.classList.add('removing');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, 3500);
  }

  /* ── Modal helpers ── */
  function openModal(id) {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.classList.add('open');
  }
  function closeModal(id) {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.classList.remove('open');
    // Blur whatever still has focus inside — the overlay keeps rendering during its
    // fade-out transition, so a lingering focused field could catch a stray Enter
    // keypress and resubmit the form a second time with the same (unreset) values.
    if (document.activeElement && overlay.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }
  function closeAllModals() {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  }

  /* ── Guard a form's submit handler against firing twice for one user action
     (double Enter, double-click, or a stray keydown+submit combo). ── */
  function onSubmitOnce(form, handler) {
    if (!form) return;
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (form.dataset.busy === '1') return;
      form.dataset.busy = '1';
      try { handler(e); } finally {
        setTimeout(() => { delete form.dataset.busy; }, 600);
      }
    });
  }

  /* ── Panel helpers ── */
  function openPanel(id) {
    const panel = document.getElementById(id);
    const overlay = document.getElementById(id + '-overlay');
    if (panel) panel.classList.add('open');
    if (overlay) overlay.classList.add('open');
  }
  function closePanel(id) {
    const panel = document.getElementById(id);
    const overlay = document.getElementById(id + '-overlay');
    if (panel) panel.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
  }

  /* ── Confirm dialog ── */
  let _confirmCallback = null;
  function confirm(message, onConfirm) {
    const overlay = document.getElementById('confirm-modal');
    const msgEl   = document.getElementById('confirm-message');
    if (!overlay || !msgEl) return;

    _confirmCallback = onConfirm;
    msgEl.textContent = message;
    overlay.classList.add('open');
  }

  function _confirmOk() {
    document.getElementById('confirm-modal')?.classList.remove('open');
    if (_confirmCallback) { const cb = _confirmCallback; _confirmCallback = null; cb(); }
  }
  function _confirmCancel() {
    document.getElementById('confirm-modal')?.classList.remove('open');
    _confirmCallback = null;
  }

  /* ── Theme ── */
  function initTheme() {
    const saved = localStorage.getItem('dh_theme') || 'dark';
    applyTheme(saved);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    DH.state.theme = theme;
    localStorage.setItem('dh_theme', theme);
    // Update all toggle buttons
    document.querySelectorAll('.toggle-theme-btn').forEach(btn => {
      btn.setAttribute('data-icon', theme === 'dark' ? 'sun' : 'moon');
      btn.title = theme === 'dark' ? 'Modo claro' : 'Modo escuro';
    });
    DH.icons.mount();
  }

  function toggleTheme() {
    const current = DH.state.theme || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  /* ── Language selector ── */
  function initLanguageSelectors() {
    document.querySelectorAll('[data-lang-select]').forEach(sel => {
      sel.value = DH.state.language || 'pt';
      sel.addEventListener('change', () => {
        DH.i18n.setLanguage(sel.value);
        // Sync all selectors
        document.querySelectorAll('[data-lang-select]').forEach(s => s.value = sel.value);
        DH.i18n.applyTranslations();
        DH.icons.mount();
        if (typeof DH.dateField !== 'undefined') DH.dateField.reformatAll();
        // Re-render if dashboard is loaded
        if (typeof DH.dashboard !== 'undefined') DH.dashboard.renderAll();
        if (typeof DH.credorView !== 'undefined') DH.credorView.init();
        if (typeof DH.admin !== 'undefined') DH.admin.renderAll();
        if (typeof DH.auth !== 'undefined' && DH.auth.populatePlanSelect) DH.auth.populatePlanSelect();
        if (typeof DH.auth !== 'undefined' && DH.auth.populateCountrySelect) DH.auth.populateCountrySelect();
      });
    });
  }

  /* ── Mobile sidebar ── */
  function initMobileSidebar() {
    const hamburger = document.getElementById('hamburger-btn');
    const sidebar   = document.getElementById('app-sidebar');
    const sideOverlay = document.getElementById('sidebar-overlay');
    if (!hamburger || !sidebar) return;

    hamburger.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
      if (sideOverlay) sideOverlay.classList.toggle('show');
    });
    if (sideOverlay) {
      sideOverlay.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
        sideOverlay.classList.remove('show');
      });
    }
  }

  /* ── Close modals on overlay click & ESC ── */
  function initModalClosers() {
    // Click outside to close
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.classList.remove('open');
      });
    });
    // ESC to close
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeAllModals();
    });
  }

  /* ── User dropdown ── */
  function initUserDropdown() {
    const avatar   = document.getElementById('user-avatar-btn');
    const dropdown = document.getElementById('user-dropdown');
    if (!avatar || !dropdown) return;

    avatar.addEventListener('click', e => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });
    document.addEventListener('click', e => {
      if (!dropdown.contains(e.target) && e.target !== avatar) {
        dropdown.classList.remove('open');
      }
    });
  }

  /* ── Sidebar nav ── */
  function initSidebarNav() {
    const controller = typeof DH.admin !== 'undefined' ? DH.admin : DH.dashboard;
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.getAttribute('data-view');
        controller.showView(view);
        // Close mobile sidebar
        const sidebar = document.getElementById('app-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (sidebar) sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('show');
      });
    });
  }

  /* ── Avatar initials ── */
  function getInitials(name) {
    return (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  /* ── Empty state HTML (icon = icon name) ── */
  function emptyState(icon, titleKey, subKey) {
    const t = DH.i18n.t;
    return `
      <div class="empty-state">
        <div class="empty-icon" data-icon="${icon}"></div>
        <h3>${t(titleKey)}</h3>
        <p>${t(subKey)}</p>
      </div>`;
  }

  /* ── Format date display ── */
  function fmtDate(iso) { return DH.dates.formatDate(iso); }
  function fmtCurr(v, currency)   { return DH.currency.format(v, currency); }

  /* ── Status badge HTML (colored dot + label) ── */
  function statusBadge(status) {
    const t = DH.i18n.t;
    const map = {
      active:  ['badge-active',  'debit_status_active'],
      paid:    ['badge-paid',    'debit_status_paid'],
      partial: ['badge-partial', 'debit_status_partial'],
    };
    const [cls, key] = map[status] || map.active;
    return `<span class="badge ${cls}"><span class="badge-dot"></span>${t(key)}</span>`;
  }

  /* ── Debit type chip ── */
  function typeChip(type, installments) {
    const t = DH.i18n.t;
    if (type === 'recurring')    return `<span class="chip"><span data-icon="repeat"></span>${t('recurring_label')}</span>`;
    if (type === 'installment')  return `<span class="chip"><span data-icon="calendar"></span>${installments}x</span>`;
    return `<span class="chip">1x ${t('unique_label')}</span>`;
  }

  return {
    showToast,
    openModal, closeModal, closeAllModals,
    onSubmitOnce,
    openPanel, closePanel,
    confirm, _confirmOk, _confirmCancel,
    initTheme, applyTheme, toggleTheme,
    initLanguageSelectors,
    initMobileSidebar,
    initModalClosers,
    initUserDropdown,
    initSidebarNav,
    getInitials,
    emptyState,
    fmtDate, fmtCurr,
    statusBadge, typeChip,
  };
})();
