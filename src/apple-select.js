// Apple macOS-style Pop-Up Menu enhancer for every <select> in the app.
// Keeps the native <select> in the DOM (visually hidden) so all existing JS
// code, tests, value/disabled assignments, and change events keep working 100%.

const enhanced = new WeakMap();
let activePortal = null;

function closeActiveMenu(restoreFocus = false) {
  if (!activePortal) return;
  const { menu, trigger, cleanup } = activePortal;
  activePortal = null;
  cleanup();
  trigger.classList.remove('open');
  trigger.setAttribute('aria-expanded', 'false');
  menu.classList.remove('visible');
  setTimeout(() => menu.remove(), 160);
  if (restoreFocus) trigger.focus({ preventScroll: true });
}

function getSelectedLabel(select) {
  const opt = select.selectedOptions?.[0] || select.options?.[select.selectedIndex] || select.options?.[0];
  return opt ? opt.textContent.trim() : '';
}

function syncTrigger(select) {
  const state = enhanced.get(select);
  if (!state) return;
  const { trigger, labelEl } = state;
  labelEl.textContent = getSelectedLabel(select) || '—';
  trigger.disabled = Boolean(select.disabled);
  trigger.classList.toggle('is-disabled', Boolean(select.disabled));
}

function openMenuFor(select) {
  const state = enhanced.get(select);
  if (!state || select.disabled || !select.options.length) return;
  const { trigger } = state;

  if (activePortal && activePortal.select === select) {
    closeActiveMenu(false);
    return;
  }
  closeActiveMenu(false);

  const menu = document.createElement('div');
  menu.className = 'apple-select-menu';
  menu.setAttribute('role', 'listbox');

  let activeIdx = Math.max(0, select.selectedIndex);
  const items = [];

  for (let i = 0; i < select.options.length; i++) {
    const opt = select.options[i];
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'apple-select-item';
    item.setAttribute('role', 'option');
    const isSelected = i === select.selectedIndex;
    item.setAttribute('aria-selected', String(isSelected));
    if (isSelected) item.classList.add('selected');
    if (opt.disabled) item.disabled = true;

    const check = document.createElement('span');
    check.className = 'apple-select-check';
    check.innerHTML = isSelected
      ? '<svg viewBox="0 0 16 16"><path d="M3.2 8.4 6.5 11.7 12.8 4.6"/></svg>'
      : '';

    const text = document.createElement('span');
    text.className = 'apple-select-text';
    text.textContent = opt.textContent;

    item.append(check, text);
    item.addEventListener('mouseenter', () => setFocusedIndex(i));
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (opt.disabled) return;
      const changed = select.selectedIndex !== i;
      select.selectedIndex = i;
      syncTrigger(select);
      closeActiveMenu(true);
      if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    items.push(item);
    menu.append(item);
  }

  function setFocusedIndex(idx) {
    activeIdx = Math.max(0, Math.min(items.length - 1, idx));
    items.forEach((el, k) => el.classList.toggle('focused', k === activeIdx));
  }

  document.body.append(menu);

  // Smart positioning (below trigger, or flip upward if near bottom edge)
  const rect = trigger.getBoundingClientRect();
  const minW = Math.max(rect.width, 168);
  const maxW = Math.min(360, window.innerWidth - 16);
  menu.style.minWidth = `${minW}px`;
  menu.style.maxWidth = `${maxW}px`;

  const menuRect = menu.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - 10;
  const spaceAbove = rect.top - 10;
  const flipUp = spaceBelow < Math.min(menuRect.height, 260) && spaceAbove > spaceBelow;

  const availH = Math.max(120, Math.min(320, flipUp ? spaceAbove : spaceBelow));
  menu.style.maxHeight = `${availH}px`;

  const actualH = Math.min(menuRect.height, availH);
  const top = flipUp ? Math.max(8, rect.top - actualH - 6) : Math.min(window.innerHeight - actualH - 8, rect.bottom + 6);
  let left = rect.left;
  if (left + Math.max(minW, menuRect.width) > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - Math.max(minW, menuRect.width) - 8);
  }
  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;
  menu.classList.toggle('flip-up', flipUp);

  trigger.classList.add('open');
  trigger.setAttribute('aria-expanded', 'true');
  setFocusedIndex(activeIdx);

  requestAnimationFrame(() => {
    menu.classList.add('visible');
    const selEl = items[select.selectedIndex];
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  });

  const onPointerDown = (e) => {
    if (!menu.contains(e.target) && !trigger.contains(e.target)) closeActiveMenu(false);
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeActiveMenu(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((activeIdx + 1) % items.length);
      items[activeIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((activeIdx - 1 + items.length) % items.length);
      items[activeIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      items[activeIdx]?.click();
    } else if (e.key === 'Tab') {
      closeActiveMenu(false);
    }
  };
  const onScrollOrResize = (e) => {
    if (e?.target && menu.contains(e.target)) return;
    closeActiveMenu(false);
  };

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onScrollOrResize);
  window.addEventListener('scroll', onScrollOrResize, true);

  activePortal = {
    select,
    menu,
    trigger,
    cleanup: () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    }
  };
}

export function enhanceSelect(select) {
  if (!select || select.tagName !== 'SELECT' || enhanced.has(select)) return;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'apple-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  if (select.getAttribute('aria-label')) trigger.setAttribute('aria-label', select.getAttribute('aria-label'));

  const labelEl = document.createElement('span');
  labelEl.className = 'apple-select-label';

  const chevron = document.createElement('span');
  chevron.className = 'apple-select-chevron';
  chevron.innerHTML = '<svg viewBox="0 0 16 16"><path d="M5 6.2 8 3.2l3 3M5 9.8l3 3 3-3"/></svg>';

  trigger.append(labelEl, chevron);
  select.classList.add('native-select-hidden');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.insertAdjacentElement('afterend', trigger);

  enhanced.set(select, { trigger, labelEl });

  // Intercept programmatic .value / .selectedIndex / .disabled writes so UI stays 100% synced
  const proto = HTMLSelectElement.prototype;
  for (const prop of ['value', 'selectedIndex', 'disabled']) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc) continue;
    Object.defineProperty(select, prop, {
      configurable: true,
      get() { return desc.get.call(this); },
      set(val) {
        desc.set.call(this, val);
        syncTrigger(this);
      }
    });
  }

  select.addEventListener('change', () => syncTrigger(select));

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openMenuFor(select);
  });
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenuFor(select);
    }
  });

  // Watch option additions/replacements and disabled attribute changes
  const observer = new MutationObserver(() => syncTrigger(select));
  observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'], characterData: true });

  // Connect matching <label for="..."> clicks to focus/open the Apple trigger
  if (select.id) {
    document.querySelectorAll(`label[for="${CSS.escape(select.id)}"]`).forEach(lbl => {
      lbl.addEventListener('click', (e) => {
        e.preventDefault();
        if (!select.disabled) trigger.focus();
      });
    });
  }

  syncTrigger(select);
}

export function initAppleSelects() {
  document.querySelectorAll('select').forEach(enhanceSelect);
  // Automatically enhance dynamically created <select> elements (e.g. #mappingRows)
  const docObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'SELECT') enhanceSelect(node);
        else node.querySelectorAll?.('select').forEach(enhanceSelect);
      }
    }
  });
  docObserver.observe(document.body, { childList: true, subtree: true });
}
