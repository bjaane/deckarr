import { api } from '../api.js';
import { h, icon, light, pageHead, section, notice, openSheet, confirmAction, toast, switchInput, chevron, initials } from '../ui.js';

const CATEGORY_ORDER = ['Library', 'Downloads', 'Indexers', 'Subtitles', 'Media server', 'Server'];

export function render(root, ctx, params) {
  const { state } = ctx;
  root.append(pageHead('Settings').el);

  const servicesSec = section('Services');
  root.append(servicesSec.el);

  let status = {};

  function drawServices() {
    const rows = state.services.map((s) => {
      const st = status[s.id];
      return h(
        'button',
        { type: 'button', class: 'row has-lead', onClick: () => openServiceForm(ctx, s, { onSaved: refresh }) },
        h('span', { class: 'lead', text: initials(state.types[s.type]?.label || s.type) }),
        h(
          'span',
          { class: 'row-main' },
          h('span', { class: 'row-title', text: s.name }),
          h('span', { class: 'row-sub', text: st ? (st.ok ? [state.types[s.type]?.label, st.version ? `v${st.version}` : null].filter(Boolean).join(' ') : st.error) : state.types[s.type]?.label }),
        ),
        st ? light(st.ok ? 'ok' : 'bad') : null,
        chevron(),
      );
    });
    servicesSec.set(
      h(
        'div',
        { class: 'list' },
        rows,
        h('button', { type: 'button', class: 'row add', onClick: () => openServiceForm(ctx, null, { onSaved: refresh }) }, icon('plus', 20), 'Add a service'),
      ),
      state.services.length ? null : h('p', { class: 'section-note', text: 'Start with the apps you use most. You can add more any time.' }),
    );
  }

  async function loadStatus(fresh = false) {
    try {
      status = await api(`/api/status${fresh ? '?fresh=1' : ''}`);
      drawServices();
    } catch {
      /* rows still work without lights */
    }
  }

  async function refresh() {
    await ctx.reloadServices();
    drawServices();
    loadStatus(true);
  }

  drawServices();
  loadStatus();

  // ---- account ----
  const account = section('Account');
  root.append(account.el);
  const accountRows = [];
  if (!state.auth.passwordFromEnv) {
    accountRows.push(h('button', { type: 'button', class: 'row', onClick: () => openPasswordForm() }, h('span', { class: 'row-main row-title', text: 'Change password' }), chevron()));
  }
  accountRows.push(
    h(
      'button',
      {
        type: 'button',
        class: 'row',
        onClick: async () => {
          await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
          location.reload();
        },
      },
      h('span', { class: 'row-main row-title', text: 'Sign out on this device' }),
    ),
  );
  account.set(h('div', { class: 'list' }, accountRows), state.auth.passwordFromEnv ? h('p', { class: 'section-note', text: 'The password is set with APP_PASSWORD on the container.' }) : null);

  // ---- install hint ----
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!standalone) {
    const install = section('Use it like an app');
    root.append(install.el);
    install.set(
      h(
        'div',
        { class: 'list' },
        h('div', { class: 'row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-sub wrap', text: 'In Safari, tap the Share button, then Add to Home Screen. Deckarr then opens full screen from its own icon.' }))),
      ),
    );
  }

  const about = section('About');
  root.append(about.el);
  about.set(h('p', { class: 'section-note', text: `Deckarr ${state.auth.version || ''}. API keys stay on your server and are never sent to this device.` }));

  if (params?.get('add')) openServiceForm(ctx, null, { onSaved: refresh });
  const editId = params?.get('edit');
  if (editId) {
    const s = state.services.find((x) => x.id === editId);
    if (s) openServiceForm(ctx, s, { onSaved: refresh });
  }
  if (params?.has('add') || params?.has('edit')) history.replaceState(null, '', '#/settings');
}

// ---------- add / edit a service ----------

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { text: label }), input, hint ? h('span', { class: 'sr-only', text: hint }) : null);
}

