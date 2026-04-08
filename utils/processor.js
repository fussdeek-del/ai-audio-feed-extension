/**
 * processor.js
 * ---------------------------------------------------------------------------
 * Text Processing Layer
 *
 * Improvements:
 *   - URLs → "link to <domain>" (human-readable)
 *   - @mentions → "at <username>" (spoken)
 *   - #hashtags → bare word (keep topic, drop symbol)
 *   - Emoji stripped with a broad Unicode range regex
 *   - Light natural intro phrasing added to non-question, non-quote posts
 *   - Sentence-boundary pauses preserved via normalised punctuation
 *   - Expanded abbreviation dictionary
 * ---------------------------------------------------------------------------
 */

const TextProcessor = (() => {
  'use strict';

  // Rotating intro phrases — adds a tiny sense of variety
  const _INTRO_PHRASES = [
    "Here's something interesting. ",
    "Worth a listen. ",
    "Here's a thought. ",
    "Someone posted this. ",
    "From the feed. ",
  ];

  let _introIdx = 0;

  function _nextIntro() {
    const phrase = _INTRO_PHRASES[_introIdx % _INTRO_PHRASES.length];
    _introIdx++;
    return phrase;
  }

  // ---------------------------------------------------------------------------
  // Private cleaners
  // ---------------------------------------------------------------------------

  /**
   * Convert bare URLs into "link to <domain>" so TTS doesn't spell out
   * "h-t-t-p-s-colon-slash-slash-…".
   * @param {string} text
   * @returns {string}
   */
  function _humaniseUrls(text) {
    return text.replace(/https?:\/\/([^/\s]+)[^\s]*/gi, (_, domain) => {
      // Strip leading "www."
      const clean = domain.replace(/^www\./i, '');
      return `link to ${clean}`;
    });
  }

  /**
   * Convert t.co short links (Twitter's URL shortener) into "link to twitter".
   * These often appear after _humaniseUrls because Twitter wraps everything.
   * @param {string} text
   * @returns {string}
   */
  function _collapseTcoDomains(text) {
    return text.replace(/link to t\.co/gi, 'link');
  }

  /**
   * Convert @username → "at username" so TTS reads it naturally.
   * @param {string} text
   * @returns {string}
   */
  function _humaniseMentions(text) {
    return text.replace(/@(\w+)/g, (_, name) => `at ${name}`);
  }

  /**
   * Convert #hashtag → bare word — keeps the topic without the symbol.
   * @param {string} text
   * @returns {string}
   */
  function _stripHashSymbol(text) {
    return text.replace(/#(\w+)/g, '$1');
  }

  /**
   * Remove emoji characters across all major Unicode emoji blocks.
   * @param {string} text
   * @returns {string}
   */
  function _stripEmojis(text) {
    return text.replace(
      /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F004}\u{1F0CF}]/gu,
      ' '
    );
  }

  /**
   * Expand common internet abbreviations into spoken-word equivalents.
   * @param {string} text
   * @returns {string}
   */
  function _expandAbbreviations(text) {
    const map = [
      [/\bw\//gi,         'with'],
      [/\bb\/c\b/gi,      'because'],
      [/\babt\b/gi,       'about'],
      [/\btbh\b/gi,       'to be honest'],
      [/\bimo\b/gi,       'in my opinion'],
      [/\bimho\b/gi,      'in my humble opinion'],
      [/\bbtw\b/gi,       'by the way'],
      [/\bafaik\b/gi,     'as far as I know'],
      [/\blmk\b/gi,       'let me know'],
      [/\bngl\b/gi,       'not gonna lie'],
      [/\bidk\b/gi,       "I don't know"],
      [/\bsmh\b/gi,       'shaking my head'],
      [/\bfwiw\b/gi,      'for what it's worth'],
      [/\bfyi\b/gi,       'for your information'],
      [/\bafk\b/gi,       'away from keyboard'],
      [/\btl;dr\b/gi,     'too long, did not read.'],
      [/\bthx\b/gi,       'thanks'],
      [/\bty\b/gi,        'thank you'],
      [/\bplz\b/gi,       'please'],
      [/\bpls\b/gi,       'please'],
      [/\bvs\.\b/gi,      'versus'],
      [/\be\.g\.\b/gi,    'for example,'],
      [/\bi\.e\.\b/gi,    'that is,'],
      [/\bamp;\b/g,       'and'],
      [/\blol\b/gi,       ''],   // drop filler
      [/\blmao\b/gi,      ''],
      [/\blmfao\b/gi,     ''],
      [/\brofl\b/gi,      ''],
      [/\bomg\b/gi,       'oh my'],
      [/\bomfg\b/gi,      'oh my'],
      [/\bnvm\b/gi,       'never mind'],
      [/\bgtg\b/gi,       'got to go'],
      [/\bbrb\b/gi,       'be right back'],
      // Numbers with commas → easier to parse orally
      [/([\d]),(\d)/g,    '$1 $2'],
    ];

    let out = text;
    for (const [regex, replacement] of map) {
      out = out.replace(regex, replacement);
    }
    return out;
  }

  /**
   * Ensure sentences end with at least one space after punctuation,
   * and collapse excessive whitespace / newlines.
   * @param {string} text
   * @returns {string}
   */
  function _normalise(text) {
    return text
      .replace(/([.!?])([A-Z])/g, '$1 $2')   // missing space after sentence end
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Decide whether to prepend an intro phrase.
   * Skip for:
   *   - Very short posts (≤ 15 chars)
   *   - Posts that already start as a question ("What/Why/How…")
   *   - Posts starting with a quote mark
   */
  function _shouldAddIntro(text) {
    if (text.length < 15) return false;
    if (/^["'"']/.test(text)) return false;
    if (/^(what|why|how|who|when|where|is|are|do|don't|can|will)\b/i.test(text)) return false;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Full processing pipeline.
   *
   * @param {string} rawText  Raw text scraped from the DOM.
   * @param {object} [opts]
   * @param {boolean} [opts.addIntro=true]     Prepend a natural intro phrase.
   * @param {boolean} [opts.humaniseUrls=true]
   * @param {boolean} [opts.humaniseMentions=true]
   * @param {boolean} [opts.stripHashtags=true]   Strip # symbol, keep word.
   * @param {boolean} [opts.stripEmojis=true]
   * @param {boolean} [opts.expandAbbr=true]
   * @returns {string}  Cleaned, ready-to-speak text (or '' if nothing left).
   */
  function process(rawText, opts = {}) {
    const {
      addIntro          = true,
      humaniseUrls      = true,
      humaniseMentions  = true,
      stripHashtags     = true,
      stripEmojis       = true,
      expandAbbr        = true,
    } = opts;

    if (!rawText || typeof rawText !== 'string') return '';

    let text = rawText;

    if (humaniseUrls)     text = _humaniseUrls(text);
    text                       = _collapseTcoDomains(text);
    if (humaniseMentions) text = _humaniseMentions(text);
    if (stripHashtags)    text = _stripHashSymbol(text);
    if (stripEmojis)      text = _stripEmojis(text);
    if (expandAbbr)       text = _expandAbbreviations(text);
    text                       = _normalise(text);

    if (addIntro && _shouldAddIntro(text)) {
      text = _nextIntro() + text;
    }

    return text;
  }

  /**
   * Returns true if text has enough content to be worth speaking.
   * @param {string} text  Already-processed text.
   * @returns {boolean}
   */
  function isReadable(text) {
    return typeof text === 'string' && text.trim().length >= 4;
  }

  return { process, isReadable };
})();

window.TextProcessor = TextProcessor;
