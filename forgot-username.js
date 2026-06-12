(() => {
  const $ = (id) => document.getElementById(id);
  const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

  function isAllowedEmail(email) {
    const value = normalize(email);
    if (value.length > 254) return false;
    const parts = value.split('@');
    if (parts.length !== 2) return false;

    const [local, domain] = parts;
    if (!local || !domain || local.length > 64) return false;
    if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
    if (!/^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}$/i.test(domain)) return false;

    return domain.split('.').every((label) => label && !label.startsWith('-') && !label.endsWith('-'));
  }

  function bindForgotUsernamePopup() {
    const toggle = $('forgotUsernameToggle');
    const modal = $('forgotUsernameModal');
    const closeBtn = $('forgotUsernameClose');
    const form = $('forgotUsernameForm');
    const input = $('recoverUsernameEmail');
    const submitBtn = $('recoverUsernameBtn');
    const message = $('recoverUsernameMessage');

    if (!toggle || !modal || !form || !input || !submitBtn || !message) {
      console.warn('Forgot Username popup: elemente lipsă în HTML.');
      return;
    }

    if (toggle.dataset.forgotUsernameBound === 'true') return;
    toggle.dataset.forgotUsernameBound = 'true';

    const resetMessage = () => {
      message.textContent = 'Dacă emailul există în joc, vei primi username-ul pe email.';
      message.style.color = '';
    };

    const openModal = () => {
      const loginEmail = $('playerEmail')?.value?.trim() || '';
      if (loginEmail && !input.value) input.value = loginEmail;

      resetMessage();
      modal.classList.remove('hidden');
      document.body.classList.add('modal-open');

      window.setTimeout(() => input.focus(), 0);
    };

    const closeModal = () => {
      modal.classList.add('hidden');
      document.body.classList.remove('modal-open');
    };

    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      openModal();
    });

    closeBtn?.addEventListener('click', closeModal);

    modal.addEventListener('click', (event) => {
      if (event.target?.hasAttribute?.('data-forgot-username-close')) {
        closeModal();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
        closeModal();
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const email = normalize(input.value);
      if (!isAllowedEmail(email)) {
        message.textContent = 'Te rog introdu un email valid.';
        message.style.color = 'var(--red)';
        input.focus();
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Se trimite...';
        message.textContent = 'Verific emailul...';
        message.style.color = '';

        const response = await fetch('/.netlify/functions/recover-username', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.error) {
          throw new Error(data?.error || 'Nu am putut trimite emailul de recuperare.');
        }

        message.textContent = 'Dacă emailul există în joc, vei primi username-ul în câteva momente.';
        message.style.color = 'var(--green)';
      } catch (err) {
        console.error(err);
        message.textContent = err.message || 'A apărut o eroare. Încearcă din nou.';
        message.style.color = 'var(--red)';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Trimite';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindForgotUsernamePopup);
  } else {
    bindForgotUsernamePopup();
  }
})();
