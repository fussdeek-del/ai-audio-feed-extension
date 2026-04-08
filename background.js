/**
 * background.js
 * ---------------------------------------------------------------------------
 * Service Worker (MV3 background)
 *
 * This extension is fully client-side — the background worker's job is light:
 *   1. Listen for chrome.storage change events and broadcast to active tabs
 *      so content scripts can pick up new API keys without needing a reload.
 *   2. Handle the toolbar icon badge to indicate TTS engine in use.
 *   3. Provide a message-passing endpoint for content ↔ worker communication.
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    console.log('[AAF] Extension installed. Opening settings on first run…');

    // Pre-seed storage with sensible defaults
    chrome.storage.local.set({
      elevenlabsApiKey:  '',
      elevenlabsVoiceId: '21m00Tcm4TlvDq8ikWAM',  // ElevenLabs "Rachel"
      ttsRate:           1.0,
      ttsPitch:          1.0,
      ttsVolume:         1.0,
    });

    // Open the settings popup on first install
    chrome.runtime.openOptionsPage?.();
  }
});

// ---------------------------------------------------------------------------
// Relay storage changes to all matching content scripts
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  // Determine which tabs might be running our content script
  chrome.tabs.query({ url: ['*://twitter.com/*', '*://x.com/*'] }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'AAF_SETTINGS_CHANGED',
        changes: Object.fromEntries(
          Object.entries(changes).map(([k, v]) => [k, v.newValue])
        ),
      }).catch(() => {
        // Tab may not have the content script yet — silently ignore
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Message handler (content → background requests)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  switch (message.type) {
    // Ping — used by content.js to verify the worker is alive
    case 'AAF_PING':
      sendResponse({ ok: true });
      return false;

    // Content script requests current settings
    case 'AAF_GET_SETTINGS':
      chrome.storage.local.get(null, (items) => {
        sendResponse({ ok: true, settings: items });
      });
      return true;  // keep channel open for async response

    default:
      return false;
  }
});

// ---------------------------------------------------------------------------
// Badge helpers — show "EL" when ElevenLabs is active, default otherwise
// ---------------------------------------------------------------------------

function _updateBadge(hasApiKey) {
  chrome.action.setBadgeText({ text: hasApiKey ? 'EL' : '' });
  chrome.action.setBadgeBackgroundColor({ color: hasApiKey ? '#1d9bf0' : '#555' });
}

// Initialise badge based on stored key
chrome.storage.local.get(['elevenlabsApiKey'], ({ elevenlabsApiKey }) => {
  _updateBadge(!!elevenlabsApiKey);
});

// Keep badge in sync when key changes
chrome.storage.onChanged.addListener((changes) => {
  if ('elevenlabsApiKey' in changes) {
    _updateBadge(!!changes.elevenlabsApiKey.newValue);
  }
});
