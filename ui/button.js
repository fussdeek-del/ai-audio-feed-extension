/**
 * button.js
 * ---------------------------------------------------------------------------
 * Listen Button Factory & Playback Controller
 *
 * Responsibilities:
 *   - Create the 🔊 "Listen" button DOM element
 *   - Wire up click handling with full state machine (idle → loading → playing
 *     → paused → idle)
 *   - Delegate TTS to the unified speak() wrapper (see content.js)
 *   - Prevent duplicate injections via a per-post attribute marker
 *   - Export ButtonManager for use by content.js
 * ---------------------------------------------------------------------------
 */

const ButtonManager = (() => {
  // Attribute stamped on post elements that already have a button
  const INJECTED_ATTR = 'data-aaf-injected';

  // States the button can be in
  const STATE = {
    IDLE:    'idle',
    LOADING: 'loading',
    PLAYING: 'playing',
    PAUSED:  'paused',
    ERROR:   'error',
  };

  // Icon glyphs per state
  const ICON = {
    [STATE.IDLE]:    '🔊',
    [STATE.LOADING]: '⏳',
    [STATE.PLAYING]: '⏸',
    [STATE.PAUSED]:  '▶',
    [STATE.ERROR]:   '⚠',
  };

  const LABEL = {
    [STATE.IDLE]:    'Listen',
    [STATE.LOADING]: 'Loading…',
    [STATE.PLAYING]: 'Pause',
    [STATE.PAUSED]:  'Resume',
    [STATE.ERROR]:   'Retry',
  };

  // ---------------------------------------------------------------------------
  // Button element creation
  // ---------------------------------------------------------------------------

  /**
   * Build and return a new <button> element.
   * The caller is responsible for appending it to the DOM.
   *
   * @param {Function} onClickCallback  Called with (currentState) on each click.
   * @returns {HTMLButtonElement}
   */
  function createButton(onClickCallback) {
    const btn = document.createElement('button');
    btn.className  = 'aaf-listen-btn';
    btn.title      = 'Listen to this post';
    btn.setAttribute('data-state', STATE.IDLE);
    btn.setAttribute('aria-label', 'Listen to post');

    // Inner structure
    const iconEl  = document.createElement('span');
    iconEl.className = 'aaf-icon';
    iconEl.textContent = ICON[STATE.IDLE];

    const labelEl = document.createElement('span');
    labelEl.className = 'aaf-label';
    labelEl.textContent = LABEL[STATE.IDLE];

    btn.appendChild(iconEl);
    btn.appendChild(labelEl);

    // Debounce rapid clicks (300 ms) to prevent double-fire
    let _clickLocked = false;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();  // don't bubble to post-click handlers on Twitter
      if (_clickLocked) return;
      _clickLocked = true;
      setTimeout(() => { _clickLocked = false; }, 300);

      const state = btn.getAttribute('data-state');
      onClickCallback(state);
    });

    return btn;
  }

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------

  /**
   * Update a button's visual state.
   *
   * @param {HTMLButtonElement} btn
   * @param {string}            state  One of the STATE constants.
   * @param {string}            [tooltip]  Optional tooltip text.
   */
  function setState(btn, state, tooltip) {
    if (!btn) return;
    btn.setAttribute('data-state', state);
    btn.querySelector('.aaf-icon').textContent  = ICON[state]  || ICON[STATE.IDLE];
    btn.querySelector('.aaf-label').textContent = LABEL[state] || LABEL[STATE.IDLE];

    if (tooltip) {
      btn.setAttribute('data-tooltip', tooltip);
    } else {
      btn.removeAttribute('data-tooltip');
    }
  }

  // ---------------------------------------------------------------------------
  // Injection helpers
  // ---------------------------------------------------------------------------

  /**
   * Has this post element already received a button?
   * @param {Element} postEl
   * @returns {boolean}
   */
  function isInjected(postEl) {
    return postEl.hasAttribute(INJECTED_ATTR);
  }

  /**
   * Mark a post element as having been injected so we don't re-inject on
   * future MutationObserver callbacks.
   * @param {Element} postEl
   */
  function markInjected(postEl) {
    postEl.setAttribute(INJECTED_ATTR, '1');
  }

  return { createButton, setState, isInjected, markInjected, STATE };
})();

window.ButtonManager = ButtonManager;