function openServiceForm(ctx, existing, { onSaved } = {}) {
  const { types } = ctx.state;
  const sheet = openSheet({ title: existing ? existing.name : 'Add a service', tall: true });

  if (existing) drawForm(existing.type);
  else drawTypePicker();

  function drawTypePicker() {
    sheet.setTitle('Add a service');
    const byCategory = new Map();
    for (const [id, t] of Object.entries(types)) {
      if (!byCategory.has(t.category)) byCategory.set(t.category, []);
      byCategory.get(t.category).push([id, t]);
    }
    const cats = [...byCategory.keys()].sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
    sheet.set(
      h('p', { class: 'sheet-msg', text: 'Which app do you want to connect?' }),
      cats.map((cat) => [
        h('p', { class: 'group-label', text: cat }),
        h(
          'div',
          { class: 'list' },
          byCategory.get(cat).map(([id, t]) =>
            h(
              'button',
              { type: 'button', class: 'row has-lead', onClick: () => drawForm(id) },
              h('span', { class: 'lead', text: initials(t.label) }),
              h('span', { class: 'row-main row-title', text: t.label }),
              chevron(),
            ),
          ),
        ),
      ]),
    );
  }

  function drawForm(type) {
    const meta = types[type];
    sheet.setTitle(existing ? existing.name : `Add ${meta.label}`);

    const name = h('input', { type: 'text', value: existing?.name || meta.label, autocomplete: 'off', maxlength: '40' });
    const url = h('input', {
      type: 'url',
      inputmode: 'url',
      value: existing?.url || '',
      placeholder: `http://192.168.1.10:${meta.port}`,
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
    });
    const secretAttrs = { autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' };
    const apiKey = meta.auth === 'apikey'
      ? h('input', { type: 'password', placeholder: existing?.hasApiKey ? 'Saved. Leave blank to keep it' : 'Paste the API key', ...secretAttrs })
      : null;
    const username = meta.auth === 'login' ? h('input', { type: 'text', value: existing?.username || '', placeholder: 'admin', ...secretAttrs }) : null;
    const password = meta.auth === 'login'
      ? h('input', { type: 'password', placeholder: existing?.hasPassword ? 'Saved. Leave blank to keep it' : 'Password', ...secretAttrs })
      : null;
    const backupUrl = h('input', { type: 'url', inputmode: 'url', value: existing?.backupUrl || '', placeholder: `http://tower.tailnet.ts.net:${meta.port}`, ...secretAttrs });
    const webUrl = h('input', { type: 'url', inputmode: 'url', value: existing?.webUrl || '', placeholder: 'Same as the address above', ...secretAttrs });
    let insecure = Boolean(existing?.insecure);
    const insecureSwitch = switchInput(insecure, (v) => (insecure = v), 'Allow self-signed certificate');

    const result = h('div');
    const testBtn = h('button', { type: 'button', class: 'btn' }, 'Test connection');
    const saveBtn = h('button', { type: 'button', class: 'btn btn-primary' }, existing ? 'Save changes' : `Add ${meta.label}`);

    const payload = () => {
      const p = {
        type,
        id: existing?.id,
        name: name.value.trim(),
        url: url.value.trim(),
        backupUrl: backupUrl.value.trim(),
        webUrl: webUrl.value.trim(),
        insecure,
      };
      if (apiKey && apiKey.value.trim()) p.apiKey = apiKey.value.trim();
      if (username) p.username = username.value.trim();
      if (password && password.value) p.password = password.value;
      return p;
    };

    const showResult = (r) =>
      result.replaceChildren(
        h(
          'div',
          { class: 'result', role: 'status' },
          light(r.ok ? 'ok' : 'bad'),
          h(
            'div',
            null,
            h('div', { text: r.ok ? `Connected to ${meta.label}${r.version ? ` ${r.version}` : ''}${r.via === 'backup' ? ' using the backup address' : ''}` : r.error }),
            r.ok && r.detail ? h('div', { class: 'row-sub', text: r.detail }) : null,
          ),
        ),
      );

    async function test() {
      testBtn.disabled = true;
      testBtn.textContent = 'Testing…';
      try {
        const r = await api('/api/services/test', { method: 'POST', body: payload() });
        showResult(r);
        return r;
      } catch (err) {
        showResult({ ok: false, error: err.message });
        return { ok: false, error: err.message };
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Test connection';
      }
    }

    testBtn.addEventListener('click', test);

    saveBtn.addEventListener('click', async () => {
      const r = await test();
      if (!r.ok) {
        const go = await confirmAction({
          title: 'Save without a working connection?',
          message: r.error,
          label: 'Save anyway',
          destructive: false,
        });
        if (!go) return;
      }
      saveBtn.disabled = true;
      try {
        const body = payload();
        if (existing) await api(`/api/services/${existing.id}`, { method: 'PUT', body });
        else await api('/api/services', { method: 'POST', body });
        toast(existing ? 'Changes saved' : `${body.name || meta.label} added`);
        sheet.close();
        onSaved?.();
      } catch (err) {
        showResult({ ok: false, error: err.message });
      } finally {
        saveBtn.disabled = false;
      }
    });

    const credentialFields = meta.auth === 'apikey'
      ? [field('API key', apiKey)]
      : [field('Username', username), field('Password', password)];

    const nodes = [
      h('div', { class: 'list' }, field('Name', name), field('Address', url), credentialFields),
      h('p', { class: 'hint', text: meta.help }),
      h('p', { class: 'group-label', text: 'Optional' }),
      h(
        'div',
        { class: 'list' },
        field('Backup address', backupUrl),
        field('Web UI address', webUrl),
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: 'Allow self-signed certificate' }), h('span', { class: 'row-sub wrap', text: 'Only for https:// addresses with a home-made certificate' })),
          insecureSwitch,
        ),
      ),
      h('p', { class: 'hint', text: 'The backup address is used when the main address can’t be reached, for example a Tailscale name or another IP. Same API key.' }),
      h('p', { class: 'hint', text: `The web UI address is used for “Open ${meta.label}” links, for example your reverse proxy address. Leave it blank to use the address above.` }),
      result,
      h('div', { class: 'btn-row' }, testBtn, saveBtn),
    ];

    if (existing) {
      const del = h('button', { type: 'button', class: 'btn btn-danger btn-block' }, `Remove ${existing.name}`);
      del.addEventListener('click', async () => {
        const go = await confirmAction({
          title: `Remove ${existing.name}?`,
          message: 'Deckarr forgets the address and key. Nothing changes in the app itself.',
          label: 'Remove service',
        });
        if (!go) return;
        try {
          await api(`/api/services/${existing.id}`, { method: 'DELETE' });
          toast(`${existing.name} removed`);
          sheet.close();
          onSaved?.();
        } catch (err) {
          toast(err.message, 'bad');
        }
      });
      nodes.push(h('div', { class: 'stack' }, del));
    } else {
      nodes.unshift(h('button', { type: 'button', class: 'link-btn', style: { marginBottom: '12px' }, onClick: drawTypePicker }, 'Choose a different app'));
    }

    sheet.set(...nodes);
    if (!existing) setTimeout(() => url.focus(), 350);
  }
}

