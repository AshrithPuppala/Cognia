/**
 * Cognia — Page Mapper (Advanced)
 * ---------------------------------------------------------------------------
 * Upgraded to pierce Shadow DOMs, detect z-index occlusion (popups/modals),
 * and track ARIA expansion states for complex accordions.
 */
(function (global) {
  'use strict';

  const ID_ATTR = 'data-cognia-id';
  let idCounter = 0;

  function nextId() {
    idCounter += 1;
    return `cognia-el-${idCounter}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function ensureId(el) {
    let id = el.getAttribute(ID_ATTR);
    if (!id) {
      id = el.id ? `cognia-${el.id}` : nextId();
      el.setAttribute(ID_ATTR, id);
    }
    return id;
  }

  // -- Element discovery (Now with Shadow DOM piercing) -------------------

  const INTERACTIVE_SELECTOR = [
    'button', 'a[href]', 'input:not([type="hidden"])', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="combobox"]', '[role="textbox"]', '[role="switch"]', '[role="tab"]',
    '[role="menuitem"]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function findInteractiveElements(root) {
    let elements = [];
    
    // 1. Get standard DOM elements
    elements.push(...Array.from(root.querySelectorAll(INTERACTIVE_SELECTOR)));
    
    // 2. Recursively find and pierce Shadow DOMs
    const allNodes = root.querySelectorAll('*');
    for (const node of allNodes) {
      if (node.shadowRoot) {
        elements.push(...findInteractiveElements(node.shadowRoot));
      }
    }
    
    // De-dupe
    return Array.from(new Set(elements));
  }

  // -- Role -----------------------------------------------------------------

  function getRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;

    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      const map = { checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button', reset: 'button', range: 'slider', email: 'textbox', password: 'textbox', search: 'textbox', tel: 'textbox', url: 'textbox', number: 'spinbutton', date: 'textbox', text: 'textbox' };
      return map[type] || 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return 'generic';
  }

  // -- Label ------------------------------------------------------------

  function textOf(node) {
    return (node && node.textContent ? node.textContent : '').replace(/\s+/g, ' ').trim();
  }

  function getLabel(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const doc = el.ownerDocument || document;
      const text = labelledBy.split(/\s+/).map((id) => {
        const ref = doc.getElementById(id);
        return ref ? textOf(ref) : '';
      }).filter(Boolean).join(' ');
      if (text) return text;
    }

    if (el.id) {
      const doc = el.ownerDocument || document;
      const forLabel = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (forLabel) return textOf(forLabel);
    }

    const wrappingLabel = el.closest('label');
    if (wrappingLabel) {
      const clone = wrappingLabel.cloneNode(true);
      clone.querySelectorAll('input, select, textarea').forEach((n) => n.remove());
      const text = textOf(clone);
      if (text) return text;
    }

    const ownText = textOf(el);
    if (ownText) return ownText;

    const fallback = el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('value');
    if (fallback && fallback.trim()) return fallback.trim();

    return null;
  }

  // -- State ------------------------------------------------------------

  function isDisabled(el) {
    if (el.disabled) return true;
    if (el.closest('fieldset[disabled]')) return true;
    if (el.getAttribute('aria-disabled') === 'true') return true;
    return false;
  }

  function getState(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    
    // Detect Accordion / Menu expanded states
    const ariaExpanded = el.getAttribute('aria-expanded');
    let expanded = null;
    if (ariaExpanded === 'true') expanded = true;
    if (ariaExpanded === 'false') expanded = false;

    const state = {
      disabled: isDisabled(el),
      filled: false,
      required: !!el.required || el.getAttribute('aria-required') === 'true',
      readOnly: !!el.readOnly,
      focused: el === (el.ownerDocument || document).activeElement,
      expanded: expanded,
      checked: null,
      selectedOptionText: null
    };

    if (tag === 'select') {
      const opt = el.options[el.selectedIndex] || null;
      state.selectedOptionText = opt ? opt.textContent.trim() : null;
      state.filled = !!(opt && opt.value !== '');
    } else if (type === 'checkbox' || type === 'radio') {
      state.checked = !!el.checked;
      state.filled = !!el.checked;
    } else if (el.getAttribute('role') === 'switch') {
       state.checked = el.getAttribute('aria-checked') === 'true';
       state.filled = true;
    } else if (tag === 'textarea' || tag === 'input') {
      state.filled = el.value != null && String(el.value).trim() !== '';
    } else if (el.isContentEditable) {
      state.filled = textOf(el).length > 0;
    }

    return state;
  }

  function getValue(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return !!el.checked;
    if (el.getAttribute('role') === 'switch') return el.getAttribute('aria-checked') === 'true';
    if (tag === 'select' || tag === 'textarea' || tag === 'input') {
      return el.value != null ? String(el.value) : null;
    }
    if (el.isContentEditable) return textOf(el);
    return null;
  }

  // -- Geometry / Visibility / Occlusion -----------------------------------

  function getRect(el) {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  function isVisible(el, rect) {
    const doc = el.ownerDocument || document;
    const style = doc.defaultView.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }
    if (el.hidden) return false;
    if (rect.width === 0 || rect.height === 0) return false;
    return true;
  }

  function isObscured(el, rect, visible) {
    if (!visible) return false; // Irrelevant if not visible
    const doc = el.ownerDocument || document;
    
    // Check the center point of the element
    const centerX = rect.x + (rect.width / 2);
    const centerY = rect.y + (rect.height / 2);

    // If point is outside viewport, it's not strictly obscured, just off-screen
    const win = doc.defaultView;
    if (centerX < 0 || centerX > win.innerWidth || centerY < 0 || centerY > win.innerHeight) {
        return false; 
    }

    const topmostElement = doc.elementFromPoint(centerX, centerY);
    if (!topmostElement) return false;

    // It is obscured if the topmost element is NOT the element itself, 
    // AND NOT a child of the element, AND NOT a parent (like a transparent wrapper).
    const isSelfOrDescendant = el.contains(topmostElement);
    const isAncestor = topmostElement.contains(el);
    
    return !isSelfOrDescendant && !isAncestor;
  }

  // -- Element -> schema record --------------------------------------------

  function describeElement(el) {
    const rect = getRect(el);
    const visible = isVisible(el, rect);
    const obscured = isObscured(el, rect, visible);
    const state = getState(el);

    return {
      id: ensureId(el),
      tag: el.tagName.toLowerCase(),
      role: getRole(el),
      label: getLabel(el),
      placeholder: el.getAttribute ? el.getAttribute('placeholder') : null,
      value: getValue(el),
      state,
      rect,
      visible,
      obscured,
      interactable: visible && !obscured && !state.disabled && rect.width > 0 && rect.height > 0
    };
  }
  // -- Element Targeting & Fuzzy Matching -----------------------------------

  function findFieldFuzzy(keywords) {
    const lowerKeywords = keywords.map(kw => kw.toLowerCase());
    const doc = global.document || document;

    const matchesKeyword = (text) => {
      if (!text) return false;
      const lowerText = text.toLowerCase();
      return lowerKeywords.some(kw => lowerText.includes(kw));
    };

    // Strategy 1: Standard 'autocomplete' attribute
    for (const kw of lowerKeywords) {
      const autoEl = doc.querySelector(`input[autocomplete="${CSS.escape(kw)}"]`);
      if (autoEl) return autoEl;
    }

    // Strategy 2 & 3: Labels (<label for="..."> and wrapping <label>...<input></label>)
    const labels = doc.querySelectorAll('label');
    for (const label of labels) {
      if (matchesKeyword(label.textContent)) {
        const forId = label.getAttribute('for');
        if (forId) {
          const input = doc.getElementById(forId);
          if (input) return input;
        }
        
        const wrappedInput = label.querySelector('input, select, textarea');
        if (wrappedInput) return wrappedInput;
      }
    }

    // Strategy 4: Placeholder and Aria-Label text
    const inputs = doc.querySelectorAll('input, select, textarea');
    for (const input of inputs) {
      if (
        matchesKeyword(input.getAttribute('placeholder')) || 
        matchesKeyword(input.getAttribute('aria-label'))
      ) {
        return input;
      }
    }

    return null;
  }
  // -- Public API: getPageState -------------------------------------------

  function getPageState(goal) {
    const doc = global.document;
    const win = global.window || global;

    const elements = findInteractiveElements(doc).map(describeElement);

    return {
      goal: goal || null,
      url: doc.location ? doc.location.href : '',
      title: doc.title || '',
      timestamp: new Date().toISOString(),
      viewport: {
        width: win.innerWidth || doc.documentElement.clientWidth,
        height: win.innerHeight || doc.documentElement.clientHeight,
        scrollX: win.scrollX || 0,
        scrollY: win.scrollY || 0
      },
      elements
    };
  }

  // -- Watching for changes: MutationObserver ------------------------------

  const listeners = new Set();
  let observer = null;
  let lastGoal = null;
  let debounceTimer = null;

  function notify(state) {
    listeners.forEach((cb) => {
      try { cb(state); } catch (err) { console.error('[Cognia.PageMapper]', err); }
    });

    if (global.document && typeof CustomEvent !== 'undefined') {
      global.document.dispatchEvent(new CustomEvent('cognia:page-state', { detail: state }));
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try { chrome.runtime.sendMessage({ type: 'cognia:page-state', state }); } catch (e) {}
    }
  }

  function rescanAndNotify(goal) {
    notify(getPageState(goal !== undefined ? goal : lastGoal));
  }

  function startWatching(goal, { debounceMs = 250 } = {}) {
    lastGoal = goal || null;
    if (observer) return;

    observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => rescanAndNotify(lastGoal), debounceMs);
    });

    observer.observe(global.document.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['value', 'checked', 'selected', 'disabled', 'hidden', 'class', 'style', 'aria-checked', 'aria-expanded'],
      characterData: true
    });

    global.document.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => rescanAndNotify(lastGoal), debounceMs);
    }, true);
    
    global.document.addEventListener('change', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => rescanAndNotify(lastGoal), debounceMs);
    }, true);

    rescanAndNotify(lastGoal);
  }

  function stopWatching() {
    if (observer) { observer.disconnect(); observer = null; }
    clearTimeout(debounceTimer);
  }

  function onPageState(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  // -- Input ports ---------------------------------------------------------

  if (global.document) {
    global.document.addEventListener('cognia:request-page-state', (e) => {
      notify(getPageState(e && e.detail ? e.detail.goal : null));
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'cognia:request-page-state') {
        const state = getPageState(msg.goal);
        sendResponse(state);
        notify(state);
      }
      return true;
    });
  }

  // -- Expose -------------------------------------------------------------

  const PageMapper = { getPageState, startWatching, stopWatching, onPageState, findFieldFuzzy };
  global.Cognia = global.Cognia || {};
  global.Cognia.PageMapper = PageMapper;
  if (typeof module !== 'undefined' && module.exports) module.exports = PageMapper;

})(typeof window !== 'undefined' ? window : globalThis);
