/**
 * elevenLabs.js
 * ---------------------------------------------------------------------------
 * ElevenLabs TTS Engine
 *
 * Improvements:
 *   - Single audio element reused across calls (no memory leaks)
 *   - Cancellation-safe: every request is tagged with a serial number
 *   - Strict mutual exclusion: calls stop() before starting new playback
 *   - Graceful error handling: 401/429/422/network, with structured messages
 *   - loadConfig() is idempotent and safe to call concurrently
 * ---------------------------------------------------------------------------
 */

const ElevenLabsEngine = (() => {
  'use strict';

  const API_BASE         = 'https://api.elevenlabs.io/v1';
  const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';   // Rachel
  const DEFAULT_MODEL    = 'eleven_multilingual_v2';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Reusable HTMLAudioElement — avoids creation/GC on every request. */
  const _audio = new Audio();
  _audio.preload = 'auto';

  /** Serial counter — incremented on stop() to abort in-flight Promises. */
  let _serial = 0;

  /** Cached credentials from chrome.storage.local */
  let _apiKey  = null;
  let _voiceId = DEFAULT_VOICE_ID;

  /** Ongoing loadConfig promise (coalesces concurrent calls). */
  let _configLoading = null;

  // ---------------------------------------------------------------------------
  // Key management
  // ---------------------------------------------------------------------------

  /**
   * Load API key + voice ID from chrome.storage.local.
   * Multiple concurrent calls are coalesced into one storage read.
   * @returns {Promise<{apiKey: string|null, voiceId: string}>}
   */
  function loadConfig() {
    if (_configLoading) return _configLoading;

    _configLoading = new Promise((resolve) => {
      chrome.storage.local.get(
        ['elevenlabsApiKey', 'elevenlabsVoiceId'],
        (result) => {
          _apiKey   = result.elevenlabsApiKey  || null;
          _voiceId  = result.elevenlabsVoiceId || DEFAULT_VOICE_ID;
          resolve({ apiKey: _apiKey, voiceId: _voiceId });
        }
      );
    }).finally(() => {
      _configLoading = null;   // allow the next settings-change to re-fetch
    });

    return _configLoading;
  }

  /** Returns true if a non-empty API key is currently cached. */
  function hasApiKey() {
    return typeof _apiKey === 'string' && _apiKey.trim().length > 0;
  }

  // ---------------------------------------------------------------------------
  // Stop — always safe, always synchronous
  // ---------------------------------------------------------------------------

  /** Abort any in-flight fetch and stop the audio element immediately. */
  function stop() {
    ++_serial;                     // invalidate all pending Promises
    _audio.pause();
    _audio.removeAttribute('src');
    _audio.load();                 // reset internal buffer to avoid memory leak
  }

  // ---------------------------------------------------------------------------
  // Core speak()
  // ---------------------------------------------------------------------------

  /**
   * Fetch audio from ElevenLabs and play it through the shared audio element.
   *
   * @param {string} text          Cleaned text to synthesise.
   * @param {object} [opts]
   * @param {string} [opts.voiceId]
   * @param {string} [opts.model]
   * @returns {Promise<void>}  Resolves when playback ends; rejects on error.
   */
  async function speak(text, opts = {}) {
    if (!text?.trim()) throw new Error('[ElevenLabs] Empty text — nothing to speak.');

    // Always stop first to ensure clean state
    stop();
    const mySerial = _serial;

    await loadConfig();
    if (_serial !== mySerial) throw new Error('[ElevenLabs] cancelled');

    if (!hasApiKey()) throw new Error('[ElevenLabs] No API key configured.');

    const voiceId = opts.voiceId || _voiceId;
    const model   = opts.model   || DEFAULT_MODEL;
    const url     = `${API_BASE}/text-to-speech/${voiceId}`;

    // ── Fetch ────────────────────────────────────────────────────────────────
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key':   _apiKey.trim(),
          'Accept':       'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });
    } catch (networkErr) {
      throw new Error(`[ElevenLabs] Network error: ${networkErr.message}`);
    }

    // Bail if stop() was called while fetching
    if (_serial !== mySerial) throw new Error('[ElevenLabs] cancelled');

    // ── HTTP errors ──────────────────────────────────────────────────────────
    if (!response.ok) {
      const { status } = response;
      let body = '';
      try { body = await response.text(); } catch (_) { /* ignore */ }

      if (status === 401) throw new Error('[ElevenLabs] Invalid API key (401).');
      if (status === 429) throw new Error('[ElevenLabs] Rate limit reached (429). Retry shortly.');
      if (status === 422) throw new Error('[ElevenLabs] Request invalid (422). Text may be too long.');
      throw new Error(`[ElevenLabs] API error ${status}: ${body}`);
    }

    // ── Stream audio ─────────────────────────────────────────────────────────
    const blob    = await response.blob();
    if (_serial !== mySerial) throw new Error('[ElevenLabs] cancelled');

    const blobUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      if (_serial !== mySerial) {
        URL.revokeObjectURL(blobUrl);
        return reject(new Error('[ElevenLabs] cancelled'));
      }

      _audio.src = blobUrl;

      const cleanup = () => {
        URL.revokeObjectURL(blobUrl);
        _audio.onended  = null;
        _audio.onerror  = null;
      };

      _audio.onended = () => {
        cleanup();
        if (_serial !== mySerial) return reject(new Error('[ElevenLabs] cancelled'));
        resolve();
      };

      _audio.onerror = (e) => {
        cleanup();
        reject(new Error(`[ElevenLabs] Playback error: ${e?.message ?? 'unknown'}`));
      };

      _audio.play().catch((playErr) => {
        cleanup();
        reject(new Error(`[ElevenLabs] play() failed: ${playErr.message}`));
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Pause / Resume
  // ---------------------------------------------------------------------------

  function pause() {
    if (!_audio.paused) _audio.pause();
  }

  function resume() {
    if (_audio.paused && _audio.src) _audio.play().catch(() => {});
  }

  /** True while the audio element is playing (not paused, not ended). */
  function isSpeaking() {
    return !_audio.paused && !_audio.ended && _audio.readyState > 2;
  }

  // ---------------------------------------------------------------------------
  // Voice list helper (for settings panel)
  // ---------------------------------------------------------------------------

  /**
   * Fetch the list of voices for the current API key.
   * @returns {Promise<Array<{voice_id: string, name: string}>>}
   */
  async function fetchVoices() {
    await loadConfig();
    if (!hasApiKey()) throw new Error('[ElevenLabs] No API key to fetch voices.');

    const response = await fetch(`${API_BASE}/voices`, {
      headers: { 'xi-api-key': _apiKey.trim() },
    });

    if (!response.ok) {
      throw new Error(`[ElevenLabs] Could not fetch voices (${response.status}).`);
    }

    const data = await response.json();
    return (data.voices || []).map(({ voice_id, name }) => ({ voice_id, name }));
  }

  return {
    speak,
    stop,
    pause,
    resume,
    isSpeaking,
    hasApiKey,
    loadConfig,
    fetchVoices,
    DEFAULT_VOICE_ID,
  };
})();

window.ElevenLabsEngine = ElevenLabsEngine;