// ---------- change password ----------

function openPasswordForm() {
  const sheet = openSheet({ title: 'Change password' });
  const current = h('input', { type: 'password', autocomplete: 'current-password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters' });
  const again = h('input', { type: 'password', autocomplete: 'new-password' });
  const error = h('div');
  const save = h('button', { type: 'button', class: 'btn btn-primary btn-block' }, 'Change password');
  save.addEventListener('click', async () => {
    error.replaceChildren();
    if (next.value.length < 8) return error.replaceChildren(h('div', { style: { marginTop: '12px' } }, notice('Use at least 8 characters for the new password.')));
    if (next.value !== again.value) return error.replaceChildren(h('div', { style: { marginTop: '12px' } }, notice('The new passwords don’t match.')));
    save.disabled = true;
    try {
      await api('/api/auth/password', { method: 'POST', body: { current: current.value, next: next.value } });
      toast('Password changed. Other devices are signed out.');
      sheet.close();
    } catch (err) {
      error.replaceChildren(h('div', { style: { marginTop: '12px' } }, notice(err.message)));
    } finally {
      save.disabled = false;
    }
  });
  sheet.set(
    h('div', { class: 'list' }, field('Current password', current), field('New password', next), field('New password again', again)),
    error,
    h('div', { class: 'stack' }, save),
  );
  setTimeout(() => current.focus(), 350);
}
