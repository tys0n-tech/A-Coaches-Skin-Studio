// Apple macOS-style Frosted-Glass Color Picker enhancer for <input type="color">.
// Keeps the native <input type="color"> in the DOM (visually hidden) so all existing
// JS code, .value reads/writes, input events, and tests keep working 100%.

const enhanced = new WeakMap();
let activePopover = null;

const STUDIO_PRESETS = [
  { hex: '#f2f4f7', name: 'ขาวมุก' },
  { hex: '#8e8e93', name: 'เงินไทเทเนียม' },
  { hex: '#1d1d1f', name: 'ดำเงา' },
  { hex: '#0071e3', name: 'น้ำเงิน Apple' },
  { hex: '#163a70', name: 'น้ำเงินเข้ม' },
  { hex: '#c91f28', name: 'แดงเข้ม' },
  { hex: '#f5a623', name: 'เหลืองทอง' },
  { hex: '#28a745', name: 'เขียวมรกต' }
];

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function normalizeHex(raw) {
  const s = String(raw || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) {
    return '#' + s.split('').map(c => c + c).join('').toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(s)) return '#' + s.toLowerCase();
  return null;
}

function hexToRgb(hex) {
  const norm = normalizeHex(hex) || '#f2f4f7';
  const n = parseInt(norm.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  const to2 = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function rgbToHsv(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

function closeActivePopover(restoreFocus = false) {
  if (!activePopover) return;
  const { popover, trigger, cleanup } = activePopover;
  activePopover = null;
  cleanup();
  trigger.classList.remove('open');
  trigger.setAttribute('aria-expanded', 'false');
  popover.classList.remove('visible');
  setTimeout(() => popover.remove(), 170);
  if (restoreFocus) trigger.focus({ preventScroll: true });
}

function syncTrigger(input) {
  const state = enhanced.get(input);
  if (!state) return;
  const hex = normalizeHex(input.value) || '#f2f4f7';
  state.dot.style.background = hex;
  state.trigger.title = `เลือกสีเอง (${hex.toUpperCase()})`;
  if (activePopover && activePopover.input === input && !activePopover.internalWrite) {
    activePopover.syncFromHex(hex);
  }
}

function openPopoverFor(input) {
  const state = enhanced.get(input);
  if (!state || input.disabled) return;
  const { trigger } = state;

  if (activePopover && activePopover.input === input) {
    closeActivePopover(false);
    return;
  }
  closeActivePopover(false);

  const initHex = normalizeHex(input.value) || '#f2f4f7';
  const initRgb = hexToRgb(initHex);
  const hsv = rgbToHsv(initRgb.r, initRgb.g, initRgb.b);

  const popover = document.createElement('div');
  popover.className = 'apple-color-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'เลือกสีของแต่ง');

  popover.innerHTML = `
    <div class="acp-head">
      <div class="acp-head-left">
        <span class="acp-preview-dot"></span>
        <span class="acp-title">เลือกสีของแต่ง</span>
      </div>
      <div class="acp-head-actions">
        <button type="button" class="acp-icon-btn acp-eyedropper" title="ดูดสีจากหน้าจอ">
          <svg viewBox="0 0 24 24"><path d="m19 5-4-4-2.5 2.5 1.3 1.3-8.6 8.6a2 2 0 0 0-.5 1L4 19l4.6-.7a2 2 0 0 0 1-.5l8.6-8.6 1.3 1.3L22 8l-3-3Z"/><path d="m12.5 6.5 5 5"/></svg>
        </button>
        <button type="button" class="acp-icon-btn acp-close" title="ปิด (Esc)">
          <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <div class="acp-spectrum" tabindex="0" aria-label="ปรับความอิ่มตัวและความสว่าง">
      <div class="acp-spectrum-white"></div>
      <div class="acp-spectrum-black"></div>
      <div class="acp-spectrum-thumb"></div>
    </div>

    <div class="acp-hue-row">
      <div class="acp-hue-track" tabindex="0" aria-label="ปรับโทนสี">
        <div class="acp-hue-thumb"></div>
      </div>
    </div>

    <div class="acp-inputs">
      <label class="acp-field acp-field-hex">
        <span class="acp-field-prefix">#</span>
        <input type="text" class="acp-hex" maxlength="7" spellcheck="false" autocomplete="off" aria-label="รหัสสี HEX" />
        <span class="acp-field-cap">HEX</span>
      </label>
      <label class="acp-field">
        <input type="number" class="acp-rgb acp-r" min="0" max="255" aria-label="Red" />
        <span class="acp-field-cap">R</span>
      </label>
      <label class="acp-field">
        <input type="number" class="acp-rgb acp-g" min="0" max="255" aria-label="Green" />
        <span class="acp-field-cap">G</span>
      </label>
      <label class="acp-field">
        <input type="number" class="acp-rgb acp-b" min="0" max="255" aria-label="Blue" />
        <span class="acp-field-cap">B</span>
      </label>
    </div>

    <div class="acp-presets"></div>
  `;

  const previewDot = popover.querySelector('.acp-preview-dot');
  const eyedropperBtn = popover.querySelector('.acp-eyedropper');
  const closeBtn = popover.querySelector('.acp-close');
  const spectrumEl = popover.querySelector('.acp-spectrum');
  const spectrumThumb = popover.querySelector('.acp-spectrum-thumb');
  const hueTrack = popover.querySelector('.acp-hue-track');
  const hueThumb = popover.querySelector('.acp-hue-thumb');
  const hexInput = popover.querySelector('.acp-hex');
  const rInput = popover.querySelector('.acp-r');
  const gInput = popover.querySelector('.acp-g');
  const bInput = popover.querySelector('.acp-b');
  const presetsWrap = popover.querySelector('.acp-presets');

  if (typeof window.EyeDropper !== 'function') eyedropperBtn.hidden = true;

  const presetBtns = [];
  for (const preset of STUDIO_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'acp-preset';
    btn.style.setProperty('--sw', preset.hex);
    btn.dataset.hex = preset.hex;
    btn.title = preset.name;
    btn.addEventListener('click', () => {
      applyHex(preset.hex, true);
    });
    presetsWrap.append(btn);
    presetBtns.push(btn);
  }

  let internalWrite = false;
  const controller = { input, popover, trigger, cleanup: () => {}, get internalWrite() { return internalWrite; }, syncFromHex };

  function renderUI(skipTextFocus = false) {
    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    const hueColor = `hsl(${Math.round(hsv.h)}, 100%, 50%)`;

    spectrumEl.style.backgroundColor = hueColor;
    spectrumThumb.style.left = `${(hsv.s * 100).toFixed(2)}%`;
    spectrumThumb.style.top = `${((1 - hsv.v) * 100).toFixed(2)}%`;
    spectrumThumb.style.backgroundColor = hex;

    hueThumb.style.left = `${((hsv.h / 360) * 100).toFixed(2)}%`;
    hueThumb.style.backgroundColor = hueColor;

    previewDot.style.backgroundColor = hex;

    if (!skipTextFocus || document.activeElement !== hexInput) {
      hexInput.value = hex.slice(1).toUpperCase();
    }
    if (!skipTextFocus || document.activeElement !== rInput) rInput.value = String(rgb.r);
    if (!skipTextFocus || document.activeElement !== gInput) gInput.value = String(rgb.g);
    if (!skipTextFocus || document.activeElement !== bInput) bInput.value = String(rgb.b);

    presetBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.hex === hex));
    return hex;
  }

  function emitChange(hex) {
    internalWrite = true;
    input.value = hex;
    internalWrite = false;
    state.dot.style.background = hex;
    state.trigger.title = `เลือกสีเอง (${hex.toUpperCase()})`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyHex(rawHex, emit = true) {
    const norm = normalizeHex(rawHex);
    if (!norm) return;
    const rgb = hexToRgb(norm);
    const next = rgbToHsv(rgb.r, rgb.g, rgb.b);
    // Preserve hue if color is achromatic (white/gray/black)
    if (next.s > 0.001 && next.v > 0.001) hsv.h = next.h;
    hsv.s = next.s;
    hsv.v = next.v;
    const hex = renderUI(true);
    if (emit) emitChange(hex);
  }

  function syncFromHex(rawHex) {
    applyHex(rawHex, false);
  }

  // 2D Spectrum dragging
  function updateSpectrumFromEvent(e) {
    const rect = spectrumEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    hsv.s = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    hsv.v = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
    const hex = renderUI(false);
    emitChange(hex);
  }
  spectrumEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    spectrumEl.setPointerCapture(e.pointerId);
    updateSpectrumFromEvent(e);
  });
  spectrumEl.addEventListener('pointermove', (e) => {
    if (spectrumEl.hasPointerCapture(e.pointerId)) updateSpectrumFromEvent(e);
  });

  // Rainbow Hue Slider dragging
  function updateHueFromEvent(e) {
    const rect = hueTrack.getBoundingClientRect();
    if (!rect.width) return;
    hsv.h = clamp((e.clientX - rect.left) / rect.width, 0, 1) * 359.9;
    const hex = renderUI(false);
    emitChange(hex);
  }
  hueTrack.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hueTrack.setPointerCapture(e.pointerId);
    updateHueFromEvent(e);
  });
  hueTrack.addEventListener('pointermove', (e) => {
    if (hueTrack.hasPointerCapture(e.pointerId)) updateHueFromEvent(e);
  });

  // HEX input
  hexInput.addEventListener('input', () => {
    const clean = hexInput.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    if (clean.length === 6) {
      applyHex('#' + clean, true);
    }
  });
  hexInput.addEventListener('blur', () => {
    const norm = normalizeHex(hexInput.value);
    if (norm) applyHex(norm, true);
    else renderUI(false);
  });
  hexInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const norm = normalizeHex(hexInput.value);
      if (norm) applyHex(norm, true);
      hexInput.blur();
    }
  });

  // RGB inputs
  function onRgbInput() {
    const r = clamp(Number(rInput.value) || 0, 0, 255);
    const g = clamp(Number(gInput.value) || 0, 0, 255);
    const b = clamp(Number(bInput.value) || 0, 0, 255);
    const next = rgbToHsv(r, g, b);
    if (next.s > 0.001 && next.v > 0.001) hsv.h = next.h;
    hsv.s = next.s;
    hsv.v = next.v;
    const hex = renderUI(true);
    emitChange(hex);
  }
  rInput.addEventListener('input', onRgbInput);
  gInput.addEventListener('input', onRgbInput);
  bInput.addEventListener('input', onRgbInput);

  // Native Chromium EyeDropper (sample directly from 3D truck skin!)
  eyedropperBtn.addEventListener('click', async () => {
    if (typeof window.EyeDropper !== 'function') return;
    try {
      const dropper = new window.EyeDropper();
      const result = await dropper.open();
      if (result?.sRGBHex) applyHex(result.sRGBHex, true);
    } catch {
      // User cancelled eyedropper
    }
  });

  closeBtn.addEventListener('click', () => closeActivePopover(true));

  renderUI(false);
  document.body.append(popover);

  // Smart positioning (open above or below trigger, clamped cleanly inside window)
  const rect = trigger.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - 12;
  const spaceAbove = rect.top - 12;
  const flipUp = spaceBelow < popRect.height && spaceAbove > spaceBelow;

  const top = flipUp
    ? Math.max(10, rect.top - popRect.height - 8)
    : Math.min(window.innerHeight - popRect.height - 10, rect.bottom + 8);
  let left = rect.right - popRect.width;
  if (left < 10) left = 10;
  if (left + popRect.width > window.innerWidth - 10) {
    left = Math.max(10, window.innerWidth - popRect.width - 10);
  }

  popover.style.top = `${Math.round(top)}px`;
  popover.style.left = `${Math.round(left)}px`;
  popover.classList.toggle('flip-up', flipUp);

  trigger.classList.add('open');
  trigger.setAttribute('aria-expanded', 'true');

  requestAnimationFrame(() => popover.classList.add('visible'));

  const onPointerDown = (e) => {
    if (!popover.contains(e.target) && !trigger.contains(e.target)) closeActivePopover(false);
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeActivePopover(true);
    }
  };
  const onResize = () => closeActivePopover(false);

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onResize);

  controller.cleanup = () => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', onResize);
  };

  activePopover = controller;
}

export function enhanceColorInput(input) {
  if (!input || input.tagName !== 'INPUT' || input.type !== 'color' || enhanced.has(input)) return;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'apple-color-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.title = input.title || 'เลือกสีเอง';

  const dot = document.createElement('span');
  dot.className = 'apple-color-trigger-dot';
  trigger.append(dot);

  input.classList.add('native-select-hidden');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  input.insertAdjacentElement('afterend', trigger);

  enhanced.set(input, { trigger, dot });

  // Intercept programmatic .value writes so trigger + open popover stay 100% synced
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (desc) {
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(val) {
        desc.set.call(this, val);
        syncTrigger(this);
      }
    });
  }

  input.addEventListener('input', () => syncTrigger(input));
  input.addEventListener('change', () => syncTrigger(input));

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPopoverFor(input);
  });

  if (input.id) {
    document.querySelectorAll(`label[for="${CSS.escape(input.id)}"]`).forEach(lbl => {
      lbl.addEventListener('click', (e) => {
        e.preventDefault();
        openPopoverFor(input);
      });
    });
  }

  syncTrigger(input);
}

export function initAppleColorPickers() {
  document.querySelectorAll('input[type="color"]').forEach(enhanceColorInput);
}
