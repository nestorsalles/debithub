/* ============================================================
   DebitHub — Data Layer (Supabase-backed, in-memory cache)
   ------------------------------------------------------------
   All accounts, debts and payments now live in a real shared
   Postgres database (Supabase), not the browser's localStorage —
   that's what makes the same login/data work from any device.

   Design: on page load we fetch everything the current user is
   allowed to see ONCE into `DH.cache` (a plain in-memory object).
   Every *read* method below (getAll/getById/...) is still fully
   SYNCHRONOUS, exactly like before — it just reads from `DH.cache`
   instead of `localStorage`, so every existing render function
   keeps working completely unchanged. Only *write* methods
   (create/update/delete/setStatus/...) are `async`, since those
   are the ones that actually need to talk to the network — and
   each one patches `DH.cache` afterwards so the UI can just
   re-render synchronously right after `await`ing the write.
   ============================================================ */

window.DH = window.DH || {};

DH.state = {
  currentUser: null,
  language: 'pt',
  theme: 'dark',
};

DH.cache = {
  profile: null,
  users: [],       // admin only: every non-admin profile
  credores: [],
  debitos: [],
  pagamentos: [],
  billing: [],      // admin only
  plans: [],
};

DH.data = (() => {
  /* ── UUID generator (kept for anything that still wants a client id;
     Postgres generates its own via gen_random_uuid() by default) ── */
  function uuid() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  }

  /* ── Slug generator ── */
  function toSlug(name) {
    return name
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  /* ── CPF validation (real check-digit algorithm) ── */
  function isValidCPF(raw) {
    const cpf = String(raw || '').replace(/\D/g, '');
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;
    const calc = (len) => {
      let sum = 0;
      for (let i = 0; i < len; i++) sum += parseInt(cpf[i], 10) * (len + 1 - i);
      const r = (sum * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return calc(9) === parseInt(cpf[9], 10) && calc(10) === parseInt(cpf[10], 10);
  }
  function formatCPF(raw) {
    const cpf = String(raw || '').replace(/\D/g, '').padEnd(11, ' ').slice(0, 11);
    return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4').trim();
  }

  /* ══════════════════════════════
     Row <-> app-shape mappers
     (DB columns are snake_case; the app's HTML/JS everywhere
     else expects the same camelCase shape it always has)
  ══════════════════════════════ */
  function mapProfile(r) {
    if (!r) return null;
    return {
      id: r.id, email: r.email, name: r.name || '', phone: r.phone || '', cpf: r.cpf || '',
      country: r.country || 'BR', city: r.city || '', state: r.state || '',
      planId: r.plan_id || '', paymentMethod: r.payment_method || '', currency: r.currency || 'BRL',
      role: r.role, status: r.status, pendingSince: r.pending_since, createdAt: r.created_at,
    };
  }
  function mapCredor(r) {
    return { id: r.id, userId: r.user_id, name: r.name, slug: r.slug, publicCode: r.public_code, city: r.city || '', state: r.state || '', phone: r.phone || '', createdAt: r.created_at };
  }
  function mapDebito(r) {
    return {
      id: r.id, userId: r.user_id, creditorId: r.creditor_id, description: r.description, date: r.date,
      amount: Number(r.amount), currency: r.currency || 'BRL', category: r.category || '',
      type: r.type, installments: r.installments, installmentAmount: Number(r.installment_amount),
      status: r.status, createdAt: r.created_at,
    };
  }
  function mapPagamento(r) {
    return { id: r.id, userId: r.user_id, creditorId: r.creditor_id, debitId: r.debit_id, amount: Number(r.amount), date: r.date, note: r.note || '', createdAt: r.created_at };
  }
  function mapBilling(r) {
    return { id: r.id, userId: r.user_id, method: r.method, plan: r.plan || '', amount: Number(r.amount), date: r.date, note: r.note || '', createdAt: r.created_at };
  }
  function mapPlan(r) {
    return { id: r.id, name: r.name, prices: r.prices || { BRL: 0, USD: 0, EUR: 0 }, period: r.period, active: r.active, order: r.order, createdAt: r.created_at };
  }

  function throwIfError(error) { if (error) throw error; }

  /* ══════════════════════════════
     BOOTSTRAP — fetch everything the
     current user is allowed to see, once
  ══════════════════════════════ */
  async function bootstrap() {
    const { data: { session } } = await DH.sb.auth.getSession();
    if (!session) {
      // Not logged in — plans are still needed for the public
      // registration form's plan picker (RLS allows anon read).
      const { data: plansRes } = await DH.sb.from('plans').select('*');
      DH.cache.plans = (plansRes || []).map(mapPlan).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
      return null;
    }

    const { data: profileRow, error: profileErr } = await DH.sb
      .from('profiles').select('*').eq('id', session.user.id).single();
    if (profileErr || !profileRow) return null;

    let profile = mapProfile(profileRow);

    // Lazy 24h pending -> suspended sweep for this user's own login.
    if (profile.status === 'pending' && profile.pendingSince) {
      const ageMs = Date.now() - new Date(profile.pendingSince).getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        await DH.sb.from('profiles').update({ status: 'suspended' }).eq('id', profile.id);
        profile.status = 'suspended';
      }
    }

    DH.cache.profile = profile;

    if (profile.role === 'admin') {
      const [usersRes, credoresRes, debitosRes, pagamentosRes, billingRes, plansRes] = await Promise.all([
        DH.sb.from('profiles').select('*').neq('role', 'admin'),
        DH.sb.from('credores').select('*'),
        DH.sb.from('debitos').select('*'),
        DH.sb.from('pagamentos').select('*'),
        DH.sb.from('billing').select('*'),
        DH.sb.from('plans').select('*'),
      ]);
      DH.cache.users      = (usersRes.data || []).map(mapProfile);
      DH.cache.credores   = (credoresRes.data || []).map(mapCredor);
      DH.cache.debitos    = (debitosRes.data || []).map(mapDebito);
      DH.cache.pagamentos = (pagamentosRes.data || []).map(mapPagamento);
      DH.cache.billing    = (billingRes.data || []).map(mapBilling);
      DH.cache.plans      = (plansRes.data || []).map(mapPlan).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

      // Sweep every other pending account past the 24h grace window.
      const now = Date.now();
      const expiredIds = DH.cache.users
        .filter(u => u.status === 'pending' && u.pendingSince && (now - new Date(u.pendingSince).getTime()) > 24 * 60 * 60 * 1000)
        .map(u => u.id);
      if (expiredIds.length) {
        await DH.sb.from('profiles').update({ status: 'suspended' }).in('id', expiredIds);
        DH.cache.users.forEach(u => { if (expiredIds.includes(u.id)) u.status = 'suspended'; });
      }
    } else {
      const [credoresRes, debitosRes, pagamentosRes, plansRes] = await Promise.all([
        DH.sb.from('credores').select('*').eq('user_id', profile.id),
        DH.sb.from('debitos').select('*').eq('user_id', profile.id),
        DH.sb.from('pagamentos').select('*').eq('user_id', profile.id),
        DH.sb.from('plans').select('*'),
      ]);
      DH.cache.credores   = (credoresRes.data || []).map(mapCredor);
      DH.cache.debitos    = (debitosRes.data || []).map(mapDebito);
      DH.cache.pagamentos = (pagamentosRes.data || []).map(mapPagamento);
      DH.cache.plans      = (plansRes.data || []).map(mapPlan).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    }

    DH.state.currentUser = profile;
    return profile;
  }

  /* ══════════════════════════════
     USERS
  ══════════════════════════════ */
  const users = {
    getAll() { return DH.cache.users; },
    getById(id) { return DH.cache.users.find(u => u.id === id) || (DH.cache.profile?.id === id ? DH.cache.profile : null); },

    async create({ name, email, password, securityCode, phone, cpf, country, city, state, planId, paymentMethod, currency }) {
      const isBR = (country || 'BR') === 'BR';
      if (!securityCode || !securityCode.trim()) return { error: 'err_required' };
      if (!phone || !phone.trim()) return { error: 'err_required_phone' };
      if (isBR) { if (!isValidCPF(cpf)) return { error: 'err_cpf_invalid' }; }
      else { if (!cpf || !String(cpf).trim()) return { error: 'err_required_document' }; }
      if (!city || !city.trim()) return { error: 'err_required_city' };
      if (!state || !state.trim()) return { error: 'err_required_state' };
      if (!planId) return { error: 'err_required_plan' };
      if (!paymentMethod) return { error: 'err_required_method' };

      const { data: signUpData, error } = await DH.sb.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            name: name.trim(), phone: phone.trim(),
            cpf: cpf ? (isBR ? String(cpf).replace(/\D/g, '') : String(cpf).trim()) : '',
            security_code: securityCode.trim().toUpperCase(),
            country: (country || 'BR').toUpperCase(),
            city: city.trim(), state: isBR ? state.trim().toUpperCase() : state.trim(),
            plan_id: planId || '', payment_method: paymentMethod || '', currency: currency || 'BRL',
          },
        },
      });
      if (error) {
        if (/registered|exists/i.test(error.message || '')) return { error: 'err_email_taken' };
        return { error: 'err_generic', detail: error.message };
      }
      if (!signUpData.session) {
        // Shouldn't happen with email-confirmation disabled, but guard anyway.
        return { error: 'err_generic', detail: 'no_session_after_signup' };
      }

      // The on_auth_user_created trigger inserts the profile row; give it a beat.
      let profileRow = null;
      for (let i = 0; i < 6 && !profileRow; i++) {
        const { data } = await DH.sb.from('profiles').select('*').eq('id', signUpData.user.id).maybeSingle();
        if (data) { profileRow = data; break; }
        await new Promise(r => setTimeout(r, 300));
      }
      if (!profileRow) return { error: 'err_generic', detail: 'profile_not_ready' };

      return { user: mapProfile(profileRow) };
    },

    async authenticate(email, password) {
      const { data, error } = await DH.sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) return { error: 'err_wrong_password' };

      const { data: profileRow, error: profileErr } = await DH.sb.from('profiles').select('*').eq('id', data.user.id).single();
      if (profileErr || !profileRow) return { error: 'err_generic' };
      let profile = mapProfile(profileRow);

      if (profile.status === 'pending' && profile.pendingSince) {
        const ageMs = Date.now() - new Date(profile.pendingSince).getTime();
        if (ageMs > 24 * 60 * 60 * 1000) {
          await DH.sb.from('profiles').update({ status: 'suspended' }).eq('id', profile.id);
          profile.status = 'suspended';
        }
      }
      if (profile.role !== 'admin' && profile.status === 'suspended') {
        await DH.sb.auth.signOut();
        return { error: 'err_account_suspended' };
      }
      return { user: profile };
    },

    /* Admin-only edit of a user's account/profile fields. */
    async adminUpdate(userId, { name, phone, cpf, country, city, state, planId, paymentMethod, currency }) {
      const isBR = (country || 'BR') === 'BR';
      const patch = {
        name: name != null ? name.trim() : undefined,
        phone: phone != null ? phone.trim() : undefined,
        cpf: cpf != null ? (isBR ? String(cpf).replace(/\D/g, '') : String(cpf).trim()) : undefined,
        country: country != null ? country.toUpperCase() : undefined,
        city: city != null ? city.trim() : undefined,
        state: state != null ? (isBR ? state.trim().toUpperCase() : state.trim()) : undefined,
        plan_id: planId != null ? (planId || null) : undefined,
        payment_method: paymentMethod != null ? paymentMethod : undefined,
        currency: currency != null ? currency : undefined,
      };
      Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);

      const { data, error } = await DH.sb.from('profiles').update(patch).eq('id', userId).select('*').single();
      if (error) return { error: 'err_generic', detail: error.message };
      const updated = mapProfile(data);
      const idx = DH.cache.users.findIndex(u => u.id === userId);
      if (idx >= 0) DH.cache.users[idx] = updated;
      if (DH.state.currentUser?.id === userId) DH.state.currentUser = updated;
      return { user: updated };
    },

    async updateProfile(userId, fields) { return this.adminUpdate(userId, fields); },

    async delete(userId) {
      const { data: { session } } = await DH.sb.auth.getSession();
      const res = await fetch(DH.functionsUrl('delete-user'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ userId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { error: body.error || 'err_generic' };
      DH.cache.users = DH.cache.users.filter(u => u.id !== userId);
      DH.cache.credores = DH.cache.credores.filter(c => c.userId !== userId);
      DH.cache.debitos = DH.cache.debitos.filter(d => d.userId !== userId);
      DH.cache.pagamentos = DH.cache.pagamentos.filter(p => p.userId !== userId);
      DH.cache.billing = DH.cache.billing.filter(b => b.userId !== userId);
      return { success: true };
    },

    async setStatus(userId, status) {
      const { data, error } = await DH.sb.from('profiles').update({ status }).eq('id', userId).select('*').single();
      if (error) return { error: 'err_generic', detail: error.message };
      const updated = mapProfile(data);
      const idx = DH.cache.users.findIndex(u => u.id === userId);
      if (idx >= 0) DH.cache.users[idx] = updated;
      if (DH.state.currentUser?.id === userId) { DH.state.currentUser.status = status; }
      return { user: updated };
    },

    /* Account list for the admin panel — never includes password.
       Fully synchronous: everything it needs is already in DH.cache
       from bootstrap(), so this reproduces the old join-in-memory
       logic without a single network round trip per row. */
    listForAdmin() {
      return this.getAll().map(u => {
        const credCount    = DH.cache.credores.filter(c => c.userId === u.id).length;
        const debitCount   = DH.cache.debitos.filter(d => d.userId === u.id).length;
        const paymentCount = DH.cache.pagamentos.filter(p => p.userId === u.id).length;
        const latestBill   = billing.latestForUser(u.id);
        const registeredPlan = u.planId ? plans.getById(u.planId) : null;
        const isBR = (u.country || 'BR') === 'BR';
        return {
          id: u.id, name: u.name, email: u.email, createdAt: u.createdAt,
          phone: u.phone || '', cpf: u.cpf ? (isBR ? formatCPF(u.cpf) : u.cpf) : '',
          isBR,
          country: u.country || 'BR',
          city: u.city || '', state: u.state || '',
          currency: u.currency || 'BRL',
          status: u.status || 'active',
          pendingSince: u.pendingSince || '',
          registeredPlanId: u.planId || '',
          registeredPlanName: registeredPlan ? registeredPlan.name : '',
          registeredMethod: u.paymentMethod || '',
          credCount, debitCount, paymentCount,
          plan: latestBill ? latestBill.plan : '',
          method: latestBill ? latestBill.method : '',
          current: billing.isCurrent(u.id),
          lastPaymentDate: latestBill ? latestBill.date : '',
          lastPaymentAmount: latestBill ? latestBill.amount : 0,
        };
      });
    },

    async resetPassword(email, securityCode, newPassword) {
      const res = await fetch(DH.functionsUrl('reset-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, securityCode, newPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { error: body.error || 'err_generic' };
      return { success: true };
    },

    async changePassword(userId, currentPassword, newPassword) {
      const email = DH.state.currentUser?.email;
      const { error: verifyErr } = await DH.sb.auth.signInWithPassword({ email, password: currentPassword });
      if (verifyErr) return { error: 'err_wrong_password' };
      const { error } = await DH.sb.auth.updateUser({ password: newPassword });
      if (error) return { error: 'err_generic', detail: error.message };
      return { success: true };
    },

    async updateName(userId, name) {
      const { data, error } = await DH.sb.from('profiles').update({ name: name.trim() }).eq('id', userId).select('*').single();
      if (error) return { error: 'err_generic', detail: error.message };
      const updated = mapProfile(data);
      if (DH.state.currentUser?.id === userId) DH.state.currentUser.name = updated.name;
      return { user: updated };
    },
  };

  /* ══════════════════════════════
     SESSION
  ══════════════════════════════ */
  const session = {
    get() { return DH.state.currentUser; },
    async clear() { await DH.sb.auth.signOut(); DH.state.currentUser = null; },
  };

  /* ══════════════════════════════
     CREDORES
  ══════════════════════════════ */
  const credores = {
    getAll(userId) { return DH.cache.credores.filter(c => c.userId === userId); },
    getAllPublic() { return DH.cache.credores; },
    getById(id) { return DH.cache.credores.find(c => c.id === id) || null; },

    /* slug is purely cosmetic (readable name in the URL) — it does NOT need to
       be unique. The public link's real identifier is public_code, a number
       Postgres assigns automatically on insert (see schema.sql), which is
       what disambiguates two people both named "João Silva". */
    async create(userId, { name, city, state, phone }) {
      const { data, error } = await DH.sb.from('credores').insert({
        user_id: userId, name: name.trim(), slug: toSlug(name), city: city.trim(), state: state.trim().toUpperCase(), phone: phone.trim(),
      }).select('*').single();
      throwIfError(error);
      const credor = mapCredor(data);
      DH.cache.credores.push(credor);
      return credor;
    },

    async update(id, { name, city, state, phone }) {
      const { data, error } = await DH.sb.from('credores').update({
        name: name.trim(), slug: toSlug(name), city: city.trim(), state: state.trim().toUpperCase(), phone: phone.trim(),
      }).eq('id', id).select('*').single();
      throwIfError(error);
      const updated = mapCredor(data);
      const idx = DH.cache.credores.findIndex(c => c.id === id);
      if (idx >= 0) DH.cache.credores[idx] = updated;
      return updated;
    },

    async delete(id) {
      const { error } = await DH.sb.from('credores').delete().eq('id', id);
      throwIfError(error);
      DH.cache.credores = DH.cache.credores.filter(c => c.id !== id);
      DH.cache.debitos = DH.cache.debitos.filter(d => d.creditorId !== id);
      DH.cache.pagamentos = DH.cache.pagamentos.filter(p => p.creditorId !== id);
    },

    /* Personalized public link: debithub.com.br/credor/<slug>/<public_code>.
       The public page (credor-view.js) resolves ONLY the numeric code live
       against Supabase (get_public_credor) — the slug is just for readability
       and stays valid even if the credor is later renamed. */
    buildShareLink(creditorId) {
      const credor = this.getById(creditorId);
      if (!credor) return null;
      return `${window.location.origin}/credor/${credor.slug}/${credor.publicCode}`;
    },

    /* Fetches one credor's public summary (name/city/state/phone, debtor name,
       debits, payments) by public_code — no auth, callable from the public
       credor page. Returns null if the code doesn't match any credor. */
    async fetchPublicByCode(code) {
      const { data, error } = await DH.sb.rpc('get_public_credor', { p_code: code });
      throwIfError(error);
      return data || null;
    },
  };

  /* ══════════════════════════════
     DEBITOS
  ══════════════════════════════ */
  const debitos = {
    getAll(userId) { return DH.cache.debitos.filter(d => d.userId === userId); },
    getAllPublic() { return DH.cache.debitos; },
    getById(id) { return DH.cache.debitos.find(d => d.id === id) || null; },
    getByCreditor(creditorId, userId) {
      return DH.cache.debitos.filter(d => d.creditorId === creditorId && (userId ? d.userId === userId : true));
    },

    async create(userId, { creditorId, description, date, amount, type, installments, currency, category }) {
      amount = parseFloat(amount);
      installments = parseInt(installments) || 1;
      const installmentAmount = type === 'installment' ? +(amount / installments).toFixed(2) : amount;

      const { data, error } = await DH.sb.from('debitos').insert({
        user_id: userId, creditor_id: creditorId, description: description.trim(), date, amount,
        currency: currency || 'BRL', category: category || '', type,
        installments: type === 'installment' ? installments : (type === 'recurring' ? 0 : 1),
        installment_amount: installmentAmount, status: 'active',
      }).select('*').single();
      throwIfError(error);
      const debit = mapDebito(data);
      DH.cache.debitos.push(debit);
      return debit;
    },

    async update(id, fields) {
      const amount = parseFloat(fields.amount);
      const installments = parseInt(fields.installments) || 1;
      const installmentAmount = fields.type === 'installment' ? +(amount / installments).toFixed(2) : amount;

      const { data, error } = await DH.sb.from('debitos').update({
        description: fields.description.trim(), date: fields.date, amount,
        currency: fields.currency || 'BRL', category: fields.category || '', type: fields.type,
        installments: fields.type === 'installment' ? installments : (fields.type === 'recurring' ? 0 : 1),
        installment_amount: installmentAmount,
      }).eq('id', id).select('*').single();
      throwIfError(error);
      let updated = mapDebito(data);
      updated.status = debitos._computeStatus(updated);
      const idx = DH.cache.debitos.findIndex(d => d.id === id);
      if (idx >= 0) DH.cache.debitos[idx] = updated;
      await this.updateStatus(id);
      return updated;
    },

    async delete(id) {
      const { error } = await DH.sb.from('debitos').delete().eq('id', id);
      throwIfError(error);
      DH.cache.debitos = DH.cache.debitos.filter(d => d.id !== id);
      DH.cache.pagamentos = DH.cache.pagamentos.filter(p => p.debitId !== id);
    },

    /* Recalculate + persist status based on cached payments. */
    async updateStatus(debitId) {
      const debit = this.getById(debitId);
      if (!debit) return;
      const newStatus = this._computeStatus(debit);
      if (newStatus === debit.status) return debit;
      const { data, error } = await DH.sb.from('debitos').update({ status: newStatus }).eq('id', debitId).select('*').single();
      if (error) return debit;
      const updated = mapDebito(data);
      const idx = DH.cache.debitos.findIndex(d => d.id === debitId);
      if (idx >= 0) DH.cache.debitos[idx] = updated;
      return updated;
    },

    _computeStatus(debit) {
      const payments = DH.cache.pagamentos.filter(p => p.debitId === debit.id);
      const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
      if (totalPaid <= 0) return 'active';
      if (totalPaid >= debit.amount) return 'paid';
      return 'partial';
    },
  };

  /* ══════════════════════════════
     PAGAMENTOS
  ══════════════════════════════ */
  const pagamentos = {
    getAll(userId) { return DH.cache.pagamentos.filter(p => p.userId === userId); },
    getAllPublic() { return DH.cache.pagamentos; },
    getByCreditor(creditorId) { return DH.cache.pagamentos.filter(p => p.creditorId === creditorId); },
    getByDebit(debitId) { return DH.cache.pagamentos.filter(p => p.debitId === debitId); },

    async create(userId, { creditorId, debitId, amount, date, note }) {
      amount = parseFloat(amount);
      const { data, error } = await DH.sb.from('pagamentos').insert({
        user_id: userId, creditor_id: creditorId, debit_id: debitId, amount, date, note: (note || '').trim(),
      }).select('*').single();
      throwIfError(error);
      const pag = mapPagamento(data);
      DH.cache.pagamentos.push(pag);
      await debitos.updateStatus(debitId);
      return pag;
    },

    async update(id, { amount, date, note }) {
      const existing = DH.cache.pagamentos.find(p => p.id === id);
      const { data, error } = await DH.sb.from('pagamentos').update({
        amount: parseFloat(amount), date, note: (note || '').trim(),
      }).eq('id', id).select('*').single();
      throwIfError(error);
      const updated = mapPagamento(data);
      const idx = DH.cache.pagamentos.findIndex(p => p.id === id);
      if (idx >= 0) DH.cache.pagamentos[idx] = updated;
      if (existing) await debitos.updateStatus(existing.debitId);
      return updated;
    },

    async delete(id) {
      const pag = DH.cache.pagamentos.find(p => p.id === id);
      const { error } = await DH.sb.from('pagamentos').delete().eq('id', id);
      throwIfError(error);
      DH.cache.pagamentos = DH.cache.pagamentos.filter(p => p.id !== id);
      if (pag) await debitos.updateStatus(pag.debitId);
    },

    totalPaidForDebit(debitId) {
      return DH.cache.pagamentos.filter(p => p.debitId === debitId).reduce((s, p) => s + p.amount, 0);
    },
    totalPaidForCreditor(creditorId) {
      return DH.cache.pagamentos.filter(p => p.creditorId === creditorId).reduce((s, p) => s + p.amount, 0);
    },
  };

  /* "Pay the whole debt" splits one lump payment across several real debits
     (the payments table always ties a row to one debit — there's no separate
     "general payment" concept in the schema). To still show it as one
     recognizable thing in the history — instead of each split chunk reading
     as a payment toward whichever debit it landed on — a marker is tucked
     onto the front of `note` and stripped back off for display. */
  const GENERAL_NOTE_TAG = '##GERAL##';
  const paymentTag = {
    tag(note) { return GENERAL_NOTE_TAG + (note ? ' ' + note : ''); },
    isGeneral(note) { return typeof note === 'string' && note.startsWith(GENERAL_NOTE_TAG); },
    strip(note) { return this.isGeneral(note) ? note.slice(GENERAL_NOTE_TAG.length).trim() : (note || ''); },
  };

  const PLAN_SORT_ORDER = { teste: 0, mensal: 1, trimestral: 2, semestral: 3, anual: 4 };
  function planSortKey(p) {
    if (typeof p.order === 'number') return p.order;
    const key = PLAN_SORT_ORDER[(p.name || '').trim().toLowerCase()];
    return key !== undefined ? key : 99;
  }

  function dominantCurrency(debits) {
    const codes = [...new Set(debits.map(d => d.currency || 'BRL'))];
    return codes.length === 1 ? codes[0] : 'BRL';
  }

  function localDate(dateStr) {
    return new Date(dateStr + (String(dateStr).includes('T') ? '' : 'T00:00:00'));
  }

  /* ══════════════════════════════
     PLATFORM BILLING (admin-only)
  ══════════════════════════════ */
  const billing = {
    getAll() { return DH.cache.billing; },
    getByUser(userId) { return this.getAll().filter(b => b.userId === userId); },

    latestForUser(userId) {
      const list = this.getByUser(userId).sort((a, b) => localDate(b.date) - localDate(a.date));
      return list[0] || null;
    },

    isCurrent(userId) {
      const latest = this.latestForUser(userId);
      if (!latest) return false;
      const days = (Date.now() - localDate(latest.date).getTime()) / 86400000;
      return days <= 30;
    },

    async create({ userId, method, plan, amount, date, note }) {
      const { data, error } = await DH.sb.from('billing').insert({
        user_id: userId, method, plan: (plan || '').trim(), amount: parseFloat(amount) || 0, date, note: (note || '').trim(),
      }).select('*').single();
      throwIfError(error);
      const record = mapBilling(data);
      DH.cache.billing.push(record);
      return record;
    },

    async update(id, { method, plan, amount, date, note }) {
      const { data, error } = await DH.sb.from('billing').update({
        method, plan: (plan || '').trim(), amount: parseFloat(amount) || 0, date, note: (note || '').trim(),
      }).eq('id', id).select('*').single();
      throwIfError(error);
      const updated = mapBilling(data);
      const idx = DH.cache.billing.findIndex(b => b.id === id);
      if (idx >= 0) DH.cache.billing[idx] = updated;
      return updated;
    },

    async delete(id) {
      const { error } = await DH.sb.from('billing').delete().eq('id', id);
      throwIfError(error);
      DH.cache.billing = DH.cache.billing.filter(b => b.id !== id);
    },

    summary(from, to) {
      const inRange = (dateStr) => {
        if (!from && !to) return true;
        const dt = localDate(dateStr);
        if (from && dt < from) return false;
        if (to && dt > to) return false;
        return true;
      };
      const filtered = this.getAll().filter(b => inRange(b.date));
      return { revenue: filtered.reduce((s, b) => s + b.amount, 0), paymentCount: filtered.length };
    },
  };

  /* ══════════════════════════════
     PLANS (admin-managed subscription plans)
  ══════════════════════════════ */
  const plans = {
    getAll() { return DH.cache.plans.slice().sort((a, b) => planSortKey(a) - planSortKey(b)); },
    getAllActive() { return this.getAll().filter(p => p.active !== false); },
    getById(id) { return DH.cache.plans.find(p => p.id === id) || null; },

    priceFor(plan, currency) {
      if (!plan || !plan.prices) return 0;
      const code = currency || 'BRL';
      return plan.prices[code] || plan.prices.BRL || 0;
    },

    async create({ name, prices, period }) {
      const payload = {
        name: (name || '').trim(),
        prices: { BRL: parseFloat(prices?.BRL) || 0, USD: parseFloat(prices?.USD) || 0, EUR: parseFloat(prices?.EUR) || 0 },
        period: period || 'monthly', active: true,
      };
      const { data, error } = await DH.sb.from('plans').insert(payload).select('*').single();
      throwIfError(error);
      const plan = mapPlan(data);
      DH.cache.plans.push(plan);
      return plan;
    },

    async update(id, { name, prices, period }) {
      const payload = {
        name: (name || '').trim(),
        prices: { BRL: parseFloat(prices?.BRL) || 0, USD: parseFloat(prices?.USD) || 0, EUR: parseFloat(prices?.EUR) || 0 },
        period: period || undefined,
      };
      Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
      const { data, error } = await DH.sb.from('plans').update(payload).eq('id', id).select('*').single();
      throwIfError(error);
      const updated = mapPlan(data);
      const idx = DH.cache.plans.findIndex(p => p.id === id);
      if (idx >= 0) DH.cache.plans[idx] = updated;
      return updated;
    },

    async delete(id) {
      const inUse = DH.cache.users.some(u => u.planId === id);
      if (inUse) return { error: 'err_plan_in_use' };
      const { error } = await DH.sb.from('plans').delete().eq('id', id);
      throwIfError(error);
      DH.cache.plans = DH.cache.plans.filter(p => p.id !== id);
      return { success: true };
    },
  };

  /* ══════════════════════════════
     ANALYTICS / SUMMARY (unchanged: pure computation over cache)
  ══════════════════════════════ */
  const analytics = {
    summary(userId, from, to) {
      const ds = debitos.getAll(userId);
      const ps = pagamentos.getAll(userId);

      const inRange = (dateStr) => {
        if (!from && !to) return true;
        const dt = localDate(dateStr);
        if (from && dt < from) return false;
        if (to && dt > to) return false;
        return true;
      };

      const filteredDebits   = ds.filter(d => inRange(d.date));
      const filteredPayments = ps.filter(p => inRange(p.date));

      const totalDebt  = filteredDebits.reduce((s, d) => s + d.amount, 0);
      const totalPaid  = filteredPayments.reduce((s, p) => s + p.amount, 0);
      const activeDebt = filteredDebits.filter(d => d.status !== 'paid').reduce((s, d) => s + d.amount, 0);
      const paidDebt   = filteredDebits.filter(d => d.status === 'paid').reduce((s, d) => s + d.amount, 0);

      // Net amount still owed (each debit's amount minus whatever's already been
      // paid toward it) — not the gross total, so a partially-paid debt only
      // counts what's actually left.
      const balance = filteredDebits.reduce((s, d) => s + Math.max(0, d.amount - pagamentos.totalPaidForDebit(d.id)), 0);
      const creditorIds = [...new Set(filteredDebits.map(d => d.creditorId))];

      return {
        totalDebt, totalPaid, activeDebt, paidDebt, balance,
        currency: dominantCurrency(filteredDebits),
        creditorCount: creditorIds.length, debitCount: filteredDebits.length, paymentCount: filteredPayments.length,
      };
    },

    creditorSummary(creditorId) {
      const ds = DH.cache.debitos.filter(d => d.creditorId === creditorId);
      const ps = DH.cache.pagamentos.filter(p => p.creditorId === creditorId);

      const totalDebt  = ds.reduce((s, d) => s + d.amount, 0);
      const totalPaid  = ps.reduce((s, p) => s + p.amount, 0);
      const balance    = Math.max(0, totalDebt - totalPaid);

      const now = new Date();
      const thisMonthDebits = ds.filter(d => {
        const dt = localDate(d.date);
        return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
      });
      const thisMonthPaid = ps.filter(p => {
        const dt = localDate(p.date);
        return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
      });

      return {
        totalDebt, totalPaid, balance,
        currency: dominantCurrency(ds),
        thisMonthDebt: thisMonthDebits.reduce((s, d) => s + d.amount, 0),
        thisMonthPaid: thisMonthPaid.reduce((s, p) => s + p.amount, 0),
        activeDebits: ds.filter(d => d.status === 'active' || d.status === 'partial'),
        paidDebits: ds.filter(d => d.status === 'paid'),
        debitCount: ds.length, paymentCount: ps.length,
      };
    },
  };

  /* ── Settings: theme/language stay device-local (unchanged) ── */
  const settings = {
    get() {
      return {
        theme:    localStorage.getItem('dh_theme')    || 'dark',
        language: localStorage.getItem('dh_language') || 'pt',
      };
    },
    setTheme(t)    { localStorage.setItem('dh_theme', t);    DH.state.theme = t; },
    setLanguage(l) { localStorage.setItem('dh_language', l); DH.state.language = l; },
  };

  /* City suggestions from whatever is already in cache (own data for a
     regular user, everyone's for admin — matches what RLS lets them see). */
  function distinctCities() {
    const cities = new Set();
    DH.cache.credores.forEach(c => { if (c.city) cities.add(c.city.trim()); });
    DH.cache.users.forEach(u => { if (u.city) cities.add(u.city.trim()); });
    if (DH.cache.profile?.city) cities.add(DH.cache.profile.city.trim());
    return [...cities].sort((a, b) => a.localeCompare(b));
  }
  function distinctCitiesForState(state) {
    if (!state) return [];
    const uf = String(state).trim().toUpperCase();
    const cities = new Set();
    DH.cache.credores.forEach(c => { if (c.city && (c.state || '').toUpperCase() === uf) cities.add(c.city.trim()); });
    DH.cache.users.forEach(u => { if (u.city && (u.state || '').toUpperCase() === uf) cities.add(u.city.trim()); });
    if (DH.cache.profile?.city && (DH.cache.profile.state || '').toUpperCase() === uf) cities.add(DH.cache.profile.city.trim());
    return [...cities].sort((a, b) => a.localeCompare(b));
  }

  return {
    uuid, toSlug, users, session, credores, debitos, pagamentos, paymentTag, billing, plans, analytics, settings,
    isValidCPF, formatCPF, distinctCities, distinctCitiesForState, bootstrap,
  };
})();

/* ══════════════════════════════════════════
   Geography — countries & Brazilian states
   (curated list; not the full ISO-3166 set)
══════════════════════════════════════════ */
DH.geo = (() => {
  const BR_STATES = [
    ['AC','Acre'], ['AL','Alagoas'], ['AP','Amapá'], ['AM','Amazonas'], ['BA','Bahia'],
    ['CE','Ceará'], ['DF','Distrito Federal'], ['ES','Espírito Santo'], ['GO','Goiás'],
    ['MA','Maranhão'], ['MT','Mato Grosso'], ['MS','Mato Grosso do Sul'], ['MG','Minas Gerais'],
    ['PA','Pará'], ['PB','Paraíba'], ['PR','Paraná'], ['PE','Pernambuco'], ['PI','Piauí'],
    ['RJ','Rio de Janeiro'], ['RN','Rio Grande do Norte'], ['RS','Rio Grande do Sul'],
    ['RO','Rondônia'], ['RR','Roraima'], ['SC','Santa Catarina'], ['SP','São Paulo'],
    ['SE','Sergipe'], ['TO','Tocantins'],
  ].sort((a, b) => a[1].localeCompare(b[1], 'pt'));

  const COUNTRIES = [
    ['BR','Brasil','Brazil'], ['US','Estados Unidos','United States'], ['PT','Portugal','Portugal'],
    ['AR','Argentina','Argentina'], ['CA','Canadá','Canada'], ['MX','México','Mexico'],
    ['ES','Espanha','Spain'], ['FR','França','France'], ['DE','Alemanha','Germany'],
    ['IT','Itália','Italy'], ['GB','Reino Unido','United Kingdom'], ['CL','Chile','Chile'],
    ['CO','Colômbia','Colombia'], ['PY','Paraguai','Paraguay'], ['UY','Uruguai','Uruguay'],
    ['PE','Peru','Peru'], ['BO','Bolívia','Bolivia'], ['VE','Venezuela','Venezuela'],
    ['EC','Equador','Ecuador'], ['JP','Japão','Japan'], ['CN','China','China'],
    ['IN','Índia','India'], ['AU','Austrália','Australia'], ['NZ','Nova Zelândia','New Zealand'],
    ['ZA','África do Sul','South Africa'], ['NL','Países Baixos','Netherlands'], ['BE','Bélgica','Belgium'],
    ['CH','Suíça','Switzerland'], ['AT','Áustria','Austria'], ['SE','Suécia','Sweden'],
    ['NO','Noruega','Norway'], ['DK','Dinamarca','Denmark'], ['FI','Finlândia','Finland'],
    ['IE','Irlanda','Ireland'], ['PL','Polônia','Poland'], ['RU','Rússia','Russia'],
    ['KR','Coreia do Sul','South Korea'], ['SG','Singapura','Singapore'],
    ['AE','Emirados Árabes Unidos','United Arab Emirates'], ['IL','Israel','Israel'],
    ['GR','Grécia','Greece'], ['TR','Turquia','Turkey'], ['EG','Egito','Egypt'],
    ['MA','Marrocos','Morocco'], ['AO','Angola','Angola'], ['MZ','Moçambique','Mozambique'],
    ['CV','Cabo Verde','Cape Verde'], ['CU','Cuba','Cuba'], ['DO','República Dominicana','Dominican Republic'],
    ['CR','Costa Rica','Costa Rica'], ['PA','Panamá','Panama'], ['GT','Guatemala','Guatemala'],
    ['HN','Honduras','Honduras'], ['SV','El Salvador','El Salvador'], ['NI','Nicarágua','Nicaragua'],
    ['JM','Jamaica','Jamaica'], ['TT','Trinidad e Tobago','Trinidad and Tobago'], ['IS','Islândia','Iceland'],
    ['LU','Luxemburgo','Luxembourg'], ['CZ','República Tcheca','Czech Republic'], ['HU','Hungria','Hungary'],
    ['RO','Romênia','Romania'], ['UA','Ucrânia','Ukraine'], ['TH','Tailândia','Thailand'],
    ['VN','Vietnã','Vietnam'], ['PH','Filipinas','Philippines'], ['MY','Malásia','Malaysia'],
    ['ID','Indonésia','Indonesia'], ['SA','Arábia Saudita','Saudi Arabia'], ['QA','Catar','Qatar'],
  ];

  function countries(lang) {
    const nameIdx = lang === 'en' ? 2 : 1;
    return COUNTRIES.map(c => ({ code: c[0], name: c[nameIdx] })).sort((a, b) => a.name.localeCompare(b.name, lang === 'en' ? 'en' : 'pt'));
  }
  function states() { return BR_STATES.map(s => ({ uf: s[0], name: s[1] })); }
  return { countries, states };
})();

/* ══════════════════════════════════════════
   Currency formatting
══════════════════════════════════════════ */
DH.currency = (() => {
  const configs = {
    BRL: { locale: 'pt-BR', currency: 'BRL' },
    EUR: { locale: 'de-DE', currency: 'EUR' },
    USD: { locale: 'en-US', currency: 'USD' },
    GBP: { locale: 'en-GB', currency: 'GBP' },
  };
  function format(amount, currencyCode) {
    const code = currencyCode || 'BRL';
    const cfg  = configs[code] || configs.BRL;
    return new Intl.NumberFormat(cfg.locale, { style: 'currency', currency: cfg.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
  }
  return { format, list: () => Object.keys(configs) };
})();

/* ══════════════════════════════════════════
   Date utilities
══════════════════════════════════════════ */
DH.dates = (() => {
  function formatDate(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString + (isoString.includes('T') ? '' : 'T00:00:00'));
    const lang = DH.state.language || 'pt';
    const opts = { day: '2-digit', month: '2-digit', year: 'numeric' };
    return d.toLocaleDateString(lang === 'pt' ? 'pt-BR' : 'en-US', opts);
  }
  function formatMonthYear(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString + (isoString.includes('T') ? '' : 'T00:00:00'));
    const months = DH.i18n.t('month_names');
    return `${months[d.getMonth()]} ${d.getFullYear()}`;
  }
  function today() { return new Date().toISOString().split('T')[0]; }

  /* `to` is only bounded for 'today' (which means exactly today, nothing else).
     Every other preset only bounds how far BACK it looks — leaving `to` open
     means a debit/payment dated a few days in the future (a due date, say)
     never silently disappears just because it isn't in the past yet. 'all'
     leaves both ends open. */
  function rangeFromFilter(filter) {
    const now = new Date();
    let from = null, to = null;
    switch (filter) {
      case 'today': from = new Date(now.getFullYear(), now.getMonth(), now.getDate()); to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59); break;
      case 'month': from = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case '3m': from = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); break;
      case '6m': from = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); break;
      case '1y': from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
      case 'all': from = null; break;
      default: from = null;
    }
    return { from, to };
  }

  function rangeForBilling(filter) {
    const now = new Date();
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    let from;
    switch (filter) {
      case '30d': from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30); break;
      case '3m': from = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); break;
      case '6m': from = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); break;
      case '1y': from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
      default: from = null;
    }
    return { from, to };
  }

  return { formatDate, formatMonthYear, today, rangeFromFilter, rangeForBilling };
})();
