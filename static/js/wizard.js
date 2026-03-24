
  let currentStep = 0;
  let selectedGPU = '';
  let modelPath   = '';
  let mmprojPath  = '';
  let multimodal  = false;
  let scanDone    = false;
  let _scanResults = [];   // full path list from scan, used by onNativePick

  // ── Navigation ────────────────────────────────────────────────────────────
  function goTo(i) {
    document.getElementById('step-' + currentStep).classList.remove('visible');
    [0,1,2].forEach(idx => {
      const d = document.getElementById('dot-' + idx);
      d.className = 'dot' + (idx === i ? ' active' : idx < i ? ' done' : '');
    });
    currentStep = i;
    document.getElementById('step-' + i).classList.add('visible');
  }

  // ── GPU ───────────────────────────────────────────────────────────────────
  function selectGPU(el) {
    document.querySelectorAll('.gpu-chip').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    selectedGPU = el.dataset.gpu;
    updateStartBtn();
  }

  function setDetectedGPU(gpu) {
    selectedGPU = gpu;
    document.querySelectorAll('.gpu-chip').forEach(c =>
      c.classList.toggle('selected', c.dataset.gpu === gpu)
    );
    const labels = { intel:'Intel GPU detected', nvidia:'NVIDIA GPU detected', amd:'AMD GPU detected', cpu:'No discrete GPU detected' };
    document.getElementById('detected-label').textContent = labels[gpu] || gpu;
    document.getElementById('detected-note').style.display = 'flex';
  }

  // ── Multimodal ────────────────────────────────────────────────────────────
  function toggleMultimodal() {
    multimodal = !multimodal;
    document.getElementById('mm-toggle').classList.toggle('on', multimodal);
    document.getElementById('mmproj-section').classList.toggle('visible', multimodal);
    if (multimodal && modelPath) fetchMmprojCandidates(modelPath);
    if (!multimodal) { mmprojPath = ''; setFileDisplay('mmproj', '', false); }
    updateStartBtn();
  }

  // ── File browser ──────────────────────────────────────────────────────────
  function browseFile(type) {
    // Trigger the native OS file picker (opens GNOME Files / Finder / Explorer)
    document.getElementById('pick-' + type)?.click();
  }

  // Called when the native OS file picker returns a selection
  function onNativePick(input, type) {
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    const nameOnly = file.name;

    // Try to find the full path from scan results first (zero extra typing)
    const match = (_scanResults || []).find(f => f.name === nameOnly);
    if (match) {
      if (type === 'model') {
        modelPath = match.path;
        setFileDisplay('model', match.path, true);
        if (multimodal) fetchMmprojCandidates(match.path);
      } else {
        mmprojPath = match.path;
        setFileDisplay('mmproj', match.path, true);
      }
      // Remove any stale path input
      document.getElementById(type + '-path-input')?.closest('div')?.remove();
      updateStartBtn();
      return;
    }

    // Not in scan results — show chip with filename and a pre-filled path input
    setFileDisplay(type, nameOnly, false);
    showPathInputWithHint(type, nameOnly);
  }

  function showPathInputWithHint(type, filename) {
    // Remove any existing path input for this type
    document.getElementById(type + '-path-input')?.closest('div')?.remove();

    const chip = document.getElementById(type + '-chip');
    if (!chip) return;

    const wrap = document.createElement('div');
    wrap.id = type + '-path-wrap';
    wrap.style.cssText = 'margin-top:8px';
    wrap.innerHTML = `
      <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:5px">
        File not found in scan results — paste the full path to
        <strong style="color:var(--indigo-hi)">${filename}</strong>:
      </div>
      <input id="${type}-path-input" type="text"
        placeholder="/path/to/${filename}"
        style="width:100%;background:rgba(0,0,0,0.2);border:1px solid rgba(129,140,248,0.3);
               border-radius:10px;color:var(--text);font-family:'DM Mono',monospace;
               font-size:12px;padding:10px 13px;outline:none;box-sizing:border-box"/>
      <div style="font-size:11px;color:var(--text-dim);margin-top:5px">
        Tip: run <code style="background:rgba(0,0,0,0.2);padding:1px 5px;border-radius:4px">find ~ -name "${filename}" 2>/dev/null</code> to find it
      </div>`;

    chip.closest('.file-chip-row').insertAdjacentElement('afterend', wrap);

    const inp = wrap.querySelector('input');
    inp.addEventListener('input', () => {
      const val = inp.value.trim();
      if (type === 'model') {
        modelPath = val;
        setFileDisplay('model', val ? val : filename, !!val);
        if (multimodal && val) fetchMmprojCandidates(val);
      } else {
        mmprojPath = val;
        setFileDisplay('mmproj', val ? val : filename, !!val);
      }
      updateStartBtn();
    });
    inp.focus();
  }

  function setFileDisplay(type, path, isSet) {
    // Update the chip element (new style)
    const chip     = document.getElementById(type + '-chip');
    const chipName = document.getElementById(type + '-chip-name');
    if (chip && chipName) {
      chipName.textContent = path ? path.split(/[\\/]/).pop() : 'Click to select…';
      chipName.title       = path || '';
      chip.classList.toggle('set', !!path);
      chip.classList.toggle('empty', !path);
    }
  }

  function showPathInput(type) {
    // When tkinter is unavailable, add a text field under the chip
    const row = document.getElementById(type + '-chip')?.closest('.file-chip-row');
    if (!row) return;
    if (row.querySelector('.path-fallback')) { row.querySelector('.path-fallback').focus(); return; }

    const inp = document.createElement('input');
    inp.type      = 'text';
    inp.className = 'path-fallback';
    inp.placeholder = type === 'model'
      ? 'Paste full path to .gguf…'
      : 'Paste full path to mmproj .gguf…';
    inp.style.cssText = [
      'flex:1','min-width:0','margin-top:8px',
      'background:rgba(0,0,0,0.2)',
      'border:1px solid rgba(129,140,248,0.3)',
      'border-radius:11px','color:var(--text)',
      'font-family:"DM Mono",monospace',
      'font-size:12px','padding:10px 14px','outline:none'
    ].join(';');
    inp.addEventListener('input', () => {
      const val = inp.value.trim();
      if (type === 'model') {
        modelPath = val;
        setFileDisplay('model', val, !!val);
        if (multimodal && val) fetchMmprojCandidates(val);
      } else {
        mmprojPath = val;
        setFileDisplay('mmproj', val, !!val);
      }
      updateStartBtn();
    });
    // Insert after the chip
    const chip = document.getElementById(type + '-chip');
    chip?.insertAdjacentElement('afterend', inp);
    inp.focus();
  }


  // ── Scan ──────────────────────────────────────────────────────────────────
  async function scanForModels() {
    const btn = document.getElementById('scan-btn');

    // Second click: toggle visibility of existing results
    if (scanDone) {
      document.getElementById('scan-results').classList.toggle('visible');
      return;
    }

    btn.innerHTML = '<span class="mini-spin"></span> Scanning…';
    btn.disabled = true;

    try {
      const res  = await fetch('/api/scan/models');
      const data = await res.json();
      _scanResults = data.gguf_files || [];
      renderScanResults(_scanResults);
      scanDone = true;
    } catch (e) {
      _scanResults = [];
      renderScanResults([]);
      scanDone = true;
    }

    btn.innerHTML = 'Show / hide scan results';
    btn.disabled  = false;
  }

  function renderScanResults(files) {
    const wrap = document.getElementById('scan-results');
    wrap.innerHTML = '';

    if (!files.length) {
      wrap.innerHTML = '<div class="scan-empty">No .gguf files found in common locations.<br>Use Browse to select manually.</div>';
    } else {
      files.forEach(f => {
        const item = document.createElement('div');
        item.className = 'scan-item';
        item.innerHTML = `
          <div style="min-width:0;overflow:hidden">
            <div class="scan-name">${f.name}</div>
            <div class="scan-path" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.path}</div>
          </div>
          <div class="scan-size">${f.size_gb} GB</div>`;
        item.onclick = () => {
          document.querySelectorAll('.scan-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          modelPath = f.path;
          setFileDisplay('model', f.path, true);
          if (multimodal) fetchMmprojCandidates(f.path);
          updateStartBtn();
        };
        wrap.appendChild(item);
      });
    }
    wrap.classList.add('visible');
  }

  // ── Mmproj candidates ─────────────────────────────────────────────────────
  async function fetchMmprojCandidates(forModelPath) {
    try {
      const res  = await fetch('/api/mmproj-candidates?model_path=' + encodeURIComponent(forModelPath));
      const data = await res.json();
      const list = data.candidates || [];

      const wrap   = document.getElementById('mmproj-candidates-wrap');
      const listEl = document.getElementById('mmproj-candidate-list');
      listEl.innerHTML = '';

      if (!list.length) { wrap.style.display = 'none'; return; }

      list.forEach(c => {
        const item = document.createElement('div');
        item.className = 'candidate-item';
        item.textContent = c.name;
        item.title = c.path;
        item.onclick = () => {
          listEl.querySelectorAll('.candidate-item').forEach(d => d.classList.remove('selected'));
          item.classList.add('selected');
          mmprojPath = c.path;
          setFileDisplay('mmproj', c.path, true);
          updateStartBtn();
        };
        listEl.appendChild(item);
      });

      wrap.style.display = 'block';
    } catch (e) { /* non-critical */ }
  }

  // ── Advanced ──────────────────────────────────────────────────────────────
  function toggleAdv(el) {
    el.nextElementSibling.classList.toggle('open');
    el.querySelector('.chevron').classList.toggle('open');
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function updateStartBtn() {
    const ready = modelPath && selectedGPU && (!multimodal || mmprojPath);
    document.getElementById('btn-start').disabled = !ready;
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  async function startBoot() {
    clearError('err-0');

    if (!modelPath)             { showError('err-0', 'Please select a model file.');              return; }
    if (!selectedGPU)           { showError('err-0', 'Please select your GPU type.');             return; }
    if (multimodal && !mmprojPath) { showError('err-0', 'Please select an mmproj file, or disable multimodal.'); return; }

    // Shut down any running model server first — wizard may be changing the model
    try { await fetch('/api/shutdown-model', { method: 'POST' }); } catch {}

    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_path:  modelPath,
        mmproj_path: multimodal ? mmprojPath : '',
        gpu_type:    selectedGPU,
        ngl:         parseInt(document.getElementById('ngl').value)         || 99,
        port_bridge: parseInt(document.getElementById('port-bridge').value) || 8000,
        port_model:  parseInt(document.getElementById('port-model').value)  || 8081,
      })
    });

    if (!res.ok) { showError('err-0', 'Could not save config. Is the server running?'); return; }

    goTo(1);
    await fetch('/api/boot', { method: 'POST' });
    streamBootLog();
  }

  // ── Boot log SSE ──────────────────────────────────────────────────────────
  function streamBootLog() {
    const logEl   = document.getElementById('boot-log');
    const ring    = document.getElementById('boot-ring');
    const eyebrow = document.getElementById('boot-eyebrow');
    logEl.innerHTML = '';

    const es = new EventSource('/api/boot/log');
    es.onmessage = ({ data: raw }) => {
      const data  = JSON.parse(raw);
      if (data.line !== undefined) {
        const div   = document.createElement('div');
        const lower = data.line.toLowerCase();
        if      (lower.includes('error') || lower.includes('failed')) { div.className='log-err';  div.textContent='✗ '+data.line; }
        else if (lower.includes('warn'))                              { div.className='log-warn'; div.textContent='  '+data.line; }
        else if (lower.includes('load') || lower.includes('layer'))  { div.className='log-info'; div.textContent='› '+data.line; }
        else                                                          {                           div.textContent='  '+data.line; }
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;
      }
      if (data.ready) {
        es.close();
        ring.classList.add('done'); ring.textContent = '✓'; ring.style.display = 'flex';
        eyebrow.textContent = 'All systems go';
        const ok = document.createElement('div');
        ok.className = 'log-ok'; ok.textContent = '✓ Server is ready';
        logEl.appendChild(ok); logEl.scrollTop = logEl.scrollHeight;
        document.getElementById('boot-next-row').style.display = 'flex';
      }
    };
    es.onerror = () => {
      es.close();
      showError('err-1', 'Lost connection to boot log. Check your terminal for output.');
    };
  }

  // ── Errors ────────────────────────────────────────────────────────────────
  function showError(id, msg) { const e=document.getElementById(id); e.textContent=msg; e.classList.add('visible'); }
  function clearError(id)     { const e=document.getElementById(id); e.textContent='';  e.classList.remove('visible'); }

  // ── Init (GPU detect only — no file scan) ─────────────────────────────────
  async function init() {
    try {
      const res  = await fetch('/api/scan');
      const data = await res.json();
      if (data.gpu_detected) setDetectedGPU(data.gpu_detected);
    } catch (e) { /* non-critical — GPU chips are still clickable */ }
  }

  document.addEventListener('DOMContentLoaded', init);
