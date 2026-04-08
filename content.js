/**
 * content.js
 * ---------------------------------------------------------------------------
 * Main Orchestrator — injected into twitter.com / x.com
 * Now with heavy diagnostics to trace why buttons vanish.
 * ---------------------------------------------------------------------------
 */

(function AAFBoot() {
  'use strict';

  console.log('[AAF] Content script loaded. Initialising...');

  // Avoid multiple injections
  if (window.__aafInitialised) {
    console.log('[AAF] Already initialised, skipping.');
    return;
  }
  window.__aafInitialised = true;

  // Local state
  let _settings = {
    elevenlabsApiKey:  '',
    elevenlabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
    ttsRate:           1.0,
    ttsPitch:          1.0,
    ttsVolume:         1.0,
  };
  let _activeBtn    = null;
  let _activeEngine = null;
  let _isSpeaking   = false;

  // ── 1. Settings Loader ───────────────────────────────────────────────────
  function _refreshSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (data) => {
        _settings = {
          elevenlabsApiKey:  data.elevenlabsApiKey  || '',
          elevenlabsVoiceId: data.elevenlabsVoiceId || '21m00Tcm4TlvDq8ikWAM',
          ttsRate:           data.ttsRate   != null ? data.ttsRate   : 1.0,
          ttsPitch:          data.ttsPitch  != null ? data.ttsPitch  : 1.0,
          ttsVolume:         data.ttsVolume != null ? data.ttsVolume : 1.0,
        };
        resolve(_settings);
      });
    });
  }

  // ── 2. Audio Control ─────────────────────────────────────────────────────
  function stopAllAudio() {
    try { window.SpeechEngine?.stop(); } catch(e){}
    try { window.ElevenLabsEngine?.stop(); } catch(e){}

    if (_activeBtn) {
      try { window.ButtonManager?.setState(_activeBtn, 'idle'); } catch(e){}
      _activeBtn = null;
    }
    _activeEngine = null;
    _isSpeaking   = false;
  }
  window.AAF_stopAllAudio = stopAllAudio;

  async function speak(text, btn) {
    if (_isSpeaking) {
      stopAllAudio();
      await new Promise(r => setTimeout(r, 100));
    }
    _isSpeaking = true;
    _activeBtn  = btn;

    const useElevenLabs = !!_settings.elevenlabsApiKey?.trim();
    _activeEngine = useElevenLabs ? 'elevenlabs' : 'speech';

    console.log(`[AAF] Speaking via ${_activeEngine}. Text length: ${text.length}`);

    try {
      window.ButtonManager.setState(btn, 'loading');

      if (useElevenLabs) {
        window.ButtonManager.setState(btn, 'playing', 'ElevenLabs');
        await window.ElevenLabsEngine.speak(text);
      } else {
        window.ButtonManager.setState(btn, 'playing', 'Browser TTS');
        await window.SpeechEngine.speak(text, _settings);
      }

      if (_activeBtn === btn) {
        window.ButtonManager.setState(btn, 'idle');
        _activeBtn = null;
      }
    } catch (err) {
      const isCancelled = err.message?.toLowerCase().includes('cancel') || err.message?.includes('interrupted');
      if (isCancelled) return;

      if (useElevenLabs) {
        console.warn('[AAF] ElevenLabs failed, falling back to basic TTS. Error:', err.message);
        _activeEngine = 'speech';
        try {
          window.ButtonManager.setState(btn, 'playing', 'Fallback TTS');
          await window.SpeechEngine.speak(text, _settings);
          if (_activeBtn === btn) {
            window.ButtonManager.setState(btn, 'idle');
            _activeBtn = null;
          }
        } catch (fbErr) {
          if (!fbErr.message?.toLowerCase().includes('cancel')) {
            window.ButtonManager.setState(btn, 'error', fbErr.message);
          }
        }
      } else {
        console.error('[AAF] Basic TTS error:', err.message);
        window.ButtonManager.setState(btn, 'error', err.message);
      }
    } finally {
      _isSpeaking = false;
    }
  }

  // ── 3. Interaction ───────────────────────────────────────────────────────
  async function _handleClick(state, btn, text) {
    switch (state) {
      case 'idle':
      case 'error':
        if (_activeBtn && _activeBtn !== btn) stopAllAudio();
        await speak(text, btn);
        break;
      case 'playing':
        if (_activeEngine === 'speech') window.SpeechEngine.pause();
        else window.ElevenLabsEngine.pause();
        window.ButtonManager.setState(btn, 'paused');
        break;
      case 'paused':
        if (_activeEngine === 'speech') window.SpeechEngine.resume();
        else window.ElevenLabsEngine.resume();
        window.ButtonManager.setState(btn, 'playing');
        break;
    }
  }

  // ── 4. Injection Logic ───────────────────────────────────────────────────
  function _extractPostText(postEl) {
    // Exact Twitter primary text
    const tweetTextEl = postEl.querySelector('[data-testid="tweetText"]');
    if (tweetTextEl) return (tweetTextEl.innerText || tweetTextEl.textContent || '').trim();

    // Aggressive fallback: just grab all text
    return (postEl.innerText || postEl.textContent || '').trim();
  }

  function _findInsertionTarget(postEl) {
    return postEl.querySelector('[role="group"]') || 
           postEl.querySelector('[data-testid="tweet-footer"]') || 
           postEl; // ultimate fallback is appending to the post itself
  }

  function injectButton(postEl) {
    if (!postEl || window.ButtonManager.isInjected(postEl)) return;

    const rawText = _extractPostText(postEl);
    if (!rawText) return;

    let text = rawText;
    try {
      if (window.TextProcessor) text = window.TextProcessor.process(rawText);
    } catch (e) {
      console.warn('[AAF] Text processor error:', e);
    }

    // Must be at least a few chars
    if (text.length < 4) return;

    let _debounceTimer = null;
    const btn = window.ButtonManager.createButton((curState) => {
      if (_debounceTimer) return;
      _debounceTimer = setTimeout(() => { _debounceTimer = null; }, 350);
      _handleClick(curState, btn, text);
    });

    const target = _findInsertionTarget(postEl);
    
    // Create wrapper so styles aren't ruined
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:inline-flex;align-items:center;margin: 0 4px; z-index:99; position:relative;';
    wrapper.appendChild(btn);

    target.appendChild(wrapper);
    window.ButtonManager.markInjected(postEl);
  }

  // ── 5. DOM Observers ─────────────────────────────────────────────────────
  let _scanTimer = null;
  function _scanForPosts() {
    const posts = document.querySelectorAll('article[data-testid="tweet"], [data-testid="tweet"]');
    posts.forEach(injectButton);
  }

  const _observer = new MutationObserver((mutations) => {
    // Only scan if elements were actually added
    if (mutations.some(m => m.addedNodes.length > 0)) {
      clearTimeout(_scanTimer);
      _scanTimer = setTimeout(_scanForPosts, 300);
    }
  });

  function _startObserving() {
    console.log('[AAF] Starting DOM observer...');
    _observer.observe(document.body, { childList: true, subtree: true });
    _scanForPosts();
    // Safety loop every 3 seconds to catch missed widgets
    setInterval(_scanForPosts, 3000);
  }

  // ── 6. Boot sequence ─────────────────────────────────────────────────────
  async function _boot() {
    chrome.runtime.onMessage.addListener(msg => {
      if (msg?.type === 'AAF_SETTINGS_CHANGED') {
        console.log('[AAF] Settings changed, refreshing...');
        _refreshSettings().then(() => window.ElevenLabsEngine?.loadConfig());
      }
    });

    await _refreshSettings();
    try { await window.ElevenLabsEngine?.loadConfig(); } catch(e){}

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _startObserving);
    } else {
      _startObserving();
    }
  }

  _boot();

})();
