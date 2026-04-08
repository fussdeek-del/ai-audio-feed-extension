/**
 * settings.js
 * ---------------------------------------------------------------------------
 * Popup Settings Panel Logic - Auto-saving edition
 * ---------------------------------------------------------------------------
 */

'use strict';

const apiKeyInput      = document.getElementById('apiKeyInput');
const toggleVisibility = document.getElementById('toggleVisibility');
const voiceSelect      = document.getElementById('voiceSelect');
const voiceStatus      = document.getElementById('voiceStatus');
const fetchVoicesBtn   = document.getElementById('fetchVoicesBtn');
const rateSlider       = document.getElementById('rateSlider');
const rateVal          = document.getElementById('rateVal');
const pitchSlider      = document.getElementById('pitchSlider');
const pitchVal         = document.getElementById('pitchVal');
const volumeSlider     = document.getElementById('volumeSlider');
const volumeVal        = document.getElementById('volumeVal');
const saveBtn          = document.getElementById('saveBtn');
const statusEl         = document.getElementById('status');
const engineBadge      = document.getElementById('engineBadge');
const engineLabel      = document.getElementById('engineLabel');

const DEFAULTS = {
  elevenlabsApiKey:  '',
  elevenlabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
  ttsRate:           1.0,
  ttsPitch:          1.0,
  ttsVolume:         1.0,
};

const BUILTIN_VOICES = [
  { voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (default)' },
  { voice_id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi' },
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella' },
  { voice_id: 'ErXwobaYiN019PkySvjV', name: 'Antoni' },
  { voice_id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli' },
  { voice_id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh' },
  { voice_id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold' },
  { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' },
  { voice_id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam' },
];

let _statusTimer = null;
function showStatus(msg, type = 'success') {
  statusEl.textContent = msg;
  statusEl.className   = type;
  clearTimeout(_statusTimer);
  _statusTimer = setTimeout(() => { statusEl.textContent = ''; statusEl.className = ''; }, 3200);
}

function updateBadge() {
  const hasKey = !!apiKeyInput.value.trim();
  engineBadge.className   = hasKey ? 'engine-badge elevenlabs' : 'engine-badge native';
  engineLabel.textContent = hasKey ? 'ElevenLabs (active)' : 'Browser TTS (default)';
}

function _populateVoiceSelect(voices, selectedId) {
  voiceSelect.innerHTML = '';
  const list = (voices && voices.length > 0) ? voices : BUILTIN_VOICES;
  list.forEach(({ voice_id, name }) => {
    const opt = document.createElement('option');
    opt.value = voice_id;
    opt.textContent = name;
    if (voice_id === selectedId) opt.selected = true;
    voiceSelect.appendChild(opt);
  });
  if (!voiceSelect.value && voiceSelect.options.length > 0) {
    voiceSelect.options[0].selected = true;
  }
}

// ── SAVE MECHANISM ────────────────────────────────────────────────────────
function silentSave() {
  const settings = {
    elevenlabsApiKey:  apiKeyInput.value.trim(),
    elevenlabsVoiceId: voiceSelect.value || DEFAULTS.elevenlabsVoiceId,
    ttsRate:           parseFloat(rateSlider.value),
    ttsPitch:          parseFloat(pitchSlider.value),
    ttsVolume:         parseFloat(volumeSlider.value),
  };
  chrome.storage.local.set(settings, () => {
    updateBadge();
  });
}

function saveAndNotify() {
  silentSave();
  showStatus('✓ Settings saved!', 'success');
}

// ── INIT ──────────────────────────────────────────────────────────────────
chrome.storage.local.get([...Object.keys(DEFAULTS), 'elevenlabsVoices'], (data) => {
  const s = { ...DEFAULTS, ...data };
  
  apiKeyInput.value = s.elevenlabsApiKey;
  updateBadge();

  const cachedVoices = (Array.isArray(data.elevenlabsVoices) && data.elevenlabsVoices.length > 0) 
    ? data.elevenlabsVoices 
    : BUILTIN_VOICES;
    
  _populateVoiceSelect(cachedVoices, s.elevenlabsVoiceId);

  rateSlider.value   = s.ttsRate;
  pitchSlider.value  = s.ttsPitch;
  volumeSlider.value = s.ttsVolume;
  
  rateVal.textContent   = `${parseFloat(s.ttsRate).toFixed(1)}×`;
  pitchVal.textContent  = parseFloat(s.ttsPitch).toFixed(1);
  volumeVal.textContent = `${Math.round(parseFloat(s.ttsVolume) * 100)}%`;
});

// ── LISTENERS ─────────────────────────────────────────────────────────────
rateSlider.addEventListener('input',   () => { rateVal.textContent   = `${parseFloat(rateSlider.value).toFixed(1)}×`; silentSave(); });
pitchSlider.addEventListener('input',  () => { pitchVal.textContent  = parseFloat(pitchSlider.value).toFixed(1); silentSave(); });
volumeSlider.addEventListener('input', () => { volumeVal.textContent = `${Math.round(parseFloat(volumeSlider.value) * 100)}%`; silentSave(); });

apiKeyInput.addEventListener('input', () => { updateBadge(); silentSave(); });
voiceSelect.addEventListener('change', silentSave);

toggleVisibility.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  toggleVisibility.textContent = apiKeyInput.type === 'password' ? '👁' : '🙈';
});

saveBtn.addEventListener('click', saveAndNotify);

// Fetch Voices
fetchVoicesBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) { showStatus('Enter your API key first.', 'error'); return; }

  fetchVoicesBtn.disabled = true;
  voiceStatus.textContent = '⏳ Fetching voices...';

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const { voices = [] } = await response.json();
    if (!voices.length) throw new Error('No voices found.');

    const voiceList = voices.map(v => ({ voice_id: v.voice_id, name: v.name }));
    _populateVoiceSelect(voiceList, voiceSelect.value); // preserve current selection
    
    chrome.storage.local.set({ elevenlabsVoices: voiceList }, () => {
      silentSave(); // Also save the current selection immediately
      showStatus(`✓ ${voiceList.length} voices loaded`, 'success');
      voiceStatus.textContent = `✓ ${voiceList.length} voices loaded`;
    });
  } catch (err) {
    voiceStatus.textContent = '';
    showStatus(`Failed: ${err.message}`, 'error');
  } finally {
    fetchVoicesBtn.disabled = false;
  }
});
