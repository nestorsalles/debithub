/* ============================================================
   DebitHub — Credores Module
   CRUD modals for creditors
   ============================================================ */

window.DH = window.DH || {};

DH.credores = (() => {
  function T(k) { return DH.i18n.t(k); }

  /* ── Populate shared state <select> + city <datalist> from existing data ── */
  function populateStateSelect(selectedUf) {
    const sel = document.getElementById('credor-state');
    if (!sel) return;
    sel.innerHTML = `<option value="">${T('select_state_placeholder')}</option>` + DH.geo.states().map(s =>
      `<option value="${s.uf}">${s.uf} — ${s.name}</option>`
    ).join('');
    if (selectedUf) sel.value = selectedUf;
    sel.onchange = () => updateCityForState(sel.value);
    updateCityForState(sel.value);
  }

  /* City suggestions only appear once a state has been chosen, scoped to that state. */
  function updateCityForState(uf) {
    const list = document.getElementById('city-datalist');
    if (list) list.innerHTML = DH.data.distinctCitiesForState(uf).map(c => `<option value="${c}"></option>`).join('');
    const cityInput = document.getElementById('credor-city');
    if (!cityInput) return;
    cityInput.disabled = !uf;
    cityInput.placeholder = uf ? 'Ex: Fortaleza' : T('city_select_state_first');
  }

  /* ── Open New Credor Modal ── */
  function openNewModal() {
    const modal = document.getElementById('credor-modal-overlay');
    if (!modal) return;
    // Reset form
    document.getElementById('credor-modal-title').textContent = T('modal_new_credor');
    document.getElementById('credor-form').reset();
    document.getElementById('credor-id').value = '';
    populateStateSelect();
    clearErrors();
    DH.ui.openModal('credor-modal-overlay');
  }

  /* ── Open Edit Credor Modal ── */
  function openEditModal(creditorId) {
    const credor = DH.data.credores.getById(creditorId);
    if (!credor) return;

    document.getElementById('credor-modal-title').textContent = T('modal_edit_credor');
    document.getElementById('credor-id').value     = creditorId;
    document.getElementById('credor-name').value   = credor.name;
    populateStateSelect(credor.state);
    document.getElementById('credor-city').value   = credor.city;
    document.getElementById('credor-phone').value  = credor.phone;
    clearErrors();
    DH.ui.openModal('credor-modal-overlay');
  }

  /* ── Save (create or update) ── */
  async function saveCredor() {
    clearErrors();
    const id    = document.getElementById('credor-id').value;
    const name  = document.getElementById('credor-name').value.trim();
    const city  = document.getElementById('credor-city').value.trim();
    const state = document.getElementById('credor-state').value.trim();
    const phone = document.getElementById('credor-phone').value.trim();

    if (!name)  { showErr('credor-name', T('err_required')); return; }
    if (!city)  { showErr('credor-city', T('err_required')); return; }
    if (!state) { showErr('credor-state', T('err_required')); return; }

    const userId = DH.state.currentUser.id;

    if (id) {
      await DH.data.credores.update(id, { name, city, state, phone });
      DH.ui.showToast(T('toast_credor_updated'), 'success');
    } else {
      await DH.data.credores.create(userId, { name, city, state, phone });
      DH.ui.showToast(T('toast_credor_created'), 'success');
    }

    DH.ui.closeModal('credor-modal-overlay');
    DH.dashboard.renderAll();
    // Refresh detail panel if open
    if (DH.dashboard.selectedCreditorId) DH.dashboard.refreshDetail();
  }

  /* ── Delete ── */
  function deleteCredor(creditorId) {
    DH.ui.confirm(T('credor_delete_confirm'), async () => {
      await DH.data.credores.delete(creditorId);
      DH.ui.showToast(T('toast_credor_deleted'), 'info');
      DH.dashboard.closeDetail();
      DH.dashboard.renderAll();
    });
  }

  /* ── Error helpers ── */
  function showErr(id, msg) {
    const el = document.getElementById(id + '-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
    const inp = document.getElementById(id);
    if (inp) inp.style.borderColor = 'var(--danger)';
  }
  function clearErrors() {
    ['credor-name','credor-city','credor-state'].forEach(id => {
      const el = document.getElementById(id + '-error');
      if (el) { el.textContent = ''; el.classList.add('hidden'); }
      const inp = document.getElementById(id);
      if (inp) inp.style.borderColor = '';
    });
  }

  /* ── Init form listeners ── */
  function init() {
    const form = document.getElementById('credor-form');
    if (!form) return;

    form.addEventListener('submit', e => { e.preventDefault(); saveCredor(); });
    form.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveCredor(); } });

    // Phone mask
    const phoneInput = document.getElementById('credor-phone');
    if (phoneInput) {
      phoneInput.addEventListener('input', () => {
        let v = phoneInput.value.replace(/\D/g, '');
        if (v.length <= 10) {
          v = v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
        } else {
          v = v.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
        }
        phoneInput.value = v;
      });
    }
  }

  return { openNewModal, openEditModal, saveCredor, deleteCredor, init };
})();
