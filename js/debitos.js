/* ============================================================
   DebitHub — Debits & Payments Module
   ============================================================ */

window.DH = window.DH || {};

DH.debitos = (() => {
  function T(k) { return DH.i18n.t(k); }

  // Sentinel value for "pay the total debt with this creditor" — not a real
  // debit id, handled specially in savePayment() by splitting the amount
  // across every open debit instead of writing to just one.
  const ALL_DEBTS_VALUE = '__all__';

  /* ════════════════════════════
     NEW DEBIT MODAL
  ════════════════════════════ */
  function openNewDebitModal(preselectedCreditorId, opts) {
    const overlay = document.getElementById('debit-modal-overlay');
    if (!overlay) return;

    // A debit always belongs to a creditor — with none registered yet, the
    // modal would just open on a dead-end empty dropdown. Redirect straight
    // to "novo credor" instead so it's obvious what to do first. The guided
    // tour opts out of this (skipGuard) since it's only showing the form,
    // not expecting the user to actually save anything through it.
    if (!(opts && opts.skipGuard) && !DH.data.credores.getAll(DH.state.currentUser?.id).length) {
      DH.ui.showToast(T('toast_need_credor_first'), 'warning');
      DH.credores.openNewModal();
      return;
    }

    document.getElementById('debit-modal-title').textContent = T('modal_new_debit');
    document.getElementById('debit-form').reset();
    document.getElementById('debit-id').value = '';
    document.getElementById('debit-amount').value = '';
    DH.dateField.setISO(document.getElementById('debit-date'), DH.dates.today());
    clearDebitErrors();
    populateCreditorSelect('debit-creditor', preselectedCreditorId);
    handleTypeChange();
    DH.ui.openModal('debit-modal-overlay');
  }

  /* ════════════════════════════
     EDIT DEBIT MODAL
  ════════════════════════════ */
  function openEditDebitModal(debitId) {
    const debit = DH.data.debitos.getById(debitId);
    if (!debit) return;

    document.getElementById('debit-modal-title').textContent = T('modal_edit_debit');
    document.getElementById('debit-id').value          = debitId;
    document.getElementById('debit-description').value = debit.description;
    DH.dateField.setISO(document.getElementById('debit-date'), debit.date);
    DH.moneyField.setValue(document.getElementById('debit-amount'), debit.amount);
    document.getElementById('debit-currency').value    = debit.currency || 'BRL';
    document.getElementById('debit-category').value    = debit.category || '';
    document.getElementById('debit-type').value        = debit.type;
    clearDebitErrors();
    populateCreditorSelect('debit-creditor', debit.creditorId);
    handleTypeChange();

    if (debit.type === 'installment') {
      document.getElementById('debit-installments').value = debit.installments;
    }

    DH.ui.openModal('debit-modal-overlay');
  }

  /* ── Populate creditor select ── */
  function populateCreditorSelect(selectId, selectedId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const userId   = DH.state.currentUser?.id;
    const credores = DH.data.credores.getAll(userId);

    sel.innerHTML = `<option value="">${T('debit_select_creditor')}</option>`;
    credores.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      if (c.id === selectedId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  /* ── Populate debit select for payment ──
     Requires a creditor to already be picked — without one there's no way
     to know which creditor's debits to show, so it stays empty/disabled
     rather than dumping every debit from every creditor into one list. */
  function populateDebitSelect(selectId, creditorId, selectedId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;

    if (!creditorId) {
      sel.innerHTML = `<option value="">${T('payment_select_creditor_first')}</option>`;
      sel.disabled = true;
      return;
    }
    sel.disabled = false;

    let debits = DH.data.debitos.getByCreditor(creditorId, DH.state.currentUser?.id).filter(d => d.status !== 'paid');

    sel.innerHTML = `<option value="">${T('payment_select_debit')}</option>`;

    // "Pay the total debt" option — only offered once a specific creditor is
    // picked (it needs to know which debits to split the amount across).
    if (creditorId && debits.length > 0) {
      const totalRemaining = debits.reduce((s, d) => s + Math.max(0, d.amount - DH.data.pagamentos.totalPaidForDebit(d.id)), 0);
      const opt = document.createElement('option');
      opt.value = ALL_DEBTS_VALUE;
      opt.textContent = `${T('payment_option_all_debts')} — ${DH.currency.format(totalRemaining, debits[0].currency)}`;
      if (selectedId === ALL_DEBTS_VALUE) opt.selected = true;
      sel.appendChild(opt);
    }

    debits.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.description + ' — ' + DH.currency.format(d.amount, d.currency);
      if (d.id === selectedId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  /* ── Type change handler ── */
  function handleTypeChange() {
    const typeEl = document.getElementById('debit-type');
    const instRow = document.getElementById('installment-row');
    if (!typeEl || !instRow) return;
    const v = typeEl.value;
    instRow.classList.toggle('hidden', v !== 'installment');

    // Auto-calculate installment amount
    if (v === 'installment') {
      const amtEl  = document.getElementById('debit-amount');
      const instEl = document.getElementById('debit-installments');
      const curEl  = document.getElementById('debit-currency');
      const valEl  = document.getElementById('debit-installment-value');
      function recalc() {
        const amt  = amtEl ? DH.moneyField.getValue(amtEl) : 0;
        const inst = parseInt(instEl?.value || 1);
        if (amt > 0 && inst > 0 && valEl) {
          valEl.textContent = DH.currency.format(amt / inst, curEl?.value) + ' / ' + T('installments_label');
        } else if (valEl) { valEl.textContent = ''; }
      }
      amtEl?.removeEventListener('input', recalc);
      instEl?.removeEventListener('input', recalc);
      curEl?.removeEventListener('change', recalc);
      amtEl?.addEventListener('input', recalc);
      instEl?.addEventListener('input', recalc);
      curEl?.addEventListener('change', recalc);
      recalc();
    }
  }

  /* ── Save debit ── */
  async function saveDebit() {
    clearDebitErrors();
    const id          = document.getElementById('debit-id').value;
    const creditorId  = document.getElementById('debit-creditor').value;
    const description = document.getElementById('debit-description').value.trim();
    const date        = DH.dateField.getISO(document.getElementById('debit-date'));
    const amount      = DH.moneyField.getValue(document.getElementById('debit-amount'));
    const currency    = document.getElementById('debit-currency').value;
    const category    = document.getElementById('debit-category').value;
    const type        = document.getElementById('debit-type').value;
    const installments = document.getElementById('debit-installments')?.value || 1;

    let valid = true;
    if (!creditorId)  { showDebitErr('debit-creditor', T('err_required')); valid = false; }
    if (!description) { showDebitErr('debit-description', T('err_required')); valid = false; }
    if (!date)        { showDebitErr('debit-date', T('err_required')); valid = false; }
    if (!amount || amount <= 0) { showDebitErr('debit-amount', T('err_amount_positive')); valid = false; }
    if (type === 'installment' && (!installments || parseInt(installments) < 1)) {
      showDebitErr('debit-installments', T('err_required')); valid = false;
    }
    if (!valid) return;

    const userId = DH.state.currentUser.id;

    if (id) {
      await DH.data.debitos.update(id, { creditorId, description, date, amount, currency, category, type, installments });
      DH.ui.showToast(T('toast_debit_updated'), 'success');
    } else {
      await DH.data.debitos.create(userId, { creditorId, description, date, amount, currency, category, type, installments });
      DH.ui.showToast(T('toast_debit_created'), 'success');
    }

    DH.ui.closeModal('debit-modal-overlay');
    DH.dashboard.renderAll();
    if (DH.dashboard.selectedCreditorId) DH.dashboard.refreshDetail();
  }

  /* ── Delete debit ── */
  function deleteDebit(debitId) {
    DH.ui.confirm(T('debit_delete_confirm'), async () => {
      await DH.data.debitos.delete(debitId);
      DH.ui.showToast(T('toast_debit_deleted'), 'info');
      DH.dashboard.renderAll();
      if (DH.dashboard.selectedCreditorId) DH.dashboard.refreshDetail();
    });
  }

  /* ════════════════════════════
     PAYMENT MODAL
  ════════════════════════════ */
  function openPaymentModal(preselectedCreditorId, opts) {
    const overlay = document.getElementById('payment-modal-overlay');
    if (!overlay) return;

    if (!(opts && opts.skipGuard) && !DH.data.credores.getAll(DH.state.currentUser?.id).length) {
      DH.ui.showToast(T('toast_need_credor_first'), 'warning');
      DH.credores.openNewModal();
      return;
    }

    document.getElementById('payment-form').reset();
    document.getElementById('payment-id').value = '';
    document.getElementById('payment-is-general').value = '';
    document.getElementById('payment-amount').value = '';
    document.getElementById('payment-modal-title').textContent = T('modal_new_payment');
    setFieldsDisabled(false);
    DH.dateField.setISO(document.getElementById('payment-date'), DH.dates.today());
    clearPaymentErrors();

    populateCreditorSelect('payment-creditor', preselectedCreditorId);

    // When creditor changes, update debit list
    const credSel = document.getElementById('payment-creditor');
    if (credSel) {
      const updateDebits = () => {
        const cid = credSel.value;
        populateDebitSelect('payment-debit', cid || null, null);
        setupDebitRemainingHint();
      };
      credSel.onchange = updateDebits;
      updateDebits();
    }

    DH.ui.openModal('payment-modal-overlay');
  }

  function setFieldsDisabled(disabled) {
    ['payment-creditor', 'payment-debit'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  }

  /* Shows how much is still owed on the selected debit — it never pre-fills
     Valor Pago, so the admin/user always types the actual amount they got. */
  function setupDebitRemainingHint() {
    const debitSel = document.getElementById('payment-debit');
    const hint = document.getElementById('payment-remaining-hint');
    if (!debitSel) return;
    const updateHint = () => {
      const debitId = debitSel.value;
      if (!hint) return;
      if (!debitId) { hint.textContent = ''; return; }
      if (debitId === ALL_DEBTS_VALUE) {
        const creditorId = document.getElementById('payment-creditor')?.value;
        const openDebits = DH.data.debitos.getByCreditor(creditorId, DH.state.currentUser?.id).filter(d => d.status !== 'paid');
        if (!openDebits.length) { hint.textContent = ''; return; }
        const totalRemaining = openDebits.reduce((s, d) => s + Math.max(0, d.amount - DH.data.pagamentos.totalPaidForDebit(d.id)), 0);
        hint.textContent = `${T('payment_remaining_hint')}: ${DH.currency.format(totalRemaining, openDebits[0].currency)} (${openDebits.length} ${T('label_active_debits')})`;
        return;
      }
      const debit = DH.data.debitos.getById(debitId);
      if (!debit) { hint.textContent = ''; return; }
      const paid = DH.data.pagamentos.totalPaidForDebit(debitId);
      const rem  = Math.max(0, debit.amount - paid);
      hint.textContent = `${T('debit_total')}: ${DH.currency.format(debit.amount, debit.currency)} · ${T('payment_remaining_hint')}: ${DH.currency.format(rem, debit.currency)}`;
    };
    debitSel.onchange = updateHint;
    updateHint();
  }

  /* ════════════════════════════
     EDIT PAYMENT MODAL
     Only the amount, date and note may be changed — the debt it's
     attached to stays fixed, so status recalculation stays simple.
  ════════════════════════════ */
  function openEditPaymentModal(paymentId) {
    const all = DH.data.pagamentos.getAll(DH.state.currentUser?.id);
    const p = all.find(x => x.id === paymentId);
    if (!p) return;

    const overlay = document.getElementById('payment-modal-overlay');
    if (!overlay) return;

    document.getElementById('payment-form').reset();
    document.getElementById('payment-id').value = paymentId;
    document.getElementById('payment-is-general').value = DH.data.paymentTag.isGeneral(p.note) ? '1' : '';
    document.getElementById('payment-modal-title').textContent = T('modal_edit_payment');
    clearPaymentErrors();

    populateCreditorSelect('payment-creditor', p.creditorId);
    populateDebitSelect('payment-debit', p.creditorId, p.debitId);
    setFieldsDisabled(true);
    setupDebitRemainingHint();

    DH.moneyField.setValue(document.getElementById('payment-amount'), p.amount);
    DH.dateField.setISO(document.getElementById('payment-date'), p.date);
    document.getElementById('payment-note').value = DH.data.paymentTag.strip(p.note);

    DH.ui.openModal('payment-modal-overlay');
  }

  function deletePayment(paymentId) {
    DH.ui.confirm(T('payment_delete_confirm'), async () => {
      await DH.data.pagamentos.delete(paymentId);
      DH.ui.showToast(T('toast_payment_deleted'), 'info');
      DH.dashboard.renderAll();
      if (DH.dashboard.selectedCreditorId) DH.dashboard.refreshDetail();
    });
  }

  /* ── Save payment (create or update) ── */
  async function savePayment() {
    clearPaymentErrors();
    const id         = document.getElementById('payment-id').value;
    const creditorId = document.getElementById('payment-creditor').value;
    const debitId    = document.getElementById('payment-debit').value;
    const amount     = DH.moneyField.getValue(document.getElementById('payment-amount'));
    const date       = DH.dateField.getISO(document.getElementById('payment-date'));
    const note       = document.getElementById('payment-note').value;

    let valid = true;
    if (!creditorId) { showPaymentErr('payment-creditor', T('err_required')); valid = false; }
    if (!debitId)    { showPaymentErr('payment-debit', T('err_required')); valid = false; }
    if (!amount || amount <= 0) { showPaymentErr('payment-amount', T('err_amount_positive')); valid = false; }
    if (!date) { showPaymentErr('payment-date', T('err_required')); valid = false; }
    if (!valid) return;

    const userId = DH.state.currentUser.id;

    if (id) {
      const isGeneral = document.getElementById('payment-is-general').value === '1';
      const finalNote = isGeneral ? DH.data.paymentTag.tag(note) : note;
      await DH.data.pagamentos.update(id, { amount, date, note: finalNote });
      DH.ui.showToast(T('toast_payment_updated'), 'success');
    } else if (debitId === ALL_DEBTS_VALUE) {
      // Split the lump sum across this creditor's open debits, oldest first —
      // the payments table always ties a payment to one specific debit, so
      // "pay the total" becomes several individual payments under the hood,
      // each tagged so the history shows "Débito Geral" instead of reading
      // as a payment toward whichever debit it happened to land on.
      const openDebits = DH.data.debitos.getByCreditor(creditorId, userId)
        .filter(d => d.status !== 'paid')
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      const totalRemaining = openDebits.reduce((s, d) => s + Math.max(0, d.amount - DH.data.pagamentos.totalPaidForDebit(d.id)), 0);
      if (amount > totalRemaining + 0.01) {
        showPaymentErr('payment-amount', T('err_amount_exceeds_total'));
        return;
      }
      const taggedNote = DH.data.paymentTag.tag(note);
      let left = amount;
      for (const d of openDebits) {
        if (left <= 0) break;
        const rem = Math.max(0, d.amount - DH.data.pagamentos.totalPaidForDebit(d.id));
        if (rem <= 0) continue;
        const chunk = Math.min(rem, left);
        await DH.data.pagamentos.create(userId, { creditorId, debitId: d.id, amount: chunk, date, note: taggedNote });
        left -= chunk;
      }
      DH.ui.showToast(T('toast_payment_created'), 'success');
    } else {
      await DH.data.pagamentos.create(userId, { creditorId, debitId, amount, date, note });
      DH.ui.showToast(T('toast_payment_created'), 'success');
    }
    DH.ui.closeModal('payment-modal-overlay');
    DH.dashboard.renderAll();
    if (DH.dashboard.selectedCreditorId) DH.dashboard.refreshDetail();
  }

  /* ── Error helpers ── */
  function showDebitErr(id, msg) {
    const el = document.getElementById(id + '-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
    const inp = document.getElementById(id);
    if (inp) inp.style.borderColor = 'var(--danger)';
  }
  function clearDebitErrors() {
    ['debit-creditor','debit-description','debit-date','debit-amount','debit-installments'].forEach(id => {
      const el = document.getElementById(id + '-error');
      if (el) { el.textContent = ''; el.classList.add('hidden'); }
      const inp = document.getElementById(id);
      if (inp) inp.style.borderColor = '';
    });
  }
  function showPaymentErr(id, msg) {
    const el = document.getElementById(id + '-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
    const inp = document.getElementById(id);
    if (inp) inp.style.borderColor = 'var(--danger)';
  }
  function clearPaymentErrors() {
    ['payment-creditor','payment-debit','payment-amount','payment-date'].forEach(id => {
      const el = document.getElementById(id + '-error');
      if (el) { el.textContent = ''; el.classList.add('hidden'); }
      const inp = document.getElementById(id);
      if (inp) inp.style.borderColor = '';
    });
  }

  /* ── Init ── */
  function init() {
    DH.dateField.mount();
    DH.moneyField.mount();

    // Debit form submit
    const debitForm = document.getElementById('debit-form');
    if (debitForm) DH.ui.onSubmitOnce(debitForm, saveDebit);
    // Payment form submit
    const paymentForm = document.getElementById('payment-form');
    if (paymentForm) DH.ui.onSubmitOnce(paymentForm, savePayment);
    // Type change
    const typeEl = document.getElementById('debit-type');
    if (typeEl) typeEl.addEventListener('change', handleTypeChange);
  }

  return {
    openNewDebitModal,
    openEditDebitModal,
    openPaymentModal,
    openEditPaymentModal,
    saveDebit,
    savePayment,
    deleteDebit,
    deletePayment,
    handleTypeChange,
    init,
  };
})();
