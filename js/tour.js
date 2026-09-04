/* ============================================================
   DebitHub — Guided Tour / Help
   A spotlight-style walkthrough: each step points at the REAL element
   it's talking about (nav buttons, header controls, form fields inside
   the real modals) instead of just describing it in a text box. It never
   fills anything in for the user — modals are opened empty so the user
   can read the field, then type it themselves before moving on.
   Content is Portuguese-only for now, matching the app's primary
   audience — unlike the rest of the UI this isn't run through i18n.
   ============================================================ */

window.DH = window.DH || {};

DH.tour = (() => {
  // `modal` groups consecutive steps that share the same open modal, so the
  // modal only gets (re)opened when the tour actually moves to a different
  // one — not reset on every single step inside it.
  const STEPS = [
    {
      title: 'Bem-vindo ao DebitHub! 👋',
      body: `<p>O DebitHub ajuda você a organizar quem te deve dinheiro, registrar cada pagamento recebido e compartilhar um extrato transparente — sem mais brigas por causa de dívida.</p>
             <p>Esse tour rápido mostra onde fica cada coisa. Ele só vai apontar e explicar — quem preenche os formulários é você, no seu tempo.</p>`,
    },
    {
      title: 'Idioma',
      target: '[data-lang-select]',
      body: `<p>Aqui você troca o idioma do sistema entre Português e Inglês, a qualquer momento.</p>`,
    },
    {
      title: 'Tema claro/escuro',
      target: '#theme-toggle-btn',
      body: `<p>E aqui você alterna entre tema claro e escuro. Fica salvo no seu navegador.</p>`,
    },
    {
      title: 'Passo 1 — Cadastre um credor',
      target: '#nav-new-credor',
      body: `<p>"Credor" é a pessoa ou empresa para quem você deve. Clique aqui para cadastrar o primeiro.</p>`,
    },
    {
      title: 'Nome do credor',
      target: '#credor-name',
      modal: 'credor',
      before: () => DH.credores.openNewModal(),
      body: `<p>Digite o nome de quem você deve. Esse campo é <strong>obrigatório</strong> (marcado com <span class="req-mark">*</span>).</p>`,
    },
    {
      title: 'Estado e Cidade',
      target: '#credor-form .city-state-row',
      modal: 'credor',
      body: `<p>Estado e Cidade também são <strong>obrigatórios</strong>. O telefone logo abaixo é opcional, mas ajuda a identificar a pessoa depois.</p>
             <p>Quando terminar de preencher, clique em "Salvar". Não precisa fazer isso agora — só clique em Próximo quando quiser seguir o tour.</p>`,
    },
    {
      title: 'Passo 2 — Registre um débito',
      target: '#nav-new-debit',
      body: `<p>Com pelo menos um credor cadastrado, clique aqui para registrar uma dívida com ele.</p>`,
    },
    {
      title: 'Escolha o credor',
      target: '#debit-creditor',
      modal: 'debit',
      before: () => DH.debitos.openNewDebitModal(null, { skipGuard: true }),
      body: `<p>Primeiro, escolha para qual credor é essa dívida. Campo <strong>obrigatório</strong>.</p>`,
    },
    {
      title: 'Descrição',
      target: '#debit-description',
      modal: 'debit',
      body: `<p>Descreva do que se trata — por exemplo "Empréstimo para celular". Também <strong>obrigatório</strong>.</p>`,
    },
    {
      title: 'Data e valor',
      target: '#debit-date',
      modal: 'debit',
      body: `<p>Informe a data de emissão e o valor total da dívida. Os dois são <strong>obrigatórios</strong>.</p>`,
    },
    {
      title: 'Tipo de débito',
      target: '#debit-type',
      modal: 'debit',
      body: `<p><strong>Único</strong> é uma dívida de uma vez só. <strong>Parcelado</strong> deixa você definir quantas parcelas. <strong>Recorrente</strong> se repete todo mês, como uma mensalidade.</p>`,
    },
    {
      title: 'Passo 3 — Registre um pagamento',
      target: '#nav-new-payment',
      body: `<p>Toda vez que <strong>você pagar</strong> uma dívida para um determinado credor, registre esse pagamento aqui.</p>`,
    },
    {
      title: 'Escolha o credor',
      target: '#payment-creditor',
      modal: 'payment',
      before: () => DH.debitos.openPaymentModal(null, { skipGuard: true }),
      body: `<p>Escolha para qual credor foi o pagamento que você fez.</p>`,
    },
    {
      title: 'Escolha o débito',
      target: '#payment-debit',
      modal: 'payment',
      body: `<p>Escolha um débito específico para abater, ou a opção <strong>"Dívida total com o credor"</strong> para pagar vários débitos de uma vez com um único valor.</p>`,
    },
    {
      title: 'Valor e data',
      target: '#payment-amount',
      modal: 'payment',
      body: `<p>Informe quanto você pagou e a data do pagamento. Ambos <strong>obrigatórios</strong>.</p>`,
    },
    {
      title: 'Compartilhe com o credor',
      target: '[data-view="credores"]',
      body: `<p>Aqui ficam todos os seus credores. Em cada um tem um botão <strong>"Copiar link"</strong> — envie para a pessoa ver, sem precisar de login, tudo o que ela tem a receber de você.</p>`,
    },
    {
      title: 'Acompanhe tudo na Visão Geral',
      target: '[data-view="overview"]',
      body: `<p>Aqui você acompanha quanto ainda falta pagar, quanto já foi pago e o total de dívidas ativas.</p>`,
    },
    {
      title: 'Precisa de ajuda?',
      target: '#nav-feedback',
      body: `<p>Encontrou algum problema ou tem alguma dúvida? Clique aqui para falar direto com o suporte pelo WhatsApp.</p>`,
    },
    {
      title: 'Pronto! 🎉',
      target: '#tour-help-btn',
      body: `<p>Você já sabe o essencial. Pode reabrir esse tutorial quando quiser clicando neste botão de ajuda, no topo da tela.</p>`,
    },
  ];

  let step = 0;
  let highlightedEl = null;
  let lastModalGroup = null;

  function clearHighlight() {
    if (highlightedEl) { highlightedEl.classList.remove('tour-spotlight'); highlightedEl = null; }
    const card = document.getElementById('tour-floating-card');
    if (card) card.remove();
  }

  function positionCard(card, target) {
    const rect = target.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const margin = 14;

    let left = rect.left;
    if (left + cardRect.width > window.innerWidth - 16) left = window.innerWidth - cardRect.width - 16;
    if (left < 16) left = 16;

    let top = rect.bottom + margin;
    if (top + cardRect.height > window.innerHeight - 16) {
      top = rect.top - cardRect.height - margin;
      if (top < 16) top = Math.max(16, (window.innerHeight - cardRect.height) / 2);
    }

    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  function buildCard(s) {
    const card = document.createElement('div');
    card.className = 'tour-card';
    card.id = 'tour-floating-card';
    const isLast = step === STEPS.length - 1;
    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;margin-bottom:.6rem;">
        <strong style="font-size:.95rem;">${s.title}</strong>
        <button type="button" onclick="DH.tour.close()" title="Fechar" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1.1rem;line-height:1;padding:0;">✕</button>
      </div>
      <div class="text-small" style="color:var(--text-2);">${s.body}</div>
      <div style="display:flex;gap:.35rem;justify-content:center;margin:1rem 0 .85rem;">
        ${STEPS.map((_, i) => `<span style="width:6px;height:6px;border-radius:50%;background:${i === step ? 'var(--accent)' : 'var(--border-soft)'};display:inline-block;"></span>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <button type="button" class="btn btn-ghost btn-sm" onclick="DH.tour.skip()">Pular tutorial</button>
        <div style="display:flex;gap:.5rem;">
          ${step > 0 ? `<button type="button" class="btn btn-ghost btn-sm" onclick="DH.tour.back()">Voltar</button>` : ''}
          <button type="button" class="btn btn-primary btn-sm" onclick="DH.tour.next()">${isLast ? 'Concluir' : 'Próximo'}</button>
        </div>
      </div>
    `;
    return card;
  }

  function placeStep() {
    const s = STEPS[step];
    const target = s.target ? document.querySelector(s.target) : null;

    const finish = () => {
      if (target) {
        target.classList.add('tour-spotlight');
        highlightedEl = target;
      }
      const card = buildCard(s);
      card.style.visibility = 'hidden';
      document.body.appendChild(card);
      requestAnimationFrame(() => {
        if (target) {
          positionCard(card, target);
        } else {
          card.style.left = '50%';
          card.style.top = '50%';
          card.style.transform = 'translate(-50%, -50%)';
        }
        card.style.visibility = 'visible';
      });
    };

    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(finish, 320);
    } else {
      finish();
    }
  }

  function renderStep() {
    clearHighlight();
    const s = STEPS[step];
    const group = s.modal || null;

    if (group !== lastModalGroup) {
      DH.ui.closeAllModals();
    }
    if (s.before) s.before();
    lastModalGroup = group;

    // Give a just-opened modal's fade-in time to finish before measuring
    // where its fields actually ended up on screen.
    setTimeout(placeStep, group && s.before ? 260 : 20);
  }

  function start() {
    step = 0;
    lastModalGroup = null;
    DH.ui.closeAllModals();
    renderStep();
  }

  function next() {
    if (step >= STEPS.length - 1) { close(); return; }
    step++;
    renderStep();
  }

  function back() {
    if (step <= 0) return;
    step--;
    renderStep();
  }

  function close() {
    clearHighlight();
    DH.ui.closeAllModals();
    lastModalGroup = null;
  }

  function skip() { close(); }

  /* ── First-time welcome prompt (once per browser) ──
     The "seen" flag is set the moment it's shown, not on dismiss — the
     generic modal-close paths (ESC, clicking outside) don't know to call
     dismissWelcome(), and this way it never re-shows regardless of how
     the person closes it. */
  function maybeShowWelcome() {
    if (localStorage.getItem('dh_tour_seen')) return;
    localStorage.setItem('dh_tour_seen', '1');
    DH.ui.openModal('welcome-modal-overlay');
  }

  function dismissWelcome() {
    DH.ui.closeModal('welcome-modal-overlay');
  }

  function startFromWelcome() {
    DH.ui.closeModal('welcome-modal-overlay');
    start();
  }

  return { start, next, back, close, skip, maybeShowWelcome, dismissWelcome, startFromWelcome };
})();
