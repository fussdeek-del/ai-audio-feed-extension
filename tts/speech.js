/**
 * speech.js
 * ---------------------------------------------------------------------------
 * Browser-native TTS Engine (SpeechSynthesis API)
 *
 * Improvements:
 *   - Chunked sequential playback (avoids ~15 s Chrome cut-off on long text)
 *   - Dynamic pitch/rate micro-variation for more natural output
 *   - Promise-based with a cancellation token to prevent race conditions
 *   - Keep-alive ping every 10 s to prevent silent stalling in background tabs
 *   - Single exported stop() that safely cancels the entire chunk queue
 * ---------------------------------------------------------------------------
 */

const SpeechEngine = (() => {
  'use strict';

  if (!('speechSynthesis' in window)) {
    console.warn('[SpeechEngine] SpeechSynthesis not supported.');
  }

  const synth = window.speechSynthesis;

  /** Default speech parameters — overridable per speak() call. */
  const _defaults = {
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    lang: 'en-US',
  };

  // ---------------------------------------------------------------------------
  // Cancellation token — incremented on every stop() to abort in-flight queues
  // ---------------------------------------------------------------------------
  let _token = 0;

  // ---------------------------------------------------------------------------
  // Keep-alive (Chrome desktop silently stops after ~15 s in background tabs)
  // ---------------------------------------------------------------------------
  let _keepAliveTimer = null;

  function _startKeepAlive() {
    _stopKeepAlive();
    _keepAliveTimer = setInterval(() => {
      if (synth.speaking) { synth.pause(); synth.resume(); }
    }, 10_000);
  }

  function _stopKeepAlive() {
    if (_keepAliveTimer !== null) {
      clearInterval(_keepAliveTimer);
      _keepAliveTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Text → chunks
  // ---------------------------------------------------------------------------

  /**
   * Split text at sentence boundaries so each chunk is ≤ maxLen characters.
   * This avoids Chrome's ~15 s utterance time limit.
   *
   * @param {string} text
   * @param {number} [maxLen=180]
   * @returns {string[]}
   */
  function _chunkText(text, maxLen = 180) {
    // Split on sentence-ending punctuation, keeping the delimiter
    const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
    const chunks = [];
    let current = '';

    for (const sentence of sentences) {
      if ((current + sentence).length > maxLen && current.length > 0) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Micro-variation helpers — make consecutive chunks feel slightly different
  // ---------------------------------------------------------------------------

  /**
   * Apply a tiny pseudo-random offset so consecutive sentences don't feel robotic.
   * Stays within ±0.05 of the base value.
   */
  function _vary(base, range = 0.05) {
    return Math.max(0.1, Math.min(10, base + (Math.random() * range * 2 - range)));
  }

  // ---------------------------------------------------------------------------
  // Core: speak a single chunk — returns Promise that resolves/rejects on end
  // ---------------------------------------------------------------------------

  function _speakChunk(text, opts, myToken) {
    return new Promise((resolve, reject) => {
      if (_token !== myToken) return reject(new Error('cancelled'));

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = _vary(opts.rate ?? _defaults.rate, 0.04);
      utterance.pitch = _vary(opts.pitch ?? _defaults.pitch, 0.07);
      utterance.volume = opts.volume ?? _defaults.volume;
      utterance.lang = opts.lang ?? _defaults.lang;

      utterance.onend = () => {
        if (_token !== myToken) return reject(new Error('cancelled'));
        resolve();
      };

      utterance.onerror = (e) => {
        if (e.error === 'interrupted' || e.error === 'canceled') {
          reject(new Error('cancelled'));
        } else {
          reject(new Error(`SpeechSynthesis error: ${e.error}`));
        }
      };

      synth.speak(utterance);
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Speak text, split into chunks for robustness.
   *
   * @param {string} text
   * @param {object} [opts]
   * @param {number} [opts.rate]
   * @param {number} [opts.pitch]
   * @param {number} [opts.volume]
   * @param {string} [opts.lang]
   * @returns {Promise<void>}  Resolves when all chunks finish; rejects on error or cancel.
   */
  async function speak(text, opts = {}) {
    if (!synth) throw new Error('SpeechSynthesis not available.');
    if (!text?.trim()) throw new Error('Empty text — nothing to speak.');

    // Invalidate any in-flight queue and clear the synthesis queue
    stop();

    const myToken = ++_token;
    const chunks = _chunkText(text);

    _startKeepAlive();

    try {
      for (const chunk of chunks) {
        if (_token !== myToken) throw new Error('cancelled');
        await _speakChunk(chunk, opts, myToken);
        // Small breath between sentences
        await new Promise(r => setTimeout(r, 120));
      }
    } finally {
      if (_token === myToken) _stopKeepAlive();
    }
  }

  /** Pause in-progress playback. No-op if not speaking. */
  function pause() {
    if (synth?.speaking && !synth.paused) synth.pause();
  }

  /** Resume a paused utterance. No-op if not paused. */
  function resume() {
    if (synth?.paused) synth.resume();
  }

  /** Cancel all speech immediately. Safe to call multiple times. */
  function stop() {
    ++_token;               // invalidate any pending chunk loop
    _stopKeepAlive();
    synth?.cancel();
  }

  /** True while actively playing (not paused). */
  function isSpeaking() { return synth?.speaking && !synth?.paused; }

  /** True while paused mid-utterance. */
  function isPaused() { return !!synth?.paused; }

  /**
   * Update the default rate for future speak() calls.
   * @param {number} rate
   */
  function setRate(rate) {
    _defaults.rate = Math.max(0.1, Math.min(10, Number(rate)));
  }

  /** Returns a read-only copy of current defaults. */
  function getDefaults() { return { ..._defaults }; }

  return { speak, pause, resume, stop, isSpeaking, isPaused, setRate, getDefaults };
})();

window.SpeechEngine = SpeechEngine;
