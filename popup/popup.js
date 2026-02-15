/**
 * CarryEgg — Popup script. Continue / Summary snapshot, Copy, Download.
 * Uses chrome.tabs.sendMessage to content script; listens for snapshotProgress.
 */

(function () {
  'use strict';

  const statusEl = document.getElementById('status');
  const outEl = document.getElementById('output');
  const btnContinue = document.getElementById('continueEgg');
  const btnSummarize = document.getElementById('summarizeEgg');
  const btnCopy = document.getElementById('copyBtn');
  const btnDownload = document.getElementById('downloadBtn');
  const cartonBtn = document.getElementById('cartonBtn');
  const historyDrawer = document.getElementById('historyDrawer');
  const closeDrawerBtn = document.getElementById('closeDrawer');
  const historyList = document.getElementById('historyList');
  const progressWrap = document.getElementById('progressWrap');
  const progressFill = document.getElementById('progressFill');
  const actionsIntroEl = document.getElementById('actionsIntro');
  const openaiKeyEl = document.getElementById('openaiKey');
  const summaryModeStatusEl = document.getElementById('summaryModeStatus');
  const summaryModeAiEl = document.getElementById('summaryModeAi');
  const summaryModeAiNoteEl = document.getElementById('summaryModeAiNote');
  const toastContainerEl = document.getElementById('toastContainer');
  const summaryChoiceOverlayEl = document.getElementById('summaryChoiceOverlay');
  const summaryChoiceButtonsViewEl = document.getElementById('summaryChoiceButtonsView');
  const summaryChoiceApiViewEl = document.getElementById('summaryChoiceApiView');
  const summaryChoiceHumanBtn = document.getElementById('summaryChoiceHuman');
  const summaryChoiceAiBtn = document.getElementById('summaryChoiceAi');
  const summaryChoiceApiDoneBtn = document.getElementById('summaryChoiceApiDone');
  const summaryChoiceApiStatusEl = document.getElementById('summaryChoiceApiStatus');
  const summaryChoiceTutorialToggle = document.getElementById('summaryChoiceTutorialToggle');
  const summaryChoiceTutorialBody = document.getElementById('summaryChoiceTutorialBody');
  const summaryChoiceReadyViewEl = document.getElementById('summaryChoiceReadyView');
  const summaryChoiceReadyMessageEl = document.getElementById('summaryChoiceReadyMessage');
  const summaryChoiceStartBtn = document.getElementById('summaryChoiceStartHumanBtn');
  const startSummarizeRowEl = document.getElementById('startSummarizeRow');
  const startSummarizeBtn = document.getElementById('startSummarizeBtn');

  var mode = 'continue';
  var summaryChoice = null; // 'human' | 'ai' | null; when null, Summarize shows choice modal first
  var lastSnapshotMode = null;
  var lastExportMode = 'continue';
  var lastContinueOutput = '';
  var lastSummaryOutput = '';

  var PLACEHOLDER = {
    continue: "We'll distill and pack your chat into a portable Egg you can drop into a new chat to continue.",
    summary: "We'll distill your chat into a clean summary Egg you can reuse or share."
  };
  var HELPER = {
    continue: '"Copy or download, drop it into a new chat to continue."',
    summary: '"Copy or download your summary Egg to reuse or share."'
  };
  var ACTION_COPY = {
    continue: { copyTitle: 'Copy Egg', copySub: 'READY-TO-PASTE PROMPT', downloadTitle: 'Download Egg', downloadSub: 'CONTINUE-CHAT FILE' },
    summary: { copyTitle: 'Copy Summary', copySub: '', downloadTitle: 'Download Report', downloadSub: '' }
  };

  var OPENAI_API_KEY_STORAGE = 'carryegg_openai_api_key';
  var MAX_TRANSCRIPT_CHARS = 12000;
  /** Above this length we chunk transcript and do segment summaries then merge. */
  var CHUNK_THRESHOLD = 8000;
  var CHUNK_SIZE = 6000;

  /** Pass 1: transcript -> JSON. Professional meeting notes: outcome-first, selective, no AI-generic filler. */
  var EXTRACT_MEETING_JSON_PROMPT =
    'You are writing real human-style meeting minutes. Be concise and outcome-oriented. Use the same language as the transcript. Do NOT copy sentences from the transcript; write NEW notes in neutral third-person. '
    + 'Prioritize clarity over completeness. Include only what materially changed understanding or direction. Avoid AI-generic phrasing like "identified issues", "discussed solutions", "explored options" unless clearly meaningful. '
    + 'Output a single JSON object with these exact keys. No quotes inside strings, no **, no emoji. '
    + '"topic": 1-2 concise sentences describing the overall discussion (max 40 words). '
    + '"decisions": array of highest-priority outcomes only; explicitly agreed or stated. If none: ["(None.)"]. Do not infer or speculate. '
    + '"key_themes": array of 3-5 short phrases max; only meaningful insights. Remove filler or generic points. '
    + '"how_evolved": array of max 3 short items showing how the discussion progressed (e.g. one sentence per stage). Omit or [] if not useful. '
    + '"next_steps": array of ONLY explicitly agreed or clearly requested actions. NEVER invent timelines ("next week", "soon"). If no clear action: []. '
    + '"context": one short sentence for background, or empty string. '
    + 'Output only the JSON object, no other text.';

  /** Pass 2: JSON -> markdown. Mandatory format: Topic, Decisions, Key Points, How the discussion evolved (optional), Next Steps (optional), Context (optional). */
  var JSON_TO_MEETING_NOTES_PROMPT =
    'Convert this JSON into meeting notes markdown. Same language as the JSON. Write like real human meeting minutes: concise, outcome-oriented, selective (not exhaustive). High information density; avoid repetition; short scannable bullets. '
    + 'Do not add new content beyond the JSON. Only include decisions and next steps that were explicitly agreed. Never invent timelines. '
    + 'Output exactly these sections in this order. Use only the JSON values. '
    + '"# Conversation Summary" then "## Topic" (topic: 1-2 concise sentences) then "## Decisions / Conclusions" (one bullet per item; if none write "(None.)") then "## Key Discussion Points" (3-5 bullets max; meaningful insights only) then "## How the discussion evolved" (optional; max 3 bullets; omit section if empty) then "## Next Steps" (optional; omit entire section if array is empty) then "## Context Snapshot" (optional; one line "Background: " + context; omit if empty). '
    + 'Output only the markdown.';

  /** For each segment when transcript is chunked. Same principles: selective, outcome-only, no invented timelines. */
  var SEGMENT_SUMMARY_PROMPT =
    'Summarize this segment as professional meeting notes. Concise, outcome-oriented. Do NOT copy sentences; write new notes in neutral third-person. Only include decisions and next steps explicitly agreed; never invent timelines. '
    + 'Output only: (1) topic: 1-2 short sentences, (2) decisions (or none), (3) key_themes: 2-4 meaningful phrases, (4) how_evolved: max 3 progression points if useful, (5) next_steps only if clearly agreed, (6) context one line if needed. No filler. No **. One line per item.';

  /** Merge segment summaries into one meeting notes document. Same format and quality rules. */
  var MERGE_NOTES_PROMPT =
    'From these segment summaries, write ONE set of meeting notes. Professional, human-style: concise, outcome-oriented, selective. Do NOT copy sentences verbatim. Same language as segments. Only include decisions and next steps that were explicitly agreed; never invent timelines. '
    + 'High information density; no repetition; short bullets. Avoid AI-generic wording. '
    + 'Output exactly in this order: "# Conversation Summary" then "## Topic" (1-2 sentences) then "## Decisions / Conclusions" (bullets or "(None.)") then "## Key Discussion Points" (3-5 bullets max) then "## How the discussion evolved" (optional; max 3 bullets; omit if empty) then "## Next Steps" (omit if none) then "## Context Snapshot" (optional; "Background: ..."; omit if empty). Markdown only.';

  /**
   * Format messages as plain transcript for Pass 1. Truncates if over MAX_TRANSCRIPT_CHARS (keeps tail).
   * @param {Array<{role:string, content_markdown?:string}>} messages
   * @returns {string}
   */
  function formatTranscript(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return '';
    var parts = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var role = (m && m.role) ? String(m.role) : 'assistant';
      var text = (m && m.content_markdown) ? String(m.content_markdown).trim() : '';
      if (!text) continue;
      var label = role === 'user' ? 'User' : 'Assistant';
      parts.push(label + ':\n' + text);
    }
    var transcript = parts.join('\n\n');
    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      transcript = transcript.slice(-MAX_TRANSCRIPT_CHARS);
    }
    return transcript;
  }

  /**
   * Validate API key with a minimal completion request. Used when user clicks Done in API config.
   * @param {string} apiKey
   * @returns {Promise<{valid:boolean, error?:string}>}
   */
  function validateOpenAIKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return Promise.resolve({ valid: false, error: 'Enter your API key' });
    }
    return fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey.trim() },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1
      })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          var errMsg = (data && data.error && data.error.message) ? String(data.error.message) : null;
          if (!res.ok && errMsg) return { valid: false, error: errMsg };
          if (data && data.error && errMsg) return { valid: false, error: errMsg };
          return { valid: true };
        }, function () {
          return { valid: false, error: 'Invalid response from API' };
        });
      })
      .catch(function () {
        return { valid: false, error: 'Network or request failed' };
      });
  }

  /**
   * Call OpenAI chat completions. Returns { content, error } so callers can show specific API errors.
   * @param {string} apiKey
   * @param {string} systemPrompt
   * @param {string} userContent
   * @param {number} [maxTokens=800]
   * @returns {Promise<{content:string, error:string|null}>}
   */
  function callOpenAI(apiKey, systemPrompt, userContent, maxTokens) {
    var tokens = (typeof maxTokens === 'number' && maxTokens > 0) ? maxTokens : 800;
    return fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: tokens,
        temperature: 0.3
      })
    })
      .then(function (res) {
        return res.json()
          .then(function (data) {
            var errMsg = (data && data.error && data.error.message) ? String(data.error.message) : null;
            if (!res.ok && errMsg) return { content: '', error: errMsg };
            if (!res.ok) return { content: '', error: res.status === 401 ? 'Invalid API key' : res.status === 429 ? 'Rate limit' : 'HTTP ' + res.status };
            if (data && data.error && errMsg) return { content: '', error: errMsg };
            var content = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? String(data.choices[0].message.content).trim() : '';
            return { content: content, error: null };
          })
          .catch(function () {
            if (!res.ok) return { content: '', error: res.status === 401 ? 'Invalid API key' : res.status === 429 ? 'Rate limit' : 'HTTP ' + res.status };
            return { content: '', error: 'Invalid response from API' };
          });
      })
      .catch(function () {
        return { content: '', error: 'Network or request failed' };
      });
  }

  /**
   * Lightweight check that polished output has the required structure. If not, we fall back to draft.
   * @param {string} text
   * @returns {boolean}
   */
  function isValidPolishedStructure(text) {
    if (!text || typeof text !== 'string') return false;
    var t = text.trim();
    if (t.indexOf('# Conversation Summary') !== 0) return false;
    if (t.indexOf('## Topic') === -1) return false;
    if (t.indexOf('## Decisions / Conclusions') === -1) return false;
    if (t.indexOf('## Key Discussion Points') === -1) return false;
    return true;
  }

  /** Max length for Topic section body (1-2 sentences). Longer = likely pasted conversation. */
  var MAX_TOPIC_BODY_LENGTH = 320;

  function isTopicSectionReasonable(text) {
    if (!text || typeof text !== 'string') return false;
    var topicStart = text.indexOf('## Topic');
    if (topicStart === -1) return false;
    var afterTopic = topicStart + 8;
    var nextH2 = text.indexOf('\n## ', afterTopic);
    var end = nextH2 !== -1 ? nextH2 : text.length;
    var body = text.slice(afterTopic, end).replace(/#+/g, '').trim();
    if (body.length > MAX_TOPIC_BODY_LENGTH) return false;
    if (body.indexOf('**') !== -1) return false;
    if (/直话直说|此对话|我(们)?(认为|觉得|看)/.test(body)) return false;
    return true;
  }

  /**
   * Generate meeting notes from FULL chat transcript only. API input is ALWAYS transcript (never draft).
   * If transcript is too long, chunks it and does segment summaries then merge. Falls back to draft on any failure.
   * @param {string} transcript - Full transcript (User:\n...\n\nAssistant:\n...)
   * @param {string} apiKey
   * @param {string} draft - Rule-based summary (fallback only, never sent to API)
   * @param {function(string|null)} [onApiFallback]
   * @param {function(number, string|null)} [setProgressFn] - Optional. (pct 0-100, statusText). Called during API steps.
   * @returns {Promise<{text:string, fromApi:boolean}>}
   */
  function generateMeetingNotesFromTranscript(transcript, apiKey, draft, onApiFallback, setProgressFn) {
    var fallback = { text: draft || '', fromApi: false, errorReason: null };
    if (!transcript || typeof transcript !== 'string') return Promise.resolve(fallback);
    transcript = transcript.trim();
    if (!transcript) return Promise.resolve(fallback);

    function progress(pct, text) {
      try { if (typeof setProgressFn === 'function') setProgressFn(pct, text); } catch (_) {}
    }

    try {
      if (typeof console !== 'undefined' && console.log) {
        console.log('[Snapshot Debug] generateMeetingNotesFromTranscript: API input is TRANSCRIPT only (no draft). length=' + transcript.length + ' preview (first 500 chars):', transcript.slice(0, 500));
      }
    } catch (_) {}

    function validateAndReturn(content, lastError) {
      if (!content || !isValidPolishedStructure(content)) {
        try { if (console && console.log) console.log('[Snapshot Debug] API result rejected: invalid structure', lastError || ''); } catch (_) {}
        fallback.errorReason = lastError || 'Invalid format';
        if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
        return fallback;
      }
      if (!isTopicSectionReasonable(content)) {
        try { if (console && console.log) console.log('[Snapshot Debug] API result rejected: Topic too long or contains pasted content'); } catch (_) {}
        fallback.errorReason = 'Summary too long; using basic version.';
        if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
        return fallback;
      }
      try { if (console && console.log) console.log('[Snapshot Debug] Using API meeting notes (validation passed)'); } catch (_) {}
      return { text: content, fromApi: true };
    }

    function parseMeetingJson(raw) {
      if (!raw || typeof raw !== 'string') return null;
      var s = raw.trim().replace(/^```(?:json)?\s*|```$/g, '').trim();
      try {
        var o = JSON.parse(s);
        return o && typeof o === 'object' ? o : null;
      } catch (_) { return null; }
    }

    if (transcript.length > CHUNK_THRESHOLD) {
      progress(20, 'Summarizing long chat…');
      var chunks = [];
      for (var i = 0; i < transcript.length; i += CHUNK_SIZE) {
        chunks.push(transcript.slice(i, i + CHUNK_SIZE));
      }
      var segmentPromises = chunks.map(function (chunk) {
        return callOpenAI(apiKey, SEGMENT_SUMMARY_PROMPT, chunk, 400);
      });
      return Promise.all(segmentPromises)
        .then(function (results) {
          progress(55, 'Merging segments…');
          var lastErr = null;
          var segments = [];
          for (var s = 0; s < results.length; s++) {
            if (results[s].error) lastErr = results[s].error;
            if (results[s].content) segments.push(results[s].content);
          }
          if (segments.length === 0) {
            fallback.errorReason = lastErr || 'Chunk API failed';
            if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
            progress(100, null);
            return fallback;
          }
          var combined = 'Segment summaries:\n\n' + segments.join('\n\n---\n\n');
          return callOpenAI(apiKey, MERGE_NOTES_PROMPT, combined, 900);
        })
        .then(function (result) {
          var content = (result && result.content) ? result.content : '';
          var err = (result && result.error) ? result.error : null;
          progress(100, null);
          return validateAndReturn(content, err);
        })
        .catch(function () {
          fallback.errorReason = 'Request failed';
          if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
          progress(100, null);
          return fallback;
        });
    }

    progress(25, 'Step 1/2: Extracting structure…');
    return callOpenAI(apiKey, EXTRACT_MEETING_JSON_PROMPT, transcript, 600)
      .then(function (result) {
        progress(50, null);
        if (result.error && typeof console !== 'undefined' && console.log) console.log('[Snapshot Debug] Pass 1 error:', result.error);
        if (!result.content) {
          fallback.errorReason = result.error || 'API error';
          if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
          progress(100, null);
          return fallback;
        }
        var json = parseMeetingJson(result.content);
        if (!json || !json.topic) {
          fallback.errorReason = 'Invalid JSON from API';
          if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
          progress(100, null);
          return fallback;
        }
        progress(55, 'Step 2/2: Writing notes…');
        var jsonStr = JSON.stringify(json);
        return callOpenAI(apiKey, JSON_TO_MEETING_NOTES_PROMPT, jsonStr, 700);
      })
      .then(function (result) {
        if (!result) {
          progress(100, null);
          return fallback;
        }
        var content = (result.content) ? result.content : '';
        var err = (result.error) ? result.error : null;
        progress(100, null);
        return validateAndReturn(content, err);
      })
      .catch(function () {
        fallback.errorReason = 'Request failed';
        if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
        progress(100, null);
        return fallback;
      });
  }

  /**
   * Summary mode API path: get apiKey and transcript from messages, call generateMeetingNotesFromTranscript.
   * Draft is only used as fallback; API never receives draft.
   * @param {function(string)} [setStatusFn] - Optional; called when no key so UI can show reason.
   * @param {function(number, string|null)} [setProgressFn] - Optional. (pct 0-100, statusText). Shown during API steps.
   */
  function runSummaryWithTranscript(messages, draft, onApiFallback, setStatusFn, setProgressFn) {
    var fallback = { text: draft || '', fromApi: false };
    if (!Array.isArray(messages) || messages.length === 0) return Promise.resolve(fallback);
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(OPENAI_API_KEY_STORAGE, function (stored) {
          var apiKey = (stored && stored[OPENAI_API_KEY_STORAGE]) ? String(stored[OPENAI_API_KEY_STORAGE]).trim() : '';
          if (!apiKey && openaiKeyEl && openaiKeyEl.value) {
            apiKey = String(openaiKeyEl.value).trim();
            if (apiKey) {
              try {
                var o = {};
                o[OPENAI_API_KEY_STORAGE] = apiKey;
                chrome.storage.local.set(o);
              } catch (_) {}
            }
          }
          if (!apiKey) {
            try { if (console && console.log) console.log('[Snapshot Debug] No API key — using draft.'); } catch (_) {}
            if (typeof setStatusFn === 'function') setStatusFn('No API key — using basic summary.');
            resolve(fallback);
            return;
          }
          var transcript = formatTranscript(messages);
          if (!transcript) {
            if (typeof setStatusFn === 'function') setStatusFn('No transcript — using basic summary.');
            resolve(fallback);
            return;
          }
          try { if (console && console.log) console.log('[Snapshot Debug] Calling API with transcript, length=' + transcript.length); } catch (_) {}
          try { if (typeof setProgressFn === 'function') setProgressFn(20, 'Calling API for meeting notes…'); } catch (_) {}
          if (typeof setStatusFn === 'function') setStatusFn('Calling API for meeting notes…');
          generateMeetingNotesFromTranscript(transcript, apiKey, draft, onApiFallback, setProgressFn)
            .then(resolve)
            .catch(function (err) {
              try { if (console && console.log) console.log('[Snapshot Debug] runSummaryWithTranscript inner catch:', err); } catch (_) {}
              fallback.errorReason = (err && err.message) ? String(err.message) : 'Request failed';
              if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
              resolve(fallback);
            });
        });
      } catch (_) {
        resolve(fallback);
      }
    });
  }

  /**
   * Non-blocking toast. No modal, no alert. Auto-dismisses.
   * @param {string} message
   */
  function showToast(message) {
    if (!toastContainerEl || !message) return;
    try {
      var toast = document.createElement('div');
      toast.className = 'toast';
      toast.textContent = message;
      toastContainerEl.appendChild(toast);
      setTimeout(function () {
        try { if (toast.parentNode) toast.parentNode.removeChild(toast); } catch (_) {}
      }, 4000);
    } catch (_) {}
  }

  function openSummaryChoiceModal() {
    try {
      if (summaryChoiceButtonsViewEl) summaryChoiceButtonsViewEl.classList.remove('hidden');
      if (summaryChoiceApiViewEl) summaryChoiceApiViewEl.classList.remove('visible');
      if (summaryChoiceReadyViewEl) summaryChoiceReadyViewEl.classList.remove('visible');
      if (summaryChoiceOverlayEl) {
        summaryChoiceOverlayEl.classList.add('visible');
        summaryChoiceOverlayEl.setAttribute('aria-hidden', 'false');
      }
    } catch (_) {}
  }

  function closeSummaryChoiceModal() {
    try {
      if (summaryChoiceOverlayEl) {
        summaryChoiceOverlayEl.classList.remove('visible');
        summaryChoiceOverlayEl.setAttribute('aria-hidden', 'true');
      }
      if (summaryChoiceButtonsViewEl) summaryChoiceButtonsViewEl.classList.remove('hidden');
      if (summaryChoiceApiViewEl) summaryChoiceApiViewEl.classList.remove('visible');
      if (summaryChoiceReadyViewEl) summaryChoiceReadyViewEl.classList.remove('visible');
    } catch (_) {}
  }

  /**
   * Update Summary mode status block: show Basic / AI Enhanced and note when no key.
   * Only visible when mode === 'summary'.
   */
  function updateSummaryModeStatus() {
    try {
      if (!summaryModeStatusEl) return;
      if (mode !== 'summary') {
        summaryModeStatusEl.classList.remove('visible');
        summaryModeStatusEl.setAttribute('aria-hidden', 'true');
        return;
      }
      summaryModeStatusEl.classList.add('visible');
      summaryModeStatusEl.setAttribute('aria-hidden', 'false');
      var hasKey = !!(openaiKeyEl && openaiKeyEl.value && String(openaiKeyEl.value).trim());
      if (summaryModeAiEl) {
        summaryModeAiEl.classList.toggle('muted', !hasKey);
      }
      if (summaryModeAiNoteEl) {
        summaryModeAiNoteEl.classList.toggle('visible', !hasKey);
      }
    } catch (_) {}
  }

  function setMode(m) {
    mode = m;
    lastExportMode = m;
    try {
      if (btnContinue) {
        btnContinue.classList.toggle('selected', m === 'continue');
        btnContinue.setAttribute('aria-pressed', m === 'continue' ? 'true' : 'false');
      }
      if (btnSummarize) {
        btnSummarize.classList.toggle('selected', m === 'summary');
        btnSummarize.setAttribute('aria-pressed', m === 'summary' ? 'true' : 'false');
      }
      if (outEl) {
        outEl.placeholder = (PLACEHOLDER[m] || PLACEHOLDER.continue);
      }
      var stored = m === 'continue' ? lastContinueOutput : lastSummaryOutput;
      setOutput(stored);
      setButtons(!!stored);
      if (actionsIntroEl) actionsIntroEl.textContent = (HELPER[m] || HELPER.continue);
      var labels = ACTION_COPY[m] || ACTION_COPY.continue;
      var copyMain = btnCopy ? btnCopy.querySelector('.btn-main') : null;
      var copySub = btnCopy ? btnCopy.querySelector('.btn-sub') : null;
      var dlMain = btnDownload ? btnDownload.querySelector('.btn-main') : null;
      var dlSub = btnDownload ? btnDownload.querySelector('.btn-sub') : null;
      if (copyMain) copyMain.textContent = labels.copyTitle;
      if (copySub) copySub.textContent = labels.copySub;
      if (dlMain) dlMain.textContent = labels.downloadTitle;
      if (dlSub) dlSub.textContent = labels.downloadSub;
      updateSummaryModeStatus();
      if (startSummarizeRowEl) {
        startSummarizeRowEl.classList.remove('visible');
        startSummarizeRowEl.setAttribute('aria-hidden', 'true');
      }
    } catch (e) {
      if (typeof console !== 'undefined' && console.log) console.log('[Snapshot Debug] setMode:', e);
    }
  }

  function showProgress() {
    try {
      if (progressWrap) progressWrap.classList.add('visible');
      setProgressPercent(0);
    } catch (_) {}
  }

  function hideProgress() {
    try {
      if (progressWrap) progressWrap.classList.remove('visible');
    } catch (_) {}
  }

  function setProgressPercent(pct) {
    try {
      if (progressFill) progressFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    } catch (_) {}
  }

  function setStatus(text) {
    try {
      if (statusEl) statusEl.textContent = text || '';
    } catch (_) {}
  }

  function setOutput(md) {
    try {
      if (outEl) outEl.value = md || '';
    } catch (_) {}
  }

  function setButtons(enabled) {
    try {
      if (btnCopy) btnCopy.disabled = !enabled;
      if (btnDownload) btnDownload.disabled = !enabled;
    } catch (_) {}
  }

  function setBusy(busy) {
    try {
      if (btnContinue) btnContinue.disabled = busy;
      if (btnSummarize) btnSummarize.disabled = busy;
    } catch (_) {}
  }

  function getActiveTab() {
    return new Promise(function (resolve, reject) {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!tabs || tabs.length === 0) {
            reject(new Error('No active tab'));
            return;
          }
          resolve(tabs[0]);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function sendToContent(tabId, msg) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.tabs.sendMessage(tabId, msg, function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function injectContentScript(tabId) {
    return new Promise(function (resolve, reject) {
      try {
        if (typeof chrome === 'undefined' || !chrome.scripting || typeof chrome.scripting.executeScript !== 'function') {
          reject(new Error('chrome.scripting not available. Check "scripting" permission and reload the extension.'));
          return;
        }
        chrome.scripting.executeScript(
          { target: { tabId }, files: ['content.js'] },
          function () {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve();
          }
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Send message to content script. If "Receiving end does not exist", inject
   * content.js, sleep 150ms, then retry once (avoids race on some machines).
   */
  function ensureContentAndSend(tabId, msg) {
    return sendToContent(tabId, msg).catch(function (err) {
      var m = (err && err.message) ? err.message : '';
      var noReceiver = m.indexOf('Receiving end does not exist') !== -1 ||
        m.indexOf('Could not establish connection') !== -1;
      if (!noReceiver) return Promise.reject(err);
      return injectContentScript(tabId)
        .then(function () { return sleep(150); })
        .then(function () { return sendToContent(tabId, msg); });
    });
  }

  function isChatGptTab(tab) {
    try {
      const url = (tab && tab.url) ? tab.url : '';
      return /^https:\/\/chatgpt\.com\/?/.test(url);
    } catch (_) {
      return false;
    }
  }

  /**
   * Run full snapshot extraction and build snapshot with the given export mode.
   * @param {string} exportMode - 'continue' | 'summary'
   * @param {{ basicOnly?: boolean }} [opts] - basicOnly: true = summary without AI polish (use draft only)
   */
  function runFull(exportMode, opts) {
    setStatus('Rolling...');
    setOutput('');
    setButtons(false);
    setBusy(true);
    showProgress();

    var fullDone = false;
    var requestId = Date.now().toString();

    function onMessage(payload) {
      try {
        if (!payload || !payload.type) return;
        if (payload.requestId !== requestId) return;
        if (payload.type === 'snapshotProgress' && payload.status) {
          var t = (payload.status || '').replace(/^\[Snapshot Debug\]\s*/i, '');
          setStatus(t || 'Rolling...');
          if (payload.pass != null && payload.maxLoops && payload.maxLoops > 0) {
            setProgressPercent((payload.pass / payload.maxLoops) * 100);
          }
          return;
        }
        if (payload.type === 'fullSnapshotDone' && payload.result && !fullDone) {
          fullDone = true;
          lastSnapshotMode = 'whole';
          removeListener();
          var messages = (payload.result.messages || []);
          if (messages.length === 0) {
            hideProgress();
            setOutput('');
            setStatus('No content extracted. Scroll the chat to the top first, then try again.');
            setButtons(false);
            setBusy(false);
            return;
          }
          var md = buildContinuationSnapshotMarkdown(messages, exportMode);
          if (exportMode === 'continue') {
            hideProgress();
            lastContinueOutput = md;
            setMode(exportMode);
            setStatus('Egg is served! (' + messages.length + ' msgs)');
            setBusy(false);
            if (md) saveToCarton(md);
          } else {
            var basicOnly = !!(opts && opts.basicOnly);
            if (basicOnly) {
              hideProgress();
              lastSummaryOutput = md;
              setMode(exportMode);
              setStatus('Egg is served! (' + messages.length + ' msgs)');
              setBusy(false);
              if (md) saveToCarton(md);
            } else {
              setProgressPercent(20);
              setStatus('Calling API for meeting notes…');
              var progressFn = function (pct, text) {
                setProgressPercent(pct);
                if (text != null) setStatus(text);
              };
              runSummaryWithTranscript(messages, md, function (errMsg) {
                showToast(errMsg || 'AI polish unavailable — showing basic summary.');
              }, setStatus, progressFn).then(function (result) {
                hideProgress();
                var polished = result && result.text ? result.text : '';
                var fromApi = !!(result && result.fromApi);
                var reason = (result && result.errorReason) ? String(result.errorReason) : '';
                lastSummaryOutput = polished;
                setMode(exportMode);
                setStatus(fromApi ? 'Egg is served! (' + messages.length + ' msgs)' : 'Using basic summary. ' + (reason ? '(' + reason + ')' : '(API failed or unavailable)'));
                setBusy(false);
                if (polished) saveToCarton(polished);
              }).catch(function (err) {
                hideProgress();
                try { if (console && console.log) console.log('[Snapshot Debug] runSummary summary path catch:', err); } catch (_) {}
                setStatus('Summary failed. ' + (err && err.message ? err.message : 'Please try again.'));
                setBusy(false);
              });
            }
          }
        }
      } catch (_) {}
    }

    function removeListener() {
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch (_) {}
    }

    function teardown() {
      removeListener();
      hideProgress();
      setBusy(false);
    }

    try {
      chrome.runtime.onMessage.addListener(onMessage);
    } catch (_) {}

    getActiveTab()
      .then(function (tab) {
        if (!isChatGptTab(tab)) {
          setStatus('Open a ChatGPT chat first!');
          teardown();
          return;
        }
        return ensureContentAndSend(tab.id, { type: 'fullSnapshot', requestId: requestId });
      })
      .then(function (res) {
        removeListener();
        if (fullDone) return;
        if (!res) return;
        fullDone = true;
        lastSnapshotMode = 'whole';
        var messages = (res.messages || []);
        if (messages.length === 0) {
          hideProgress();
          setOutput('');
          setStatus('No content extracted. Scroll the chat to the top first, then try again.');
          setButtons(false);
          setBusy(false);
          return;
        }
        var md = buildContinuationSnapshotMarkdown(messages, exportMode);
        if (exportMode === 'continue') {
          hideProgress();
          lastContinueOutput = md;
          setMode(exportMode);
          setStatus('Egg is served! (' + messages.length + ' msgs)');
          setBusy(false);
          if (md) saveToCarton(md);
        } else {
          var basicOnly = !!(opts && opts.basicOnly);
          if (basicOnly) {
            hideProgress();
            lastSummaryOutput = md;
            setMode(exportMode);
            setStatus('Egg is served! (' + messages.length + ' msgs)');
            setBusy(false);
            if (md) saveToCarton(md);
          } else {
            setProgressPercent(20);
            setStatus('Calling API for meeting notes…');
            var progressFn = function (pct, text) {
              setProgressPercent(pct);
              if (text != null) setStatus(text);
            };
            runSummaryWithTranscript(messages, md, function (errMsg) {
              showToast(errMsg || 'AI polish unavailable — showing basic summary.');
            }, setStatus, progressFn).then(function (result) {
              hideProgress();
              var polished = result && result.text ? result.text : '';
              var fromApi = !!(result && result.fromApi);
              var reason = (result && result.errorReason) ? String(result.errorReason) : '';
              lastSummaryOutput = polished;
              setMode(exportMode);
              setStatus(fromApi ? 'Egg is served! (' + messages.length + ' msgs)' : 'Using basic summary. ' + (reason ? '(' + reason + ')' : '(API failed or unavailable)'));
              setBusy(false);
              if (polished) saveToCarton(polished);
            }).catch(function (err) {
              hideProgress();
              try { if (console && console.log) console.log('[Snapshot Debug] runSummary full path catch:', err); } catch (_) {}
              setStatus('Summary failed. ' + (err && err.message ? err.message : 'Please try again.'));
              setBusy(false);
            });
          }
        }
      })
      .catch(function (err) {
        teardown();
        if (fullDone) return;
        setStatus(err && err.message ? err.message : 'Something went wrong');
        setOutput('');
        setButtons(false);
      })
      .then(function () {
        if (!fullDone) setBusy(false);
      });
  }

  function copyOutput() {
    const text = outEl ? outEl.value : '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      function () { setStatus('Copied to clipboard!'); },
      function () { setStatus('Copy failed.'); }
    );
  }

  /**
   * Convert summary markdown to Word-friendly HTML. Recognizes #/## headings, **bold**, and bullet lists.
   * Returns a full HTML document ready to save as .doc for a ready-to-submit meeting report.
   */
  function summaryMarkdownToWordHtml(md) {
    if (!md || typeof md !== 'string') return '';
    var lines = md.split(/\r?\n/);
    var out = [];
    var i = 0;
    function escapeHtml(s) {
      if (!s) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    function inlineFormat(s) {
      if (!s) return '';
      return String(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }
    var inList = false;
    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();
      i++;
      if (trimmed === '') {
        if (inList) { out.push('</ul>'); inList = false; }
        continue;
      }
      if (/^#\s+/.test(trimmed)) {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push('<h1>' + escapeHtml(trimmed.replace(/^#\s+/, '')) + '</h1>');
        continue;
      }
      if (/^##\s+/.test(trimmed)) {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push('<h2>' + escapeHtml(trimmed.replace(/^##\s+/, '')) + '</h2>');
        continue;
      }
      if (/^###\s+/.test(trimmed)) {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push('<h3>' + escapeHtml(trimmed.replace(/^###\s+/, '')) + '</h3>');
        continue;
      }
      if (/^[-*]\s+/.test(trimmed)) {
        if (!inList) { out.push('<ul>'); inList = true; }
        var bulletText = trimmed.replace(/^[-*]\s+/, '');
        out.push('<li>' + inlineFormat(escapeHtml(bulletText)) + '</li>');
        continue;
      }
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('<p>' + inlineFormat(escapeHtml(trimmed)) + '</p>');
    }
    if (inList) out.push('</ul>');
    var bodyHtml = out.join('\n');
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8"/>\n<meta name="ProgId" content="Word.Document"/>\n<title>Meeting Summary</title>\n<style>\nbody{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4;margin:1in;}\nh1{font-size:16pt;font-weight:bold;margin:0 0 12pt 0;}\nh2{font-size:12pt;font-weight:bold;margin:12pt 0 6pt 0;}\nh3{font-size:11pt;font-weight:bold;margin:8pt 0 4pt 0;}p,li{margin:0 0 6pt 0;}ul{margin:0 0 6pt 0;padding-left:24pt;}\n</style>\n</head>\n<body>\n' + bodyHtml + '\n</body>\n</html>';
  }

  function downloadOutput() {
    var text = outEl ? outEl.value : '';
    if (!text) return;
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    var datePart = y + '-' + m + '-' + d;
    var snapMode = (lastSnapshotMode === 'quick' || lastSnapshotMode === 'whole') ? lastSnapshotMode : 'snapshot';
    var exportMode = (lastExportMode === 'summary') ? 'summary' : 'continue';
    var blob, name, mimeType;
    if (exportMode === 'summary') {
      name = 'meeting-summary-' + datePart + '.doc';
      var wordHtml = summaryMarkdownToWordHtml(text);
      blob = new Blob([wordHtml], { type: 'application/msword;charset=utf-8' });
    } else {
      name = 'carryegg-' + exportMode + '-' + snapMode + '-' + datePart + '.md';
      blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Saved! ' + name);
  }

  // ========== History / Carton Logic ==========

  const CARTON_KEY = 'egg_history';
  const MAX_HISTORY = 5;

  function saveToCarton(text) {
    if (!text) return;
    try {
      const now = new Date();
      const dateStr = now.toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      const item = {
        id: now.getTime(),
        date: dateStr,
        content: text
      };
      let history = [];
      try {
        const stored = localStorage.getItem(CARTON_KEY);
        if (stored) history = JSON.parse(stored);
      } catch (_) {}
      if (!Array.isArray(history)) history = [];
      history.unshift(item);
      if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
      localStorage.setItem(CARTON_KEY, JSON.stringify(history));
      renderCarton();
    } catch (_) {}
  }

  function renderCarton() {
    if (!historyList) return;
    try {
      let history = [];
      try {
        const stored = localStorage.getItem(CARTON_KEY);
        if (stored) history = JSON.parse(stored);
      } catch (_) {}
      if (!Array.isArray(history)) history = [];
      if (history.length === 0) {
        historyList.innerHTML = '<div class="empty-state">No eggs in the carton yet.</div>';
        return;
      }
      historyList.innerHTML = '';
      history.forEach(function (item) {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.dataset.id = item.id;
        const preview = (item.content || '').slice(0, 60).replace(/\n/g, ' ') + '...';
        const main = document.createElement('div');
        main.className = 'history-item-main';
        const dateEl = document.createElement('div');
        dateEl.className = 'history-item-date';
        dateEl.textContent = item.date || '';
        const previewEl = document.createElement('div');
        previewEl.className = 'history-item-preview';
        previewEl.textContent = preview;
        main.appendChild(dateEl);
        main.appendChild(previewEl);
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'history-item-copy';
        copyBtn.title = 'Copy';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!item.content) return;
          navigator.clipboard.writeText(item.content).then(
            function () { setStatus('Copied!'); },
            function () { setStatus('Copy failed.'); }
          );
        });
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'history-item-delete';
        deleteBtn.title = 'Delete';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          removeFromCarton(item.id);
        });
        div.appendChild(main);
        div.appendChild(copyBtn);
        div.appendChild(deleteBtn);
        div.addEventListener('click', function () {
          restoreFromCarton(item.content);
        });
        historyList.appendChild(div);
      });
    } catch (_) {}
  }

  function restoreFromCarton(content) {
    setOutput(content);
    setStatus('Restored from Carton!');
    setButtons(!!content);
    closeDrawer();
  }

  function removeFromCarton(id) {
    try {
      let history = [];
      try {
        const stored = localStorage.getItem(CARTON_KEY);
        if (stored) history = JSON.parse(stored);
      } catch (_) {}
      if (!Array.isArray(history)) history = [];
      history = history.filter(function (item) { return item.id !== id; });
      localStorage.setItem(CARTON_KEY, JSON.stringify(history));
      renderCarton();
      setStatus('Deleted.');
    } catch (_) {}
  }

  function openDrawer() {
    if (historyDrawer) historyDrawer.classList.add('open');
  }

  function closeDrawer() {
    if (historyDrawer) historyDrawer.classList.remove('open');
  }

  if (cartonBtn) cartonBtn.addEventListener('click', function () {
    renderCarton();
    openDrawer();
  });

  if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeDrawer);

  // Load / save OpenAI API key for optional Summary polish
  if (openaiKeyEl) {
    try {
      chrome.storage.local.get(OPENAI_API_KEY_STORAGE, function (stored) {
        var val = (stored && stored[OPENAI_API_KEY_STORAGE]) ? String(stored[OPENAI_API_KEY_STORAGE]) : '';
        openaiKeyEl.value = val;
        updateSummaryModeStatus();
      });
      openaiKeyEl.addEventListener('blur', function () {
        var val = (openaiKeyEl.value || '').trim();
        try {
          var o = {};
          o[OPENAI_API_KEY_STORAGE] = val;
          chrome.storage.local.set(o);
          updateSummaryModeStatus();
        } catch (_) {}
      });
    } catch (_) {}
  }

  // Close drawer when clicking outside
  if (historyDrawer) {
    historyDrawer.addEventListener('click', function (e) {
      if (e.target === historyDrawer) closeDrawer();
    });
  }

  // ========== Main Event Listeners ==========

  if (btnContinue) btnContinue.addEventListener('click', function () {
    summaryChoice = null;
    setMode('continue');
    runFull('continue');
  });
  if (btnSummarize) btnSummarize.addEventListener('click', function () {
    setMode('summary');
    openSummaryChoiceModal();
  });
  if (startSummarizeBtn) startSummarizeBtn.addEventListener('click', function () {
    runFull('summary', { basicOnly: summaryChoice === 'ai' });
  });

  if (summaryChoiceHumanBtn) summaryChoiceHumanBtn.addEventListener('click', function () {
    summaryChoice = 'human';
    if (summaryChoiceButtonsViewEl) summaryChoiceButtonsViewEl.classList.add('hidden');
    if (summaryChoiceApiViewEl) summaryChoiceApiViewEl.classList.add('visible');
    if (summaryChoiceReadyViewEl) summaryChoiceReadyViewEl.classList.remove('visible');
    if (summaryChoiceTutorialToggle) summaryChoiceTutorialToggle.setAttribute('aria-expanded', 'false');
    if (summaryChoiceTutorialBody) summaryChoiceTutorialBody.hidden = true;
  });
  if (summaryChoiceTutorialToggle && summaryChoiceTutorialBody) {
    summaryChoiceTutorialToggle.addEventListener('click', function () {
      var expanded = summaryChoiceTutorialToggle.getAttribute('aria-expanded') === 'true';
      summaryChoiceTutorialToggle.setAttribute('aria-expanded', !expanded);
      summaryChoiceTutorialBody.hidden = expanded;
    });
  }
  if (summaryChoiceApiDoneBtn) summaryChoiceApiDoneBtn.addEventListener('click', function () {
    var val = (openaiKeyEl && openaiKeyEl.value) ? String(openaiKeyEl.value).trim() : '';
    if (!val) {
      showToast('Enter your API key');
      return;
    }
    if (summaryChoiceApiStatusEl) {
      summaryChoiceApiStatusEl.textContent = 'Verifying API key...';
      summaryChoiceApiStatusEl.classList.add('verifying');
    }
    summaryChoiceApiDoneBtn.disabled = true;
    validateOpenAIKey(val)
      .then(function (result) {
        if (summaryChoiceApiStatusEl) {
          summaryChoiceApiStatusEl.textContent = '';
          summaryChoiceApiStatusEl.classList.remove('verifying');
        }
        summaryChoiceApiDoneBtn.disabled = false;
        if (!result.valid) {
          showToast(result.error || 'Invalid API key');
          return;
        }
        if (summaryChoiceApiStatusEl) {
          summaryChoiceApiStatusEl.textContent = 'Success!';
          summaryChoiceApiStatusEl.classList.remove('verifying');
        }
        showToast('API key saved');
        summaryChoice = 'human';
        try {
          var o = {};
          o[OPENAI_API_KEY_STORAGE] = val;
          chrome.storage.local.set(o);
        } catch (_) {}
        if (summaryChoiceApiViewEl) summaryChoiceApiViewEl.classList.remove('visible');
        if (summaryChoiceReadyMessageEl) summaryChoiceReadyMessageEl.textContent = 'API key saved. Ready to generate.';
        if (summaryChoiceReadyViewEl) summaryChoiceReadyViewEl.classList.add('visible');
      })
      .catch(function () {
        if (summaryChoiceApiStatusEl) {
          summaryChoiceApiStatusEl.textContent = '';
          summaryChoiceApiStatusEl.classList.remove('verifying');
        }
        summaryChoiceApiDoneBtn.disabled = false;
        showToast('Verification failed');
      });
  });
  if (summaryChoiceAiBtn) summaryChoiceAiBtn.addEventListener('click', function () {
    summaryChoice = 'ai';
    if (summaryChoiceButtonsViewEl) summaryChoiceButtonsViewEl.classList.add('hidden');
    if (summaryChoiceReadyMessageEl) summaryChoiceReadyMessageEl.textContent = 'Basic summary only. Ready to generate.';
    if (summaryChoiceReadyViewEl) summaryChoiceReadyViewEl.classList.add('visible');
  });
  function runSummaryFromModal(basicOnly) {
    closeSummaryChoiceModal();
    setMode('summary');
    runFull('summary', { basicOnly: basicOnly });
  }
  if (summaryChoiceStartBtn) summaryChoiceStartBtn.addEventListener('click', function () {
    runSummaryFromModal(summaryChoice === 'ai');
  });
  if (btnCopy) btnCopy.addEventListener('click', copyOutput);
  if (btnDownload) btnDownload.addEventListener('click', downloadOutput);

  setMode('continue');
})();
