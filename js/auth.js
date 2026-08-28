/* ============================================================
   DebitHub — Authentication Module
   Handles: login, register, forgot password (by e-mail), change password
   ============================================================ */

window.DH = window.DH || {};

DH.auth = (() => {
  const toast = (msg, type) => DH.ui.showToast(msg, type);

  /* ── Validation ── */
  function validateEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function showError(inputId, msg) {
    const el = document.getElementById(inputId + '-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
    const inp = document.getElementById(inputId);
    if (inp) inp.style.borderColor = 'var(--danger)';
  }
  function clearError(inputId) {
    const el = document.getElementById(inputId + '-error');
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
    const inp = document.getElementById(inputId);
    if (inp) inp.style.borderColor = '';
  }
  function clearAllErrors() {
    document.querySelectorAll('.form-error').forEach(e => { e.textContent = ''; e.classList.add('hidden'); });
    document.querySelectorAll('.form-input, .form-select').forEach(e => e.style.borderColor = '');
  }

  /* ── Password strength ── */
  function checkPasswordStrength(pwd) {
    let score = 0;
    if (pwd.length >= 6) score++;
    if (pwd.length >= 10) score++;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd) && /[^a-zA-Z0-9]/.test(pwd)) score++;
    return score;
  }

  function updateStrengthBar(inputId, barId, textId) {
    const inp = document.getElementById(inputId);
    const bar = document.getElementById(barId);
    const txt = document.getElementById(textId);
    if (!inp || !bar || !txt) return;
    inp.addEventListener('input', () => {
      const score = checkPasswordStrength(inp.value);
      bar.className = 'password-strength-fill strength-' + score;
      const labels = ['', 'password_strength_1', 'password_strength_2', 'password_strength_3', 'password_strength_4'];
      txt.textContent = score > 0 ? DH.i18n.t(labels[score]) : '';
    });
  }

  /* ── Toggle password visibility ── */
  function initPasswordToggles() {
    document.querySelectorAll('[data-password-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-password-toggle');
        const inp = document.getElementById(targetId);
        if (!inp) return;
        if (inp.type === 'password') {
          inp.type = 'text';
          btn.setAttribute('data-icon', 'eye-off');
        } else {
          inp.type = 'password';
          btn.setAttribute('data-icon', 'eye');
        }
        btn.removeAttribute('data-icon-mounted');
        DH.icons.mount(btn);
        btn.classList.remove('icon-toggle-animate');
        void btn.offsetWidth;
        btn.classList.add('icon-toggle-animate');
      });
    });
  }

  /* ════════════════════════════════
     SANFONA (accordion) tabs
  ════════════════════════════════ */
  function initTabs() {
    const headers = document.querySelectorAll('.tab-header');
    if (!headers.length) return;
    const container = document.querySelector('.login-card') || document.body;

    // A single delegated listener (bound once, guarded) instead of one per header —
    // this can't silently double-bind if initTabs() is ever invoked more than once.
    if (!container.dataset.tabsBound) {
      container.dataset.tabsBound = '1';
      container.addEventListener('click', e => {
        const header = e.target.closest('.tab-header');
        if (!header) return;
        const isActive = header.classList.contains('active');
        document.querySelectorAll('.tab-header').forEach(h => h.classList.remove('active'));
        document.querySelectorAll('.tab-body').forEach(b => b.classList.remove('open'));
        if (!isActive) {
          header.classList.add('active');
          const body = header.nextElementSibling;
          if (body && body.classList.contains('tab-body')) body.classList.add('open');
        }
      });
    }

    // Deterministic initial state: Register only when the page was opened with
    // #register, Login otherwise — idempotent, safe to (re)run.
    document.querySelectorAll('.tab-header').forEach(h => h.classList.remove('active'));
    document.querySelectorAll('.tab-body').forEach(b => b.classList.remove('open'));
    const wantRegister = window.location.hash === '#register';
    const target = (wantRegister && document.getElementById('register-tab-header')) || headers[0];
    target.classList.add('active');
    const body = target.nextElementSibling;
    if (body && body.classList.contains('tab-body')) body.classList.add('open');
  }

  /* ════════════════════════════════
     LOGIN
  ════════════════════════════════ */
  function initLoginForm() {
    const form = document.getElementById('login-form');
    if (!form) return;
    DH.ui.onSubmitOnce(form, handleLogin);
  }

  async function handleLogin(e) {
    e.preventDefault();
    clearAllErrors();
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    let valid = true;
    if (!email) { showError('login-email', DH.i18n.t('err_required')); valid = false; }
    else if (!validateEmail(email)) { showError('login-email', DH.i18n.t('err_email_invalid')); valid = false; }
    if (!password) { showError('login-password', DH.i18n.t('err_required')); valid = false; }
    if (!valid) return;

    const submitBtn = document.getElementById('btn-login');
    if (submitBtn) submitBtn.disabled = true;
    let result;
    try {
      result = await DH.data.users.authenticate(email, password);
    } catch {
      result = { error: 'err_generic' };
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }

    if (result.error) {
      if (result.error === 'err_account_suspended') showError('login-email', DH.i18n.t(result.error));
      else showError('login-password', DH.i18n.t(result.error === 'err_generic' ? 'err_generic' : 'err_login_generic'));
      return;
    }

    toast(DH.i18n.t('toast_login_success'), 'success');
    const dest = result.user.role === 'admin' ? 'admin.html' : 'dashboard.html';
    setTimeout(() => { window.location.href = dest; }, 600);
  }

  /* ════════════════════════════════
     REGISTER
  ════════════════════════════════ */
  const PERIOD_KEYS = { monthly: 'plan_period_monthly', quarterly: 'plan_period_quarterly', semiannual: 'plan_period_semiannual', annual: 'plan_period_annual', unlimited: 'plan_period_unlimited' };

  function populatePlanSelect() {
    const sel = document.getElementById('reg-plan');
    if (!sel) return;
    const current = sel.value;
    const plans = DH.data.plans.getAllActive();
    sel.innerHTML = `<option value="">${DH.i18n.t('select_plan_placeholder')}</option>` + plans.map(p =>
      `<option value="${p.id}">${p.name}</option>`
    ).join('');
    if (plans.some(p => p.id === current)) sel.value = current;
    updatePlanPriceHint();
  }

  function updatePlanPriceHint() {
    const sel    = document.getElementById('reg-plan');
    const curSel = document.getElementById('reg-currency');
    const hint   = document.getElementById('reg-plan-price-hint');
    if (!sel || !curSel || !hint) return;
    const plan = DH.data.plans.getById(sel.value);
    if (!plan) { hint.textContent = ''; return; }
    const price = DH.data.plans.priceFor(plan, curSel.value);
    hint.textContent = `${plan.name}: ${DH.currency.format(price, curSel.value)}${DH.i18n.t(PERIOD_KEYS[plan.period] || 'plan_period_monthly')}`;
  }

  function populateCountrySelect() {
    const sel = document.getElementById('reg-country');
    if (!sel) return;
    const lang = DH.state.language || 'pt';
    const current = sel.value || 'BR';
    sel.innerHTML = DH.geo.countries(lang).map(c => `<option value="${c.code}">${c.name}</option>`).join('');
    sel.value = current;
    if (sel.value !== current) sel.value = 'BR';
  }

  function populateStateField(selectedValue) {
    const wrap = document.getElementById('reg-state-wrap');
    const country = document.getElementById('reg-country')?.value || 'BR';
    if (!wrap) return;
    if (country === 'BR') {
      wrap.innerHTML = `
        <label class="form-label" for="reg-state"><span data-i18n="credor_state">Estado</span> <span class="req-mark">*</span></label>
        <select class="form-select" id="reg-state" required></select>
        <span class="form-error hidden" id="reg-state-error"></span>`;
      const sel = document.getElementById('reg-state');
      sel.innerHTML = `<option value="">${DH.i18n.t('select_state_placeholder')}</option>` +
        DH.geo.states().map(s => `<option value="${s.uf}">${s.uf} — ${s.name}</option>`).join('');
      if (selectedValue) sel.value = selectedValue;
      sel.addEventListener('change', () => updateCityForState(sel.value));
      updateCityForState(sel.value);
    } else {
      wrap.innerHTML = `
        <label class="form-label" for="reg-state"><span data-i18n="credor_state">Estado</span> <span class="req-mark">*</span></label>
        <input type="text" class="form-input" id="reg-state" required>
        <span class="form-error hidden" id="reg-state-error"></span>`;
      if (selectedValue) document.getElementById('reg-state').value = selectedValue;
      enableCityField(true);
      populateCityDatalist();
    }
    DH.i18n.applyTranslations();
  }

  function enableCityField(enabled) {
    const cityInput = document.getElementById('reg-city');
    if (!cityInput) return;
    cityInput.disabled = !enabled;
    cityInput.placeholder = enabled ? '' : DH.i18n.t('city_select_state_first');
    if (!enabled) cityInput.value = '';
  }

  function updateCityForState(uf) {
    const list = document.getElementById('city-datalist');
    if (list) list.innerHTML = DH.data.distinctCitiesForState(uf).map(c => `<option value="${c}"></option>`).join('');
    enableCityField(!!uf);
  }

  function updateDocumentLabel() {
    const country = document.getElementById('reg-country')?.value || 'BR';
    const label   = document.getElementById('reg-cpf-label');
    const input   = document.getElementById('reg-cpf');
    if (!label || !input) return;
    const isBR = country === 'BR';
    label.setAttribute('data-i18n', isBR ? 'field_cpf' : 'field_id_number');
    label.textContent = DH.i18n.t(isBR ? 'field_cpf' : 'field_id_number');
    input.placeholder = isBR ? '000.000.000-00' : 'ID Number';
    input.value = '';
  }

  function populateCityDatalist() {
    const list = document.getElementById('city-datalist');
    if (list) list.innerHTML = DH.data.distinctCities().map(c => `<option value="${c}"></option>`).join('');
  }

  function initRegisterForm() {
    const form = document.getElementById('register-form');
    if (!form) return;

    DH.ui.onSubmitOnce(form, handleRegister);

    populateCountrySelect();
    populateStateField();
    updateDocumentLabel();
    populatePlanSelect();
    updateStrengthBar('reg-password', 'reg-strength-bar', 'reg-strength-text');

    const countrySel = document.getElementById('reg-country');
    if (countrySel) {
      countrySel.addEventListener('change', () => {
        populateStateField();
        updateDocumentLabel();
      });
    }

    const planSel = document.getElementById('reg-plan');
    const currencySel = document.getElementById('reg-currency');
    if (planSel) planSel.addEventListener('change', updatePlanPriceHint);
    if (currencySel) currencySel.addEventListener('change', updatePlanPriceHint);

    const requestedPlan = new URLSearchParams(window.location.search).get('plan');
    if (requestedPlan && planSel) {
      const match = DH.data.plans.getAllActive().find(p => p.name.toLowerCase() === requestedPlan.toLowerCase());
      if (match) { planSel.value = match.id; updatePlanPriceHint(); }
    }

    const phoneInput = document.getElementById('reg-phone');
    if (phoneInput) {
      phoneInput.addEventListener('input', () => {
        let v = phoneInput.value.replace(/\D/g, '');
        if (v.length <= 10) v = v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
        else v = v.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
        phoneInput.value = v;
      });
    }

    const cpfInput = document.getElementById('reg-cpf');
    if (cpfInput) {
      cpfInput.addEventListener('input', () => {
        if ((document.getElementById('reg-country')?.value || 'BR') !== 'BR') return;
        let v = cpfInput.value.replace(/\D/g, '').slice(0, 11);
        v = v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        cpfInput.value = v;
      });
    }
  }

  const REGISTER_ERROR_FIELD = {
    err_email_taken: 'reg-email',
    err_required: 'reg-security-code',
    err_required_phone: 'reg-phone',
    err_cpf_invalid: 'reg-cpf',
    err_required_document: 'reg-cpf',
    err_required_city: 'reg-city',
    err_required_state: 'reg-state',
    err_required_plan: 'reg-plan',
    err_required_method: 'reg-payment-method',
  };

  async function handleRegister(e) {
    e.preventDefault();
    clearAllErrors();
    const name          = document.getElementById('reg-name').value.trim();
    const country       = document.getElementById('reg-country').value || 'BR';
    const phone         = document.getElementById('reg-phone').value.trim();
    const cpf           = document.getElementById('reg-cpf').value.trim();
    const city          = document.getElementById('reg-city').value.trim();
    const state         = document.getElementById('reg-state').value.trim();
    const planId        = document.getElementById('reg-plan').value;
    const currency      = document.getElementById('reg-currency').value || 'BRL';
    const paymentMethod = document.getElementById('reg-payment-method').value;
    const email         = document.getElementById('reg-email').value.trim();
    const password      = document.getElementById('reg-password').value;
    const confirmPwd    = document.getElementById('reg-confirm-password').value;
    const securityCode  = document.getElementById('reg-security-code').value.trim();
    const isBR          = country === 'BR';

    let valid = true;
    if (!name)         { showError('reg-name', DH.i18n.t('err_required')); valid = false; }
    if (!phone)        { showError('reg-phone', DH.i18n.t('err_required')); valid = false; }
    if (!cpf)          { showError('reg-cpf', DH.i18n.t(isBR ? 'err_required' : 'err_required_document')); valid = false; }
    else if (isBR && !DH.data.isValidCPF(cpf)) { showError('reg-cpf', DH.i18n.t('err_cpf_invalid')); valid = false; }
    if (!city)         { showError('reg-city', DH.i18n.t('err_required')); valid = false; }
    if (!state)        { showError('reg-state', DH.i18n.t('err_required')); valid = false; }
    if (!planId)        { showError('reg-plan', DH.i18n.t('err_required_plan')); valid = false; }
    if (!paymentMethod) { showError('reg-payment-method', DH.i18n.t('err_required_method')); valid = false; }
    if (!email)        { showError('reg-email', DH.i18n.t('err_required')); valid = false; }
    else if (!validateEmail(email)) { showError('reg-email', DH.i18n.t('err_email_invalid')); valid = false; }
    if (!password)     { showError('reg-password', DH.i18n.t('err_required')); valid = false; }
    else if (password.length < 6) { showError('reg-password', DH.i18n.t('err_password_min')); valid = false; }
    if (password !== confirmPwd)  { showError('reg-confirm-password', DH.i18n.t('err_passwords_match')); valid = false; }
    if (!securityCode) { showError('reg-security-code', DH.i18n.t('err_required')); valid = false; }
    if (!valid) return;

    const submitBtn = document.getElementById('btn-register');
    if (submitBtn) submitBtn.disabled = true;
    let result;
    try {
      result = await DH.data.users.create({ name, email, password, securityCode, phone, cpf, country, city, state, planId, paymentMethod, currency });
    } catch {
      result = { error: 'err_generic' };
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }

    if (result.error) {
      showError(REGISTER_ERROR_FIELD[result.error] || 'reg-email', DH.i18n.t(result.error) || DH.i18n.t('err_generic'));
      return;
    }

    toast(DH.i18n.t('toast_register_success'), 'success');
    setTimeout(() => { window.location.href = 'dashboard.html'; }, 700);
  }

  /* ════════════════════════════════
     FORGOT PASSWORD (security code, no e-mail needed)
  ════════════════════════════════ */
  function initForgotPassword() {
    const link    = document.getElementById('forgot-link');
    const overlay = document.getElementById('forgot-modal');
    const closeBtn = document.getElementById('forgot-close');
    const form    = document.getElementById('forgot-form');
    if (!link || !overlay || !form) return;

    link.addEventListener('click', () => openForgotModal());
    if (closeBtn) closeBtn.addEventListener('click', closeForgotModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeForgotModal(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeForgotModal();
    });

    DH.ui.onSubmitOnce(form, handleForgotPassword);
    updateStrengthBar('forgot-new-password', 'forgot-strength-bar', 'forgot-strength-text');
  }

  function openForgotModal() {
    const overlay = document.getElementById('forgot-modal');
    if (overlay) { overlay.classList.add('open'); clearAllErrors(); }
  }
  function closeForgotModal() {
    const overlay = document.getElementById('forgot-modal');
    if (overlay) { overlay.classList.remove('open'); clearAllErrors(); }
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    clearAllErrors();
    const email        = document.getElementById('forgot-email').value.trim();
    const securityCode = document.getElementById('forgot-security-code').value.trim();
    const newPassword  = document.getElementById('forgot-new-password').value;

    let valid = true;
    if (!email) { showError('forgot-email', DH.i18n.t('err_required')); valid = false; }
    else if (!validateEmail(email)) { showError('forgot-email', DH.i18n.t('err_email_invalid')); valid = false; }
    if (!securityCode) { showError('forgot-security-code', DH.i18n.t('err_required')); valid = false; }
    if (!newPassword) { showError('forgot-new-password', DH.i18n.t('err_required')); valid = false; }
    else if (newPassword.length < 6) { showError('forgot-new-password', DH.i18n.t('err_password_min')); valid = false; }
    if (!valid) return;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    let result;
    try {
      result = await DH.data.users.resetPassword(email, securityCode, newPassword);
    } catch {
      result = { error: 'err_generic' };
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }

    if (result.error) {
      if (result.error === 'err_user_not_found') showError('forgot-email', DH.i18n.t(result.error));
      else if (result.error === 'err_security_code_wrong') showError('forgot-security-code', DH.i18n.t(result.error));
      else showError('forgot-new-password', DH.i18n.t('err_generic'));
      return;
    }

    toast(DH.i18n.t('toast_password_reset'), 'success');
    closeForgotModal();
    document.getElementById('forgot-form').reset();
  }

  /* ════════════════════════════════
     CHANGE PASSWORD (dashboard settings)
  ════════════════════════════════ */
  function initChangePassword() {
    const form = document.getElementById('change-password-form');
    if (!form) return;
    DH.ui.onSubmitOnce(form, handleChangePassword);
    updateStrengthBar('change-new-password', 'change-strength-bar', 'change-strength-text');
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    clearAllErrors();
    const current  = document.getElementById('change-current-password').value;
    const newPwd   = document.getElementById('change-new-password').value;
    const confirm  = document.getElementById('change-confirm-password').value;

    let valid = true;
    if (!current) { showError('change-current-password', DH.i18n.t('err_required')); valid = false; }
    if (!newPwd)  { showError('change-new-password', DH.i18n.t('err_required')); valid = false; }
    else if (newPwd.length < 6) { showError('change-new-password', DH.i18n.t('err_password_min')); valid = false; }
    if (newPwd !== confirm) { showError('change-confirm-password', DH.i18n.t('err_passwords_match')); valid = false; }
    if (!valid) return;

    const userId = DH.state.currentUser?.id;
    const result = await DH.data.users.changePassword(userId, current, newPwd);
    if (result.error) { showError('change-current-password', DH.i18n.t(result.error)); return; }

    DH.ui.showToast(DH.i18n.t('toast_password_changed'), 'success');
    e.target.reset();
  }

  /* ── Init ── */
  function init() {
    initTabs();
    initLoginForm();
    initRegisterForm();
    initForgotPassword();
    initPasswordToggles();
  }

  function initDashboard() {
    initChangePassword();
    initPasswordToggles();
  }

  return {
    init,
    initDashboard,
    openForgotModal,
    closeForgotModal,
    populatePlanSelect,
    populateCountrySelect,
    checkPasswordStrength,
    updateStrengthBar,
    initPasswordToggles,
    validateEmail,
    showError,
    clearError,
    clearAllErrors,
    toast,
  };
})();
