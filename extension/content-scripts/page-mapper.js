/**
 * Cognia — Page Mapper
 * ---------------------------------------------------------------------------
 * Role in the pipeline: "the system's eyes". Scans the live DOM, finds every
 * interactive element, and emits a strict JSON PageState object that matches
 * ./schema/page-state.schema.json.
 *
 * This file is written to be dropped in as a Chrome extension content script,
 * but it does not assume anything about the rest of the pipeline. It only
 * exposes two kinds of "ports" so Person 4's orchestrator (or anything else)
 * can plug into it without this file needing to know who's listening:
 *
 *   INPUT ports (ways to ask the mapper to scan):
 *     1. Direct call:      Cognia.PageMapper.getPageState(goal)
 *     2. DOM event:        document.dispatchEvent(new CustomEvent(
 *                             'cognia:request-page-state', { detail: { goal } }))
 *     3. Extension message: chrome.runtime.sendMessage({ type: 'cognia:request-page-state', goal })
 *
 *   OUTPUT ports (ways the mapper announces a new scan, e.g. after a
 *   MutationObserver-triggered rescan):
 *     1. DOM event:        document.addEventListener('cognia:page-state', (e) => e.detail)
 *     2. Callback registry: Cognia.PageMapper.onPageState((state) => { ... })
 *     3. Extension message: chrome.runtime.sendMessage({ type: 'cognia:page-state', state })
 *       (only fires if chrome.runtime is available, i.e. running as an extension)
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const ID_ATTR = 'data-cognia-id';
  let idCounter = 0;

  function nextId() {
    idCounter += 1;
    return `cognia-el-${idCounter}-${Math.random().toString(36).slice(2, 7)}`;
  }

  /** Ensures the element has a stable, unique id and returns it. */
  function ensureId(el) {
    let id = el.getAttribute(ID_ATTR);
    if (!id) {
      id = el.id ? `cognia-${el.id}` : nextId();
      el.setAttribute(ID_ATTR, id);
    }
    return id;
  }

  // -- Element discovery -------------------------------------------------

  const INTERACTIVE_SELECTOR = [
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="combobox"]',
    '[role="textbox"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function findInteractiveElements(root) {
    const nodes = Array.from(root.querySelectorAll(INTERACTIVE_SELECTOR));
    // De-dupe (an element could match more than one selector clause).
    return Array.from(new Set(nodes));
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
      const map = {
        checkbox: 'checkbox',
        radio: 'radio',
        submit: 'button',
        button: 'button',
        reset: 'button',
        range: 'slider',
        email: 'textbox',
        password: 'textbox',
        search: 'textbox',
        tel: 'textbox',
        url: 'textbox',
        number: 'spinbutton',
        date: 'textbox',
        text: 'textbox'
      };
      return map[type] || 'textbox';
    }
    if (isEditable(el)) return 'textbox';
    return 'generic';
  }

  // -- Label ------------------------------------------------------------

  function textOf(node) {
    return (node && node.textContent ? node.textContent : '').replace(/\s+/g, ' ').trim();
  }

  /**
   * More robust than relying solely on el.isContentEditable, which some
   * environments don't populate reliably even when the contenteditable
   * attribute is present (e.g. certain headless/test DOMs).
   */
  function isEditable(el) {
    if (el.isContentEditable) return true;
    const attr = el.getAttribute && el.getAttribute('contenteditable');
    return attr === 'true' || attr === '';
  }

  function getLabel(el) {
    // 1. aria-label wins outright.
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    // 2. aria-labelledby references.
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => textOf(el.ownerDocument.getElementById(id)))
        .filter(Boolean)
        .join(' ');
      if (text) return text;
    }

    // 3. <label for="id">.
    if (el.id) {
      const forLabel = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (forLabel) {
        const text = textOf(forLabel);
        if (text) return text;
      }
    }

    // 4. Wrapping <label>.
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) {
      const clone = wrappingLabel.cloneNode(true);
      // Drop the input's own text/value so we don't capture "Full name John".
      clone.querySelectorAll('input, select, textarea').forEach((n) => n.remove());
      const text = textOf(clone);
      if (text) return text;
    }

    // 5. Button/link visible text.
    const ownText = textOf(el);
    if (ownText) return ownText;

    // 6. Placeholder / title / alt / value as a last resort.
    const fallback =
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      el.getAttribute('value');
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

    const state = {
      disabled: isDisabled(el),
      filled: false,
      required: !!el.required || el.getAttribute('aria-required') === 'true',
      readOnly: !!el.readOnly,
      focused: el === el.ownerDocument.activeElement,
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
    } else if (tag === 'textarea' || tag === 'input') {
      state.filled = el.value != null && String(el.value).trim() !== '';
    } else if (isEditable(el)) {
      state.filled = textOf(el).length > 0;
    }

    return state;
  }

  function getValue(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return !!el.checked;
    if (tag === 'select' || tag === 'textarea' || tag === 'input') {
      return el.value != null ? String(el.value) : null;
    }
    if (isEditable(el)) return textOf(el);
    return null;
  }

  // -- Geometry / visibility ----------------------------------------------

  function getRect(el) {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  function isVisible(el, rect) {
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }
    if (el.hidden) return false;
    if (rect.width === 0 && rect.height === 0) return false;
    return true;
  }

  // -- Element -> schema record --------------------------------------------

  function describeElement(el) {
    const rect = getRect(el);
    const visible = isVisible(el, rect);
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
      interactable: visible && !state.disabled && rect.width > 0 && rect.height > 0
    };
  }

  // -- Public API: getPageState -------------------------------------------

  /**
   * Scans the current document and returns a PageState object matching
   * page-state.schema.json.
   * @param {string|null} goal - the user's current task, echoed back in the output.
   */
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
      try {
        cb(state);
      } catch (err) {
        console.error('[Cognia.PageMapper] listener error:', err);
      }
    });

    if (global.document && typeof CustomEvent !== 'undefined') {
      global.document.dispatchEvent(new CustomEvent('cognia:page-state', { detail: state }));
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({ type: 'cognia:page-state', state });
      } catch (err) {
        // No active extension context (e.g. running in a plain tab/test page) — ignore.
      }
    }
  }

  function rescanAndNotify(goal) {
    notify(getPageState(goal !== undefined ? goal : lastGoal));
  }

  /**
   * Starts watching the page for DOM changes and rescans (debounced) whenever
   * something changes — a new field appears, a value changes, an attribute
   * flips, etc.
   */
  function startWatching(goal, { debounceMs = 150 } = {}) {
    lastGoal = goal || null;
    if (observer) return; // already watching

    observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => rescanAndNotify(lastGoal), debounceMs);
    });

    observer.observe(global.document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['value', 'checked', 'selected', 'disabled', 'hidden', 'class', 'style', 'aria-checked'],
      characterData: true
    });

    // Text input doesn't always trigger attribute mutations (value is a
    // property, not an attribute), so also listen for live typing/toggling.
    global.document.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => rescanAndNotify(lastGoal), debounceMs);
    }, true);
    global.document.addEventListener('change', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => rescanAndNotify(lastGoal), debounceMs);
    }, true);

    // Fire an initial scan immediately.
    rescanAndNotify(lastGoal);
  }

  function stopWatching() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(debounceTimer);
  }

  function onPageState(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback); // unsubscribe handle
  }

  // -- Input ports: listen for external scan requests ----------------------

  if (global.document) {
    global.document.addEventListener('cognia:request-page-state', (e) => {
      const goal = e && e.detail ? e.detail.goal : null;
      notify(getPageState(goal));
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'cognia:request-page-state') {
        const state = getPageState(msg.goal);
        sendResponse(state);
        notify(state);
      }
      return true; // keep the message channel open for async sendResponse
    });
  }

  // -- Expose -------------------------------------------------------------

  const PageMapper = {
    getPageState,
    startWatching,
    stopWatching,
    onPageState
  };

  global.Cognia = global.Cognia || {};
  global.Cognia.PageMapper = PageMapper;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PageMapper;
  }
})(typeof window !== 'undefined' ? window : globalThis);
