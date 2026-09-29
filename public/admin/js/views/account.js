import { api, toast, esc } from '../api.js';

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function resizeAvatarFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      reject(new Error('Use JPEG, PNG or WebP'));
      return;
    }
    const obj = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(obj);
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      let dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      let q = 0.8;
      while (dataUrl.length > 180_000 && q > 0.4) {
        dataUrl = canvas.toDataURL('image/jpeg', q);
        q -= 0.1;
      }
      if (dataUrl.length > 200_000) {
        reject(new Error('Image too large after compress'));
        return;
      }
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(obj);
      reject(new Error('Could not read image'));
    };
    img.src = obj;
  });
}

export async function renderAccount(root, state) {
  const me = await api('/api/me');
  const u = me.user;
  state.user = u;

  root.innerHTML = `
    <section class="block">
      <div class="block-head"><h2>Admin profile</h2></div>
      <p class="muted">Update your staff account. Changes apply to login and the game menu.</p>
      <div class="form-row" style="align-items:center;gap:16px">
        <div id="acc-av" class="avatar-preview ${u.avatarUrl ? '' : 'empty'}"
          style="${u.avatarUrl ? `background-image:url('${esc(u.avatarUrl)}')` : ''}"></div>
        <div>
          <p style="margin:0 0 8px"><b>${esc(u.username)}</b> · <span class="tag warn">${esc(state.role)}</span></p>
          <div class="form-row" style="margin:0">
            <label class="btn small primary" for="acc-av-file">Upload photo</label>
            <input id="acc-av-file" type="file" accept="image/jpeg,image/png,image/webp" hidden />
            <button type="button" class="btn small ghost" id="acc-av-clear" ${u.avatarUrl ? '' : 'disabled'}>Remove photo</button>
          </div>
        </div>
      </div>
    </section>

    <section class="block">
      <div class="block-head"><h2>Display name</h2></div>
      <p class="muted">3–16 letters, numbers or underscores. Must be unique.</p>
      <div class="form-row">
        <input id="acc-name" maxlength="16" minlength="3" value="${esc(u.username)}" placeholder="Username" />
        <button class="btn small primary" id="acc-name-btn">Save name</button>
      </div>
    </section>

    <section class="block">
      <div class="block-head"><h2>Change password</h2></div>
      <p class="muted">Enter your current password, then a new one (6–72 characters).</p>
      <div class="form-row" style="flex-direction:column;align-items:stretch;max-width:360px">
        <input id="acc-pw-cur" type="password" maxlength="72" placeholder="Current password" autocomplete="current-password" />
        <input id="acc-pw-new" type="password" maxlength="72" minlength="6" placeholder="New password" autocomplete="new-password" />
        <input id="acc-pw-confirm" type="password" maxlength="72" minlength="6" placeholder="Confirm new password" autocomplete="new-password" />
        <button class="btn small primary" id="acc-pw-btn" style="align-self:flex-start">Save password</button>
      </div>
    </section>
  `;

  const nameEl = document.getElementById('a-name');

  root.querySelector('#acc-av-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const image = await resizeAvatarFile(file);
      const { user } = await api('/api/me/avatar', { image });
      state.user = user;
      toast('Photo updated');
      renderAccount(root, state);
    } catch (err) { toast(err.message, true); }
  });

  root.querySelector('#acc-av-clear')?.addEventListener('click', async () => {
    try {
      const { user } = await api('/api/me/avatar/clear', {});
      state.user = user;
      toast('Photo removed');
      renderAccount(root, state);
    } catch (err) { toast(err.message, true); }
  });

  root.querySelector('#acc-name-btn')?.addEventListener('click', async () => {
    const username = (root.querySelector('#acc-name')?.value || '').trim();
    if (!USERNAME_RE.test(username)) {
      toast('Username must be 3–16 letters, numbers or underscores', true);
      return;
    }
    try {
      const { user } = await api('/api/me/username', { username });
      state.user = user;
      if (nameEl) nameEl.textContent = user.username;
      toast('Name saved');
      renderAccount(root, state);
    } catch (err) { toast(err.message, true); }
  });

  root.querySelector('#acc-pw-btn')?.addEventListener('click', async () => {
    const currentPassword = root.querySelector('#acc-pw-cur')?.value || '';
    const newPassword = root.querySelector('#acc-pw-new')?.value || '';
    const confirm = root.querySelector('#acc-pw-confirm')?.value || '';
    if (newPassword.length < 6 || newPassword.length > 72) {
      toast('New password must be 6–72 characters', true);
      return;
    }
    if (newPassword !== confirm) {
      toast('New passwords do not match', true);
      return;
    }
    try {
      await api('/api/me/password', { currentPassword, newPassword });
      root.querySelector('#acc-pw-cur').value = '';
      root.querySelector('#acc-pw-new').value = '';
      root.querySelector('#acc-pw-confirm').value = '';
      toast('Password updated');
    } catch (err) { toast(err.message, true); }
  });
}
