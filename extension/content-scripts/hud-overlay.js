// extension/content-scripts/hud-overlay.js
//
// Cognitive HUD — takes a GuidanceAction and visually transforms the page:
// dims everything except the target element, spotlights it, shows an
// instruction card + step counter, and (new) reads the instruction aloud
// when guidanceAction.read_aloud is true.
//
// STANDALONE TEST MODE:
// The hardcoded MOCK_GUIDANCE_ACTION + the call at the bottom of this file
// let you test renderHUD() with zero dependency on Person 1 (Page Mapper)
// or Person 2 (Backend). Remove both once Person 4 wires this into the
// real orchestration loop.

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // 1. Hardcoded mock — mirror shared/mocks/mock-guidance-action.json here
  //    for standalone testing. Replace with the real file's contents.
  // ---------------------------------------------------------------------
  const MOCK_GUIDANCE_ACTION = {
    step: 2,
    total_steps: 6,
    target_element_id: 'el_13',
    instruction: 'Select the type of licence you want to renew.',
    dim_all_except: ['el_13'],
    support_level: 'normal', // 'normal' | 'elevated' | 'high'
    read_aloud: true,
  };

  // ---------------------------------------------------------------------
  // 2. Constants / config per support_level
  // ---------------------------------------------------------------------
  const SUPPORT_LEVEL_CONFIG = {
    normal: {
      overlayOpacity: 0.75,
      spotlightPadding: 8,
      spotlightGlow: '0 0 0 4px rgba(255,255,255,0.9), 0 0 24px 8px rgba(120,170,255,0.6)',
      cardMaxWidth: 280,
      fontSize: 15,
    },
    elevated: {
      overlayOpacity: 0.85,
      spotlightPadding: 14,
      spotlightGlow: '0 0 0 6px rgba(255,255,255,0.95), 0 0 40px 14px rgba(255,190,90,0.75)',
      cardMaxWidth: 320,
      fontSize: 17,
    },
    high: {
      overlayOpacity: 0.92,
      spotlightPadding: 20,
      spotlightGlow: '0 0 0 8px rgba(255,255,255,1), 0 0 56px 20px rgba(255,110,110,0.85)',
      cardMaxWidth: 340,
      fontSize: 19,
    },
  };

  const OVERLAY_ID = 'cognia-hud-overlay';
  const SPOTLIGHT_ID = 'cognia-hud-spotlight';
  const CARD_ID = 'cognia-hud-card';
  const STEP_ID = 'cognia-hud-step';
  const EXIT_ID = 'cognia-hud-exit';
  const MUTE_ID = 'cognia-hud-mute';
  const MUTE_STORAGE_KEY = '__cogniaMuted';

  let currentTeardown = null;

  // Mute state persists across renderHUD() calls within the same page
  // session (e.g. across Verify & Re-plan re-renders), living on window
  // so it survives even though the overlay itself gets torn down/rebuilt.
  if (typeof window[MUTE_STORAGE_KEY] === 'undefined') {
    window[MUTE_STORAGE_KEY] = false;
  }

  // ---------------------------------------------------------------------
  // 3. Public entry point
  // ---------------------------------------------------------------------
  function renderHUD(guidanceAction) {
    if (!guidanceAction || !guidanceAction.target_element_id) {
      console.warn('[Cognia HUD] renderHUD called with invalid GuidanceAction', guidanceAction);
      return;
    }

    // Clear any previous HUD before rendering a new one.
    teardownHUD();

    // Always cancel any in-flight speech before deciding whether to speak
    // again, so overlapping steps never talk over each other.
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    const config = SUPPORT_LEVEL_CONFIG[guidanceAction.support_level] || SUPPORT_LEVEL_CONFIG.normal;

    const targetEl = document.querySelector(
      `[data-cognia-id="${guidanceAction.target_element_id}"]`
    );

    if (!targetEl) {
      console.warn(
        `[Cognia HUD] target element "${guidanceAction.target_element_id}" not found in DOM.`
      );
      return;
    }

    const overlay = buildOverlay(config);
    const spotlight = buildSpotlight(targetEl, config);
    const card = buildInstructionCard(guidanceAction, targetEl, config);
    const stepBadge = buildStepCounter(guidanceAction);
    const exitBtn = buildExitButton();
    const muteBtn = buildMuteButton();

    overlay.appendChild(spotlight);
    overlay.appendChild(card);
    overlay.appendChild(stepBadge);
    overlay.appendChild(exitBtn);
    overlay.appendChild(muteBtn);
    document.body.appendChild(overlay);

    // Keep spotlight + card glued to the target element on scroll/resize.
    const reposition = () => {
      positionSpotlight(spotlight, targetEl, config);
      positionCard(card, targetEl, config);
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);

    currentTeardown = () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      overlay.remove();
    };

    // Speak the instruction if requested and not muted.
    if (guidanceAction.read_aloud && !window[MUTE_STORAGE_KEY]) {
      speakInstruction(guidanceAction.instruction);
    }
  }

  function teardownHUD() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
    if (currentTeardown) {
      currentTeardown();
      currentTeardown = null;
    }
  }

  // ---------------------------------------------------------------------
  // 4. Overlay (dark backdrop)
  // ---------------------------------------------------------------------
  function buildOverlay(config) {
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      // Transparent on purpose: the spotlight child's box-shadow is what
      // paints all the darkness (see buildSpotlight/positionSpotlight).
      // If this container also had an opaque background, it would sit
      // behind the spotlight's near-transparent fill and show through
      // as solid black with no visible cutout.
      background: 'transparent',
      zIndex: '2147483000',
      pointerEvents: 'auto',
    });
    return overlay;
  }

  // ---------------------------------------------------------------------
  // 5. Spotlight — "cut out" the target element region.
  //    Implemented with the box-shadow spotlight trick: a transparent
  //    hole positioned exactly over the target rect, with an inset
  //    box-shadow spanning the viewport acting as the dark backdrop
  //    right around the hole, plus a glow ring for polish.
  // ---------------------------------------------------------------------
  function buildSpotlight(targetEl, config) {
    const spotlight = document.createElement('div');
    spotlight.id = SPOTLIGHT_ID;
    Object.assign(spotlight.style, {
      position: 'fixed',
      background: 'transparent',
      borderRadius: '10px',
      pointerEvents: 'none',
      transition: 'top 0.2s ease, left 0.2s ease, width 0.2s ease, height 0.2s ease',
    });
    positionSpotlight(spotlight, targetEl, config);
    return spotlight;
  }

  function positionSpotlight(spotlight, targetEl, config) {
    const rect = targetEl.getBoundingClientRect();
    const pad = config.spotlightPadding;

    const top = rect.top - pad;
    const left = rect.left - pad;
    const width = rect.width + pad * 2;
    const height = rect.height + pad * 2;

    Object.assign(spotlight.style, {
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      height: `${height}px`,
      // Huge spread box-shadow "punches" a bright hole through the
      // overlay's darkness while the overlay div behind it stays dark.
      boxShadow: `0 0 0 2000px rgba(0,0,0,${config.overlayOpacity}), ${config.spotlightGlow}`,
      background: 'rgba(255,255,255,0.02)',
      border: '2px solid rgba(255,255,255,0.85)',
      filter: 'brightness(1.05)',
    });
  }

  // ---------------------------------------------------------------------
  // 6. Instruction card — floats near the target, flips to stay on-screen.
  // ---------------------------------------------------------------------
  function buildInstructionCard(guidanceAction, targetEl, config) {
    const card = document.createElement('div');
    card.id = CARD_ID;
    Object.assign(card.style, {
      position: 'fixed',
      maxWidth: `${config.cardMaxWidth}px`,
      background: '#ffffff',
      color: '#111827',
      borderRadius: '12px',
      padding: '14px 16px',
      boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: `${config.fontSize}px`,
      lineHeight: '1.4',
      zIndex: '2147483001',
      pointerEvents: 'auto',
    });
    card.textContent = guidanceAction.instruction || '';
    positionCard(card, targetEl, config);
    return card;
  }

  function positionCard(card, targetEl, config) {
    const rect = targetEl.getBoundingClientRect();
    const gap = 16 + config.spotlightPadding;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const cardWidth = config.cardMaxWidth;
    const cardHeight = card.offsetHeight || 90;

    let top, left, placement;

    // Prefer below, then above, then right, then left.
    if (rect.bottom + gap + cardHeight <= vh) {
      placement = 'below';
      top = rect.bottom + gap;
      left = rect.left;
    } else if (rect.top - gap - cardHeight >= 0) {
      placement = 'above';
      top = rect.top - gap - cardHeight;
      left = rect.left;
    } else if (rect.right + gap + cardWidth <= vw) {
      placement = 'right';
      top = rect.top;
      left = rect.right + gap;
    } else {
      placement = 'left';
      top = rect.top;
      left = Math.max(rect.left - gap - cardWidth, 8);
    }

    left = Math.min(Math.max(left, 8), vw - cardWidth - 8);
    top = Math.min(Math.max(top, 8), vh - 8);

    Object.assign(card.style, {
      top: `${top}px`,
      left: `${left}px`,
    });
    card.dataset.placement = placement;
  }

  // ---------------------------------------------------------------------
  // 7. Step counter (e.g. "Step 2 of 6")
  // ---------------------------------------------------------------------
  function buildStepCounter(guidanceAction) {
    const badge = document.createElement('div');
    badge.id = STEP_ID;
    badge.textContent = `Step ${guidanceAction.step} of ${guidanceAction.total_steps}`;
    Object.assign(badge.style, {
      position: 'fixed',
      bottom: '20px',
      left: '20px',
      background: 'rgba(17,24,39,0.9)',
      color: '#fff',
      padding: '8px 14px',
      borderRadius: '999px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      letterSpacing: '0.02em',
      zIndex: '2147483001',
      pointerEvents: 'none',
    });
    return badge;
  }

  // ---------------------------------------------------------------------
  // 8. Exit / "Turn off Cognia" button
  // ---------------------------------------------------------------------
  function buildExitButton() {
    const btn = document.createElement('button');
    btn.id = EXIT_ID;
    btn.textContent = 'Exit Cognia';
    Object.assign(btn.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      background: 'rgba(17,24,39,0.9)',
      color: '#fff',
      border: 'none',
      borderRadius: '999px',
      padding: '10px 18px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      zIndex: '2147483002',
      pointerEvents: 'auto',
    });
    btn.addEventListener('click', teardownHUD);
    return btn;
  }

  // ---------------------------------------------------------------------
  // 8b. Mute toggle — lets a presenter silence read-aloud without
  //     leaving the demo flow. State persists across re-renders.
  // ---------------------------------------------------------------------
  function buildMuteButton() {
    const btn = document.createElement('button');
    btn.id = MUTE_ID;
    const updateLabel = () => {
      btn.textContent = window[MUTE_STORAGE_KEY] ? '🔇 Unmute' : '🔊 Mute';
    };
    updateLabel();
    Object.assign(btn.style, {
      position: 'fixed',
      top: '20px',
      right: '150px',
      background: 'rgba(17,24,39,0.9)',
      color: '#fff',
      border: 'none',
      borderRadius: '999px',
      padding: '10px 18px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      zIndex: '2147483002',
      pointerEvents: 'auto',
    });
    btn.addEventListener('click', () => {
      window[MUTE_STORAGE_KEY] = !window[MUTE_STORAGE_KEY];
      if (window[MUTE_STORAGE_KEY] && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      updateLabel();
    });
    return btn;
  }

  // ---------------------------------------------------------------------
  // 8c. Read-aloud via SpeechSynthesis
  // ---------------------------------------------------------------------
  function speakInstruction(text) {
    if (!text || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  }

  // ---------------------------------------------------------------------
  // 9. Expose renderHUD for Person 4's orchestration loop to call.
  // ---------------------------------------------------------------------
  window.renderHUD = renderHUD;
  window.__cogniaTeardownHUD = teardownHUD;

  // ---------------------------------------------------------------------
  // 10. STANDALONE TEST — comment this out once real data is wired in.
  // ---------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "UPDATE_HUD") {
    renderHUD(request.data);
  }
});
})();
