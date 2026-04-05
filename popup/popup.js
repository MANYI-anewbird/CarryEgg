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
  const summaryChoiceApiViewEl = document.getElementById('summaryChoiceApiView');
  const summaryChoiceApiDoneBtn = document.getElementById('summaryChoiceApiDone');
  const summaryChoiceApiStatusEl = document.getElementById('summaryChoiceApiStatus');
  const summaryChoiceTutorialToggle = document.getElementById('summaryChoiceTutorialToggle');
  const summaryChoiceTutorialBody = document.getElementById('summaryChoiceTutorialBody');
  const summaryChoiceReadyViewEl = document.getElementById('summaryChoiceReadyView');
  const summaryChoiceReadyMessageEl = document.getElementById('summaryChoiceReadyMessage');
  const summaryChoiceStartBtn = document.getElementById('summaryChoiceStartHumanBtn');
  const startSummarizeRowEl = document.getElementById('startSummarizeRow');
  const startSummarizeBtn = document.getElementById('startSummarizeBtn');
  const digestApiKeyOptionRow = document.getElementById('digestApiKeyOptionRow');
  const changeOpenaiKeyBtn = document.getElementById('changeOpenaiKeyBtn');
  const digestModalHintEl = document.getElementById('digestModalHint');
  const summaryChoiceRunDigestBtn = document.getElementById('summaryChoiceRunDigestBtn');

  /**
   * True when the modal was opened from a rate limit (stay on API key view after Done so the user can keep editing).
   */
  var digestModalStayOnApiAfterSave = false;

  /** Default copy for #digestModalHint (reset when closing the digest modal). */
  var DEFAULT_DIGEST_MODAL_HINT = 'Summarize builds an API-generated archive digest. Add your OpenAI key below (it stays on this device).';

  var mode = 'continue';
  var lastSnapshotMode = null;
  var lastExportMode = 'continue';
  var lastContinueOutput = '';
  var lastSummaryOutput = '';

  var PLACEHOLDER = {
    continue: "We'll distill and pack your chat into a portable Egg you can drop into a new chat to continue.",
    summary: "We'll turn your chat into a Chat Digest — an API-generated archive you can keep or share."
  };
  var HELPER = {
    continue: '"Copy or download, drop it into a new chat to continue."',
    summary: '"Copy or download your Chat Digest."'
  };
  var ACTION_COPY = {
    continue: { copyTitle: 'Copy Egg', copySub: 'READY-TO-PASTE PROMPT', downloadTitle: 'Download Egg', downloadSub: 'CONTINUE-CHAT FILE' },
    summary: { copyTitle: 'Copy Digest', copySub: '', downloadTitle: 'Download Digest', downloadSub: '' }
  };

  var OPENAI_API_KEY_STORAGE = 'carryegg_openai_api_key';
  var MAX_TRANSCRIPT_CHARS = 12000;
  /** Above this length we chunk transcript and do segment summaries then merge. */
  var CHUNK_THRESHOLD = 8000;
  var CHUNK_SIZE = 6000;

  /** Model for digest API calls. Use "gpt-4o" for higher quality (higher cost). */
  var SUMMARY_MODEL = 'gpt-4o';

  /**
   * Single-call short-chat digest: system prompt. User message is the full transcript.
   */
  var DIGEST_SYSTEM_PROMPT =
    'You write a Chat Digest — an archive card of an AI chat worth saving, not a continuation snapshot, handoff note, or meeting summary.\n'
    + 'Rules:\n'
    + '- Write in the same language as the conversation. If the conversation mixes languages, choose ONE dominant language and use it for the entire digest. Do not mix languages.\n'
    + '- Use natural, user-facing language. Do not use meeting, agenda, minutes, or handoff language.\n'
    + '- Do not produce a generic recap. Prioritize what was learned over everything that was merely discussed.\n'
    + '- ## How the View Evolved: each bullet must show real movement in thought. Each bullet must reflect at least one of: contrast, correction, reframing, turning point, or shift in priority. If a bullet is only a generic evaluation or observation, rewrite it until it shows movement in reasoning.\n'
    + '- ## Main Insight: one sharp, memorable takeaway — not several vague points.\n'
    + '- ## Open Tensions: unresolved questions, ambiguities, or tradeoffs worth revisiting — not task checklists or generic next steps.\n'
    + 'Output ONLY markdown. Start with exactly the line "# Chat Digest" (no text before it). Use exactly these section headings in this order:\n'
    + '# Chat Digest\n'
    + '## Core Question\n'
    + '## How the View Evolved\n'
    + '## Main Insight\n'
    + '## Why It Matters\n'
    + '## Open Tensions\n'
    + 'Under ## How the View Evolved use a markdown bullet list. Under ## Open Tensions use bullets; if there are none, a single line: — Nothing unresolved worth flagging here.';

  /**
   * Long-chat path: one chronological segment (full transcript is split from the start, no tail cut).
   */
  var DIGEST_SEGMENT_PROMPT =
    'You are processing one chronological segment of a longer AI chat. Later passes will merge segments into one Chat Digest. '
    + 'Same language as this segment; if mixed, use ONE dominant language only. '
    + 'Archive focus only: core tension, how views moved, insight, stakes, unresolved tensions. '
    + 'No meeting/handoff/task-list language. Not a recap of everything said.\n'
    + 'Output plain text only, using exactly these lines (one value per line, no markdown headers):\n'
    + 'CORE_QUESTION: (one sentence — what this segment centers on)\n'
    + 'VIEW_SHIFT: (one bullet-style line; repeat VIEW_SHIFT: for each distinct reasoning shift in this segment, 1–4 lines; each must show contrast, correction, reframing, turning point, or priority shift)\n'
    + 'INSIGHT_SNIPPET: (one sentence — sharpest takeaway from this segment)\n'
    + 'WHY_SNIPPET: (one short sentence — why that matters)\n'
    + 'TENSIONS: (tensions as "a | b" or NONE)\n';

  /**
   * Long-chat path: merge segment extractions into the final digest (single structure).
   */
  var DIGEST_MERGE_PROMPT =
    'You receive ordered segment extractions from ONE chat (earlier segments first). Produce ONE final Chat Digest in markdown. '
    + 'Same language throughout; one dominant language only. '
    + 'Synthesize across segments: one core question for the whole chat, 3–5 bullets for How the View Evolved that span the full arc without repeating the same shift. '
    + 'Archive tone — not a handoff, not meeting notes, not a task list. '
    + 'Main Insight = one sharp takeaway for the whole conversation. Open Tensions = real unresolved questions or tradeoffs only.\n'
    + 'Output ONLY markdown. Start with exactly "# Chat Digest". Then exactly these headings in order:\n'
    + '## Core Question\n'
    + '## How the View Evolved\n'
    + '## Main Insight\n'
    + '## Why It Matters\n'
    + '## Open Tensions\n'
    + 'Bullets under How the View Evolved and Open Tensions. If no tensions: one line under Open Tensions: — Nothing unresolved worth flagging here.';

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
   * Full transcript for Chat Digest only — same shape as formatTranscript but no tail truncation.
   * @param {Array<{role:string, content_markdown?:string}>} messages
   * @returns {string}
   */
  function formatFullTranscript(messages) {
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
    return parts.join('\n\n');
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
   * @param {string} [model] - Optional. Default gpt-4o-mini. Use SUMMARY_MODEL for summary passes.
   * @returns {Promise<{content:string, error:string|null, status:number}>}
   */
  function callOpenAI(apiKey, systemPrompt, userContent, maxTokens, model) {
    var tokens = (typeof maxTokens === 'number' && maxTokens > 0) ? maxTokens : 800;
    var useModel = (typeof model === 'string' && model) ? model : 'gpt-4o-mini';
    return fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: useModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: tokens,
        temperature: 0.3
      })
    })
      .then(function (res) {
        var status = res.status;
        return res.json()
          .then(function (data) {
            var errMsg = (data && data.error && data.error.message) ? String(data.error.message) : null;
            if (!res.ok && errMsg) return { content: '', error: errMsg, status: status };
            if (!res.ok) {
              return {
                content: '',
                error: status === 401 ? 'Invalid API key' : status === 429 ? 'Rate limit' : 'HTTP ' + status,
                status: status
              };
            }
            if (data && data.error && errMsg) return { content: '', error: errMsg, status: status };
            var content = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? String(data.choices[0].message.content).trim() : '';
            return { content: content, error: null, status: status };
          })
          .catch(function () {
            if (!res.ok) {
              return {
                content: '',
                error: status === 401 ? 'Invalid API key' : status === 429 ? 'Rate limit' : 'HTTP ' + status,
                status: status
              };
            }
            return { content: '', error: 'Invalid response from API', status: status };
          });
      })
      .catch(function () {
        return { content: '', error: 'Network or request failed', status: 0 };
      });
  }

  /**
   * True when the failure is due to a bad, revoked, or expired API key (user should re-enter).
   * @param {string|null|undefined} errorMessage
   * @param {number} [httpStatus]
   */
  function isOpenAIApiKeyAuthError(errorMessage, httpStatus) {
    if (httpStatus === 401) return true;
    if (!errorMessage || typeof errorMessage !== 'string') return false;
    var t = errorMessage.toLowerCase();
    if (t.indexOf('invalid api key') !== -1) return true;
    if (t.indexOf('incorrect api key') !== -1) return true;
    if (t.indexOf('invalid_api_key') !== -1) return true;
    if (t.indexOf('expired') !== -1 && (t.indexOf('key') !== -1 || t.indexOf('api') !== -1)) return true;
    if (t.indexOf('authentication') !== -1 && t.indexOf('key') !== -1) return true;
    if (t.indexOf('could not be resolved') !== -1 && t.indexOf('key') !== -1) return true;
    return false;
  }

  /**
   * True when OpenAI rejected the request due to rate / quota limits (user should wait and retry, not change the key).
   * @param {string|null|undefined} errorMessage
   * @param {number} [httpStatus]
   */
  function isOpenAIRateLimitError(errorMessage, httpStatus) {
    if (httpStatus === 429) return true;
    if (!errorMessage || typeof errorMessage !== 'string') return false;
    var t = errorMessage.toLowerCase();
    if (t.indexOf('rate limit') !== -1) return true;
    if (t.indexOf('tokens per min') !== -1 || t.indexOf('(tpm)') !== -1) return true;
    if (t.indexOf('too many requests') !== -1) return true;
    return false;
  }

  /**
   * Lightweight check that API output has the required Chat Digest headings. If not, we fall back to draft.
   * @param {string} text
   * @returns {boolean}
   */
  function isValidDigestStructure(text) {
    if (!text || typeof text !== 'string') return false;
    var t = text.trim();
    if (t.indexOf('# Chat Digest') !== 0) return false;
    if (t.indexOf('## Core Question') === -1) return false;
    if (t.indexOf('## How the View Evolved') === -1) return false;
    if (t.indexOf('## Main Insight') === -1) return false;
    if (t.indexOf('## Why It Matters') === -1) return false;
    if (t.indexOf('## Open Tensions') === -1) return false;
    return true;
  }

  /** Max length for "## Core Question" body. Longer = likely pasted conversation. */
  var MAX_CORE_QUESTION_BODY_LENGTH = 320;

  function isCoreQuestionSectionReasonable(text) {
    if (!text || typeof text !== 'string') return false;
    var sectionHeader = '## Core Question';
    var start = text.indexOf(sectionHeader);
    if (start === -1) return false;
    var after = start + sectionHeader.length;
    var nextH2 = text.indexOf('\n## ', after);
    var end = nextH2 !== -1 ? nextH2 : text.length;
    var body = text.slice(after, end).replace(/#+/g, '').trim();
    if (body.length > MAX_CORE_QUESTION_BODY_LENGTH) return false;
    return true;
  }

  /**
   * Generate Chat Digest from FULL chat transcript only. API input is ALWAYS transcript (never draft).
   * If transcript is too long, chunks it and does segment summaries then merge. Falls back to draft on hard failure.
   * @param {string} transcript - Full transcript (User:\n...\n\nAssistant:\n...)
   * @param {string} apiKey
   * @param {string} draft - Stub markdown (fallback only if API output fails validation, never sent to API)
   * @param {function(string|null)} [onApiFallback]
   * @param {function(number, string|null)} [setProgressFn] - Optional. (pct 0-100, statusText). Called during API steps.
   * @returns {Promise<{text:string, fromApi:boolean}>}
   */
  function generateChatDigestFromTranscript(transcript, apiKey, draft, onApiFallback, setProgressFn) {
    var fallback = { text: draft || '', fromApi: false, errorReason: null };
    if (!transcript || typeof transcript !== 'string') return Promise.resolve(fallback);
    transcript = transcript.trim();
    if (!transcript) return Promise.resolve(fallback);

    function progress(pct, text) {
      try { if (typeof setProgressFn === 'function') setProgressFn(pct, text); } catch (_) {}
    }

    try {
      if (typeof console !== 'undefined' && console.log) {
        console.log('[Snapshot Debug] generateChatDigestFromTranscript: TRANSCRIPT only (no draft). length=' + transcript.length + ' head:', transcript.slice(0, 400));
      }
    } catch (_) {}

    function validateAndReturn(content, lastError) {
      if (!content || !isValidDigestStructure(content)) {
        try { if (console && console.log) console.log('[Snapshot Debug] API result rejected: invalid digest structure', lastError || ''); } catch (_) {}
        fallback.errorReason = lastError || 'Invalid format';
        if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
        return fallback;
      }
      if (!isCoreQuestionSectionReasonable(content)) {
        try { if (console && console.log) console.log('[Snapshot Debug] API result rejected: Core Question section too long or malformed'); } catch (_) {}
        fallback.errorReason = 'Digest format invalid; using fallback.';
        if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
        return fallback;
      }
      try { if (console && console.log) console.log('[Snapshot Debug] Using API Chat Digest (validation passed)'); } catch (_) {}
      return { text: content, fromApi: true };
    }

    function apiFailureReason(errMsg, httpStatus) {
      if (isOpenAIApiKeyAuthError(errMsg, httpStatus)) return 'Invalid API key';
      if (isOpenAIRateLimitError(errMsg, httpStatus)) return 'Rate limit';
      return errMsg || 'API error';
    }

    if (transcript.length > CHUNK_THRESHOLD) {
      progress(15, 'Digesting long chat…');
      var chunks = [];
      for (var i = 0; i < transcript.length; i += CHUNK_SIZE) {
        chunks.push(transcript.slice(i, i + CHUNK_SIZE));
      }
      var segmentPromises = chunks.map(function (chunk) {
        return callOpenAI(apiKey, DIGEST_SEGMENT_PROMPT, chunk, 550, SUMMARY_MODEL);
      });
      return Promise.all(segmentPromises)
        .then(function (results) {
          progress(55, 'Merging digest segments…');
          var lastErr = null;
          var lastStatus = 0;
          var segments = [];
          for (var s = 0; s < results.length; s++) {
            if (results[s].error) lastErr = results[s].error;
            if (typeof results[s].status === 'number') lastStatus = results[s].status;
            if (isOpenAIApiKeyAuthError(results[s].error, results[s].status)) {
              fallback.errorReason = 'Invalid API key';
              if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
              progress(100, null);
              return Promise.resolve(fallback);
            }
            if (isOpenAIRateLimitError(results[s].error, results[s].status)) {
              fallback.errorReason = 'Rate limit';
              if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
              progress(100, null);
              return Promise.resolve(fallback);
            }
            if (results[s].content) segments.push(results[s].content);
          }
          if (segments.length === 0) {
            fallback.errorReason = apiFailureReason(lastErr, lastStatus) || 'Segment API failed';
            if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
            progress(100, null);
            return Promise.resolve(fallback);
          }
          var combined = 'Segment extractions (chronological order):\n\n' + segments.join('\n\n---\n\n');
          return callOpenAI(apiKey, DIGEST_MERGE_PROMPT, combined, 2000, SUMMARY_MODEL);
        })
        .then(function (result) {
          if (result && result.fromApi === false) {
            return result;
          }
          var content = (result && result.content) ? result.content.trim() : '';
          var err = (result && result.error) ? result.error : null;
          var st = (result && typeof result.status === 'number') ? result.status : 0;
          if (!content) {
            fallback.errorReason = apiFailureReason(err, st) || 'Merge failed';
            if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
            progress(100, null);
            return fallback;
          }
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

    progress(35, 'Generating Chat Digest…');
    var userMsg = 'Full conversation transcript (User / Assistant turns, chronological):\n\n' + transcript;
    return callOpenAI(apiKey, DIGEST_SYSTEM_PROMPT, userMsg, 2000, SUMMARY_MODEL)
      .then(function (result) {
        progress(100, null);
        if (result.error && typeof console !== 'undefined' && console.log) console.log('[Snapshot Debug] Digest API error:', result.error);
        var content = (result && result.content) ? result.content.trim() : '';
        if (!content) {
          fallback.errorReason = apiFailureReason(result.error, result.status);
          if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
          return fallback;
        }
        return validateAndReturn(content, result.error);
      })
      .catch(function () {
        fallback.errorReason = 'Request failed';
        if (typeof onApiFallback === 'function') onApiFallback(fallback.errorReason);
        progress(100, null);
        return fallback;
      });
  }

  /**
   * Summary mode API path: full transcript (no tail cut), call generateChatDigestFromTranscript.
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
            try { if (console && console.log) console.log('[Snapshot Debug] No API key — Chat Digest not generated.'); } catch (_) {}
            if (typeof setStatusFn === 'function') setStatusFn('Add your OpenAI API key to generate a Chat Digest.');
            resolve({ text: '', fromApi: false, errorReason: 'No API key' });
            return;
          }
          var transcript = formatFullTranscript(messages);
          if (!transcript) {
            if (typeof setStatusFn === 'function') setStatusFn('No transcript extracted — scroll the chat and try again.');
            resolve({ text: '', fromApi: false, errorReason: 'No transcript extracted' });
            return;
          }
          try { if (console && console.log) console.log('[Snapshot Debug] Calling API with full transcript, length=' + transcript.length); } catch (_) {}
          try { if (typeof setProgressFn === 'function') setProgressFn(20, 'Generating Chat Digest…'); } catch (_) {}
          if (typeof setStatusFn === 'function') setStatusFn('Generating Chat Digest…');
          generateChatDigestFromTranscript(transcript, apiKey, draft, onApiFallback, setProgressFn)
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

  function resetDigestModalHint() {
    try {
      if (digestModalHintEl) digestModalHintEl.textContent = DEFAULT_DIGEST_MODAL_HINT;
    } catch (_) {}
  }

  function hideDigestAlternateKeyOption() {
    try {
      if (digestApiKeyOptionRow) {
        digestApiKeyOptionRow.hidden = true;
        digestApiKeyOptionRow.setAttribute('aria-hidden', 'true');
      }
    } catch (_) {}
  }

  function hideApiViewRunDigestBtn() {
    try {
      if (summaryChoiceRunDigestBtn) summaryChoiceRunDigestBtn.hidden = true;
    } catch (_) {}
  }

  function showDigestAlternateKeyOption() {
    try {
      if (digestApiKeyOptionRow) {
        digestApiKeyOptionRow.hidden = false;
        digestApiKeyOptionRow.setAttribute('aria-hidden', 'false');
      }
    } catch (_) {}
  }

  /**
   * Open digest modal on the API key step without clearing storage (optional switch after rate limit).
   * @param {boolean} [rateLimitContext]
   */
  function openSummaryChoiceModalForAlternateKey(rateLimitContext) {
    digestModalStayOnApiAfterSave = !!rateLimitContext;
    hideApiViewRunDigestBtn();
    try {
      chrome.storage.local.get(OPENAI_API_KEY_STORAGE, function (stored) {
        var key = (stored && stored[OPENAI_API_KEY_STORAGE]) ? String(stored[OPENAI_API_KEY_STORAGE]).trim() : '';
        if (openaiKeyEl) openaiKeyEl.value = key;
        if (digestModalHintEl) {
          digestModalHintEl.textContent = rateLimitContext
            ? 'This key hit a rate limit. Paste a key from another OpenAI account (separate limits), or edit the key below and click Done.'
            : DEFAULT_DIGEST_MODAL_HINT;
        }
        if (summaryChoiceReadyViewEl) summaryChoiceReadyViewEl.classList.remove('visible');
        if (summaryChoiceApiViewEl) summaryChoiceApiViewEl.classList.add('visible');
        if (summaryChoiceTutorialToggle) summaryChoiceTutorialToggle.setAttribute('aria-expanded', 'false');
        if (summaryChoiceTutorialBody) summaryChoiceTutorialBody.hidden = true;
        if (summaryChoiceApiStatusEl) {
          summaryChoiceApiStatusEl.textContent = '';
          summaryChoiceApiStatusEl.classList.remove('verifying');
        }
        if (summaryChoiceOverlayEl) {
          summaryChoiceOverlayEl.classList.add('visible');
          summaryChoiceOverlayEl.setAttribute('aria-hidden', 'false');
        }
      });
    } catch (_) {}
  }

  function openSummaryChoiceModal() {
    try {
      digestModalStayOnApiAfterSave = false;
      hideApiViewRunDigestBtn();
      resetDigestModalHint();
      chrome.storage.local.get(OPENAI_API_KEY_STORAGE, function (stored) {
        var key = (stored && stored[OPENAI_API_KEY_STORAGE]) ? String(stored[OPENAI_API_KEY_STORAGE]).trim() : '';
        if (openaiKeyEl && key) openaiKeyEl.value = key;
        if (summaryChoiceApiViewEl) summaryChoiceApiViewEl.classList.remove('visible');
        if (summaryChoiceReadyViewEl) summaryChoiceReadyViewEl.classList.remove('visible');
        if (key) {
          if (summaryChoiceReadyMessageEl) summaryChoiceReadyMessageEl.textContent = 'Ready to generate your Chat Digest.';
          if (summaryChoiceReadyViewEl) summaryChoiceReadyViewEl.classList.add('visible');
        } else {
          if (summaryChoiceApiViewEl) summaryChoiceApiViewEl.classList.add('visible');
          if (summaryChoiceTutorialToggle) summaryChoiceTutorialToggle.setAttribute('aria-expanded', 'false');
          if (summaryChoiceTutorialBody) summaryChoiceTutorialBody.hidden = true;
        }
        if (summaryChoiceOverlayEl) {
          summaryChoiceOverlayEl.classList.add('visible');
          summaryChoiceOverlayEl.setAttribute('aria-hidden', 'false');
        }
      });
    } catch (_) {}
  }

  function closeSummaryChoiceModal() {
    try {
      digestModalStayOnApiAfterSave = false;
      hideApiViewRunDigestBtn();
      resetDigestModalHint();
      if (summaryChoiceOverlayEl) {
        summaryChoiceOverlayEl.classList.remove('visible');
        summaryChoiceOverlayEl.setAttribute('aria-hidden', 'true');
      }
      if (summaryChoiceApiViewEl) summaryChoiceApiViewEl.classList.remove('visible');
      if (summaryChoiceReadyViewEl) summaryChoiceReadyViewEl.classList.remove('visible');
    } catch (_) {}
  }

  /**
   * Clear saved key and open the digest modal on the API key field so the user can paste a new key.
   */
  function openSummaryChoiceModalForRekey() {
    try {
      digestModalStayOnApiAfterSave = false;
      hideApiViewRunDigestBtn();
      if (digestModalHintEl) {
        digestModalHintEl.textContent = 'Your API key was rejected. Enter a valid OpenAI API key below, then click Done.';
      }
      if (openaiKeyEl) openaiKeyEl.value = '';
      chrome.storage.local.remove(OPENAI_API_KEY_STORAGE, function () {
        try { updateSummaryModeStatus(); } catch (_) {}
      });
    } catch (_) {}
    try {
      if (summaryChoiceReadyViewEl) summaryChoiceReadyViewEl.classList.remove('visible');
      if (summaryChoiceApiViewEl) summaryChoiceApiViewEl.classList.add('visible');
      if (summaryChoiceTutorialToggle) summaryChoiceTutorialToggle.setAttribute('aria-expanded', 'false');
      if (summaryChoiceTutorialBody) summaryChoiceTutorialBody.hidden = true;
      if (summaryChoiceApiStatusEl) {
        summaryChoiceApiStatusEl.textContent = '';
        summaryChoiceApiStatusEl.classList.remove('verifying');
      }
      if (summaryChoiceReadyMessageEl) {
        summaryChoiceReadyMessageEl.textContent = 'Enter a new API key below, then Done.';
      }
      if (summaryChoiceOverlayEl) {
        summaryChoiceOverlayEl.classList.add('visible');
        summaryChoiceOverlayEl.setAttribute('aria-hidden', 'false');
      }
    } catch (_) {}
  }

  /**
   * Update Summary mode status block when present in DOM (optional).
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
      if (m === 'continue') {
        hideDigestAlternateKeyOption();
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
   * After messages are extracted, run API Chat Digest (summary mode only).
   * @param {string} exportMode
   * @param {Array} messages
   * @param {string} md - Fallback markdown from buildContinuationSnapshotMarkdown (API failure only)
   */
  function runSummaryDigestFlow(exportMode, messages, md) {
    setProgressPercent(20);
    setStatus('Generating Chat Digest…');
    var progressFn = function (pct, text) {
      setProgressPercent(pct);
      if (text != null) setStatus(text);
    };
    runSummaryWithTranscript(messages, md, function (errMsg) {
      var authHint = errMsg && isOpenAIApiKeyAuthError(errMsg, 0);
      var rateHint = errMsg && (errMsg === 'Rate limit' || isOpenAIRateLimitError(errMsg, 0));
      showToast(
        authHint ? 'Your API key is invalid or expired. Please enter a new key.'
          : rateHint ? 'Rate limit: wait a moment and try again.'
            : (errMsg || 'Chat Digest unavailable — check your API key or try again.')
      );
    }, setStatus, progressFn).then(function (result) {
      hideProgress();
      var polished = result && result.text ? result.text : '';
      var fromApi = !!(result && result.fromApi);
      var reason = (result && result.errorReason) ? String(result.errorReason) : '';
      var keyRejected = reason === 'Invalid API key' || isOpenAIApiKeyAuthError(reason, 0);
      var rateLimited = reason === 'Rate limit' || isOpenAIRateLimitError(reason, 0);
      if (keyRejected) {
        try { if (console && console.log) console.log('[Snapshot Debug] Stored API key invalid or expired; prompting re-entry.'); } catch (_) {}
        hideDigestAlternateKeyOption();
        lastSummaryOutput = '';
        setMode(exportMode);
        setOutput('');
        setButtons(false);
        setStatus('Your API key is invalid or expired. Please enter a new key.');
        showToast('Your API key is invalid or expired. Please enter a new key.');
        openSummaryChoiceModalForRekey();
        setBusy(false);
        return;
      }
      if (rateLimited) {
        try { if (console && console.log) console.log('[Snapshot Debug] OpenAI rate limit; omitting digest placeholder.'); } catch (_) {}
        lastSummaryOutput = '';
        setMode(exportMode);
        setOutput('');
        setButtons(false);
        showDigestAlternateKeyOption();
        setStatus('OpenAI rate limit reached. Wait and try again, or use a different API key below.');
        showToast('Rate limit: try again in a few seconds, or switch API key.');
        setBusy(false);
        return;
      }
      hideDigestAlternateKeyOption();
      lastSummaryOutput = polished;
      setMode(exportMode);
      if (fromApi) {
        setStatus('Egg is served! (' + messages.length + ' msgs)');
      } else if (!polished) {
        if (reason === 'No API key') {
          setStatus('Add your OpenAI API key to generate a Chat Digest.');
        } else {
          setStatus('Chat Digest unavailable. ' + (reason ? '(' + reason + ')' : 'Try again.'));
        }
      } else {
        setStatus('Chat Digest incomplete — showing fallback. ' + (reason ? '(' + reason + ')' : ''));
      }
      setBusy(false);
      if (polished) saveToCarton(polished);
    }).catch(function (err) {
      hideProgress();
      try { if (console && console.log) console.log('[Snapshot Debug] runSummary digest catch:', err); } catch (_) {}
      setStatus('Chat Digest failed. ' + (err && err.message ? err.message : 'Please try again.'));
      setBusy(false);
    });
  }

  /**
   * Run full snapshot extraction and build snapshot with the given export mode.
   * @param {string} exportMode - 'continue' | 'summary'
   */
  function runFull(exportMode) {
    if (exportMode === 'summary') {
      hideDigestAlternateKeyOption();
    }
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
            runSummaryDigestFlow(exportMode, messages, md);
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
          runSummaryDigestFlow(exportMode, messages, md);
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
   * Returns a full HTML document ready to save as .doc for Chat Digest export.
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
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8"/>\n<meta name="ProgId" content="Word.Document"/>\n<title>Chat Digest</title>\n<style>\nbody{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4;margin:1in;}\nh1{font-size:16pt;font-weight:bold;margin:0 0 12pt 0;}\nh2{font-size:12pt;font-weight:bold;margin:12pt 0 6pt 0;}\nh3{font-size:11pt;font-weight:bold;margin:8pt 0 4pt 0;}p,li{margin:0 0 6pt 0;}ul{margin:0 0 6pt 0;padding-left:24pt;}\n</style>\n</head>\n<body>\n' + bodyHtml + '\n</body>\n</html>';
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
      name = 'chat-digest-' + datePart + '.doc';
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

  // Load / save OpenAI API key for Chat Digest (Summarize)
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
    setMode('continue');
    runFull('continue');
  });
  if (btnSummarize) btnSummarize.addEventListener('click', function () {
    setMode('summary');
    try {
      chrome.storage.local.get(OPENAI_API_KEY_STORAGE, function (stored) {
        var key = (stored && stored[OPENAI_API_KEY_STORAGE]) ? String(stored[OPENAI_API_KEY_STORAGE]).trim() : '';
        if (!key && openaiKeyEl) key = String(openaiKeyEl.value || '').trim();
        if (key) {
          runFull('summary');
        } else {
          openSummaryChoiceModal();
        }
      });
    } catch (_) {
      openSummaryChoiceModal();
    }
  });
  if (startSummarizeBtn) startSummarizeBtn.addEventListener('click', function () {
    runFull('summary');
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
        showToast('API key saved');
        try {
          var o = {};
          o[OPENAI_API_KEY_STORAGE] = val;
          chrome.storage.local.set(o);
        } catch (_) {}
        try {
          updateSummaryModeStatus();
        } catch (_) {}

        if (digestModalStayOnApiAfterSave) {
          if (summaryChoiceApiStatusEl) {
            summaryChoiceApiStatusEl.textContent = 'Key saved. You can edit the field above and click Done again, or tap Generate below.';
            summaryChoiceApiStatusEl.classList.remove('verifying');
          }
          if (summaryChoiceApiViewEl) summaryChoiceApiViewEl.classList.add('visible');
          if (summaryChoiceReadyViewEl) summaryChoiceReadyViewEl.classList.remove('visible');
          if (summaryChoiceRunDigestBtn) summaryChoiceRunDigestBtn.hidden = false;
          return;
        }

        if (summaryChoiceApiStatusEl) {
          summaryChoiceApiStatusEl.textContent = 'Success!';
          summaryChoiceApiStatusEl.classList.remove('verifying');
        }
        if (summaryChoiceApiViewEl) summaryChoiceApiViewEl.classList.remove('visible');
        if (summaryChoiceReadyMessageEl) summaryChoiceReadyMessageEl.textContent = 'API key saved. Ready to generate your Chat Digest.';
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
  function runDigestFromModal() {
    closeSummaryChoiceModal();
    setMode('summary');
    runFull('summary');
  }
  if (summaryChoiceStartBtn) summaryChoiceStartBtn.addEventListener('click', function () {
    runDigestFromModal();
  });
  if (summaryChoiceRunDigestBtn) {
    summaryChoiceRunDigestBtn.addEventListener('click', function () {
      runDigestFromModal();
    });
  }
  if (changeOpenaiKeyBtn) {
    changeOpenaiKeyBtn.addEventListener('click', function () {
      openSummaryChoiceModalForAlternateKey(true);
    });
  }
  if (btnCopy) btnCopy.addEventListener('click', copyOutput);
  if (btnDownload) btnDownload.addEventListener('click', downloadOutput);

  setMode('continue');
})();
