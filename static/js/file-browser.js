// file-browser.js — Cross-platform file/folder picker modal
// Uses GET /api/fs/ls for directory listing. No OS dialogs, no native deps.
//
// API:
//   fileBrowser.open(opts) → Promise<{ok:true, path}|{ok:false, reason}>
//
// opts:
//   title       — modal heading (string)
//   mode        — 'file' | 'dir'  (default: 'file')
//   extensions  — ['.gguf', ...]  filter shown files; empty = show all
//   startPath   — initial directory (empty string = OS default / drives on Windows)

const fileBrowser = (() => {
  let _el       = null;
  let _resolve  = null;
  let _opts     = {};
  let _curPath  = '';
  let _selPath  = null;

  // ── DOM ───────────────────────────────────────────────────────────────────

  function _build() {
    const el = document.createElement('div');
    el.className = 'fb-overlay';
    el.innerHTML = `
      <div class="fb-modal" role="dialog" aria-modal="true">
        <div class="fb-header">
          <div class="fb-title-row">
            <span class="fb-title"></span>
            <button class="fb-close" aria-label="Close">✕</button>
          </div>
          <div class="fb-breadcrumb"></div>
        </div>
        <div class="fb-body"></div>
        <div class="fb-footer">
          <span class="fb-selected-label"></span>
          <div class="fb-footer-btns">
            <button class="fb-btn cancel">Cancel</button>
            <button class="fb-btn confirm" disabled>Select</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('.fb-close').addEventListener('click', _cancel);
    el.querySelector('.fb-btn.cancel').addEventListener('click', _cancel);
    el.querySelector('.fb-btn.confirm').addEventListener('click', _confirm);
    el.addEventListener('click', e => { if (e.target === el) _cancel(); });
    document.addEventListener('keydown', _onKey);
    return el;
  }

  function _onKey(e) {
    if (!_el?.classList.contains('open')) return;
    if (e.key === 'Escape') _cancel();
    if (e.key === 'Enter' && _selPath) _confirm();
  }

  // ── Selection state ───────────────────────────────────────────────────────

  function _setSelected(path) {
    _selPath = path || null;
    const label   = _el.querySelector('.fb-selected-label');
    const confirm = _el.querySelector('.fb-btn.confirm');
    if (_selPath) {
      const name = _selPath.split(/[/\\]/).pop() || _selPath;
      label.textContent = name;
      label.title       = _selPath;
      confirm.disabled  = false;
    } else {
      label.textContent = '—';
      label.title       = '';
      confirm.disabled  = true;
    }
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  async function _navigate(path) {
    const body = _el.querySelector('.fb-body');
    body.innerHTML = '<div class="fb-empty">Loading…</div>';
    _setSelected(null);

    let data;
    try {
      const res = await fetch(`/api/fs/ls?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      data = await res.json();
    } catch (e) {
      body.innerHTML = `<div class="fb-error">Could not read directory:<br>${_esc(e.message)}</div>`;
      return;
    }

    _curPath = data.path;
    _renderBreadcrumb(data);

    // Dir mode: current folder is immediately selectable
    if (_opts.mode === 'dir' && _curPath) _setSelected(_curPath);

    if (data.drives?.length) { _renderDrives(data.drives); return; }
    _renderEntries(data.entries, data.sep || '/');
  }

  // ── Breadcrumb ────────────────────────────────────────────────────────────

  function _renderBreadcrumb(data) {
    const bc  = _el.querySelector('.fb-breadcrumb');
    bc.innerHTML = '';

    if (!data.path) {
      // Windows drives root
      const s = document.createElement('span');
      s.className   = 'fb-crumb current';
      s.textContent = '💻 This PC';
      bc.appendChild(s);
      return;
    }

    const sep   = data.sep || '/';
    const isWin = sep === '\\';
    const parts = data.path.replace(/\\/g, '/').split('/').filter(Boolean);

    // "This PC" link on Windows
    if (isWin) {
      bc.appendChild(_crumbBtn('💻', () => _navigate(''), false, 'This PC'));
      bc.appendChild(_sepEl());
    } else {
      // Linux/Mac: root "/"
      bc.appendChild(_crumbBtn('/', () => _navigate('/'), parts.length === 0));
      if (parts.length) bc.appendChild(_sepEl());
    }

    parts.forEach((part, i) => {
      const isLast  = i === parts.length - 1;
      const segPath = isWin
        ? parts.slice(0, i + 1).join('\\') + (i === 0 ? '\\' : '')
        : '/' + parts.slice(0, i + 1).join('/');
      bc.appendChild(_crumbBtn(part, () => _navigate(segPath), isLast));
      if (!isLast) bc.appendChild(_sepEl());
    });
  }

  function _crumbBtn(label, onClick, isCurrent, title = '') {
    const b = document.createElement('button');
    b.className   = 'fb-crumb' + (isCurrent ? ' current' : '');
    b.textContent = label;
    if (title) b.title = title;
    if (!isCurrent) b.addEventListener('click', onClick);
    return b;
  }

  function _sepEl() {
    const s = document.createElement('span');
    s.className   = 'fb-sep';
    s.textContent = '›';
    return s;
  }

  // ── Drives (Windows root) ─────────────────────────────────────────────────

  function _renderDrives(drives) {
    const body = _el.querySelector('.fb-body');
    const wrap = document.createElement('div');
    wrap.className = 'fb-drives';
    drives.forEach(d => {
      const btn = document.createElement('button');
      btn.className = 'fb-drive-btn';
      btn.innerHTML = `<span class="fb-drive-icon">💾</span>${_esc(d)}`;
      btn.addEventListener('click', () => _navigate(d));
      wrap.appendChild(btn);
    });
    body.innerHTML = '';
    body.appendChild(wrap);
  }

  // ── Entry list ────────────────────────────────────────────────────────────

  function _renderEntries(entries, sep) {
    const body = _el.querySelector('.fb-body');
    if (!entries.length) {
      body.innerHTML = '<div class="fb-empty">Folder is empty</div>';
      return;
    }

    const exts    = (_opts.extensions || []).map(e => e.toLowerCase());
    const isDirMode = _opts.mode === 'dir';
    const list    = document.createElement('div');

    entries.forEach(entry => {
      const isDir      = entry.type === 'dir';
      const matchesExt = !exts.length || isDir ||
        exts.some(ext => entry.name.toLowerCase().endsWith(ext));

      const row = document.createElement('div');
      row.className = [
        'fb-entry',
        isDir ? 'dir' : 'file',
        !isDir && !matchesExt ? 'dimmed' : '',
      ].filter(Boolean).join(' ');

      const size = !isDir && entry.size != null ? _fmtSize(entry.size) : '';
      row.innerHTML = `
        <span class="fb-icon">${isDir ? '📁' : '📄'}</span>
        <span class="fb-name" title="${_esc(entry.name)}">${_esc(entry.name)}</span>
        ${size ? `<span class="fb-size">${size}</span>` : ''}`;

      if (isDir) {
        row.addEventListener('click', () => {
          // Dir mode: single-click selects current dir AND navigates
          if (isDirMode) _setSelected(_join(_curPath, entry.name, sep));
          _navigate(_join(_curPath, entry.name, sep));
        });
      } else if (matchesExt && !isDirMode) {
        row.addEventListener('click', () => {
          _el.querySelectorAll('.fb-entry.selected').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
          _setSelected(_join(_curPath, entry.name, sep));
        });
        row.addEventListener('dblclick', () => {
          _setSelected(_join(_curPath, entry.name, sep));
          _confirm();
        });
      }

      list.appendChild(row);
    });

    body.innerHTML = '';
    body.appendChild(list);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function _join(dir, name, sep) {
    if (!sep) sep = dir.includes('\\') ? '\\' : '/';
    return dir.endsWith(sep) ? dir + name : dir + sep + name;
  }

  function _fmtSize(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
    if (bytes >= 1e6) return Math.round(bytes / 1e6) + ' MB';
    if (bytes >= 1e3) return Math.round(bytes / 1e3) + ' KB';
    return bytes + ' B';
  }

  function _esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function open(opts) {
    return new Promise(resolve => {
      _resolve = resolve;
      _opts    = { mode: 'file', extensions: [], startPath: '', ...opts };

      if (!_el) _el = _build();
      _el.querySelector('.fb-title').textContent = _opts.title || 'Select file';
      _setSelected(null);
      requestAnimationFrame(() => _el.classList.add('open'));
      _navigate(_opts.startPath ?? '');
    });
  }

  function _cancel()  { _close(); _resolve?.({ ok: false, reason: 'cancelled' }); }
  function _confirm() {
    if (!_selPath) return;
    const path = _selPath;
    _close();
    _resolve?.({ ok: true, path });
  }
  function _close() {
    _el?.classList.remove('open');
    _selPath = _resolve = null;
  }

  return { open };
})();
