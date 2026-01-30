/**
 * CarryEgg — Phase 5: Continuation Snapshot.
 * Pure helper: builds structured Markdown from extracted messages.
 * No external deps; deterministic, rule-based. [Snapshot Debug] logging.
 */
(function (global) {
  'use strict';

  function LOG(msg) {
    try { console.log('[Snapshot Debug]', msg); } catch (_) {}
  }

  /**
   * Parse fenced code blocks from markdown. Returns [{ lang, raw }].
   * Raw is verbatim; never modify.
   */
  function extractCodeBlocksFromMarkdown(text) {
    var out = [];
    if (!text || typeof text !== 'string') return out;
    try {
      var re = /```(\w*)\n([\s\S]*?)```/g;
      var m;
      while ((m = re.exec(text)) !== null) {
        out.push({ lang: (m[1] || '').trim() || null, raw: m[2] });
      }
    } catch (e) {
      LOG('extractCodeBlocksFromMarkdown failed: ' + (e && e.message));
    }
    return out;
  }

  function hasCodeBlock(text) {
    return /```[\s\S]*?```/.test(text || '');
  }

  function hasLinksPathsOrCommands(text) {
    if (!text || typeof text !== 'string') return false;
    if (/\[[^\]]*\]\([^)]+\)|https?:\/\/\S+/.test(text)) return true;
    if (/[\n\s](?:\/[\w./-]+|\.\/[\w./-]+|~\/(?:[\w.-]+\/)*[\w.-]+)[\s\n]/.test(text)) return true;
    if (/^\s*[$#]?\s*(?:npm|yarn|pnpm|git|npx|node|python|python3|cd|ls|cat|curl)\s+/m.test(text)) return true;
    return false;
  }

  /**
   * Rule-based relevance score per message. 0–5 scale; modifiers can go negative.
   */
  function scoreMessage(msg) {
    var content = (msg && msg.content_markdown) ? msg.content_markdown : '';
    var raw = content.replace(/\s+/g, ' ').trim();
    var score = 0;

    if (hasCodeBlock(content)) score += 5;
    if (/[\{\}"'\w\s]*"(?:\w+)":\s*[\{\[\d"]|SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET/i.test(content)) score += 5;
    if (/\b(?:must|never|cannot|must not|don't)\b/i.test(content)) score += 4;
    if (/\b(?:goal|build|implement|create|want to)\b/i.test(content)) score += 4;
    if (/\b(?:decide|decision|final|conclusion)\b/i.test(content)) score += 3;
    if (/\b(?:TODO|FIXME|next step)\b/i.test(content)) score += 2;
    if (hasLinksPathsOrCommands(content) && score < 5) score = Math.max(score, 3);

    if (/^\s*(?:ok|okay|yes|thanks|thank you|got it|sure)\s*[.!]?\s*$/i.test(raw) && raw.length < 80) score -= 2;
    if (/^(?:hi|hello|hey)\s*[.!]?\s*$/i.test(raw) && raw.length < 60) score -= 3;
    if (raw.length < 30 && !hasCodeBlock(content) && !hasLinksPathsOrCommands(content)) score -= 1;

    return Math.max(-3, Math.min(5, score));
  }

  function isFiller(msg) {
    var content = (msg && msg.content_markdown) ? msg.content_markdown : '';
    var raw = content.replace(/\s+/g, ' ').trim();
    if (hasCodeBlock(content) || hasLinksPathsOrCommands(content)) return false;
    if (raw.length > 120) return false;
    if (/^(?:hi|hello|hey|thanks|thank you|ok|okay)\s*[.!]?\s*$/i.test(raw)) return true;
    if (/^\s*(?:ok|okay|yes|thanks|sure|got it)\s*[.!]?\s*$/i.test(raw)) return true;
    return false;
  }

  function isShortConfirmation(msg) {
    var content = (msg && msg.content_markdown) ? msg.content_markdown : '';
    var raw = content.replace(/\s+/g, ' ').trim();
    if (raw.length > 80) return false;
    return /^\s*(?:ok|okay|thanks|thank you|got it|sure)\s*[.!]?\s*$/i.test(raw);
  }

  function alwaysKeep(msg) {
    if (!msg) return false;
    var c = (msg.content_markdown || '').trim();
    return hasCodeBlock(c) || hasLinksPathsOrCommands(c);
  }

  var ESCAPE_HATCH = ' (see Last-stage Details / Raw Extract for full wording)';

  /**
   * Strip only leading conversational wrappers in first ~40 chars. One prefix; never delete whole.
   */
  function stripMetaPreamble(text) {
    if (!text || typeof text !== 'string') return text;
    var s = text.trim();
    var head = s.slice(0, 45);
    var preambles = [
      /^Good question[.,:]?\s*/i,
      /^In conclusion[.,:]?\s*/i,
      /^In short[.,:]?\s*/i,
      /^Simply put[.,:]?\s*/i,
      /^To sum up[.,:]\s*/i,
      /^Let me explain[^.!?\n]{0,30}[.!?]?\s*/i,
      /^First,?\s+[^.!?\n]{0,25}[.!?]?\s*/i
    ];
    for (var i = 0; i < preambles.length; i++) {
      var m = head.match(preambles[i]);
      if (m) {
        var out = s.slice(m[0].length).trim();
        if (out.length > 0) return out;
        break;
      }
    }
    return s;
  }

  /**
   * Compress long non-code text: first + optional second sentence, then "…". Skip if ``` or URLs.
   * Returns { out, truncated }.
   */
  function compressParagraph(text, maxChars) {
    var out = (text || '').trim();
    if (!out) return { out: '', truncated: false };
    if (out.indexOf('```') !== -1 || /https?:\/\//.test(out)) return { out: out, truncated: false };
    if (out.length <= maxChars) return { out: out, truncated: false };
    var rx = /[^.!?]*[.!?]\s*|[^\n]+\n?/g;
    var m;
    var acc = '';
    var n = 0;
    while ((m = rx.exec(out)) !== null && n < 2) {
      acc += m[0];
      n += 1;
    }
    acc = acc.trim();
    if (acc.length > maxChars) acc = acc.slice(0, maxChars).trim();
    if (acc.length < out.length) return { out: acc + '…', truncated: true };
    return { out: out, truncated: false };
  }

  /**
   * Multi-line to bullet candidates. Keep lines with list markers or high-signal keywords; else compress.
   * Returns { out, truncated }.
   */
  var BULLET_MAX_LINES = 8;
  var BULLET_KEYWORDS = /MVP|goal|must|never|cannot|implement|fixed|finalized/i;

  function toBullets(text, maxChars) {
    if (!text || typeof text !== 'string') return { out: '', truncated: false };
    var s = text.trim();
    if (s.indexOf('```') !== -1 || /https?:\/\//.test(s)) return { out: s, truncated: false };
    var lines = s.split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var kept = [];
    for (var i = 0; i < lines.length && kept.length < BULLET_MAX_LINES; i++) {
      var line = lines[i];
      if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line) || BULLET_KEYWORDS.test(line)) kept.push(line);
    }
    if (kept.length > 0) {
      var formatted = kept.map(function (l) {
        return (/^[-*]\s+/.test(l) || /^\d+\.\s+/.test(l)) ? l : '- ' + l;
      });
      return { out: formatted.join('\n'), truncated: false };
    }
    return compressParagraph(s, maxChars || 280);
  }

  /**
   * Distill a bullet for Goal/Current State/Open Qs: strip preamble, optionally compress. Preserve links.
   */
  function distillBullet(text, maxChars, allowCompress) {
    if (!text || typeof text !== 'string') return { out: text, truncated: false };
    var t = stripMetaPreamble(text);
    if (!allowCompress || t.indexOf('```') !== -1 || /https?:\/\//.test(t)) return { out: t, truncated: false };
    if (t.length <= (maxChars || 300)) return { out: t, truncated: false };
    return compressParagraph(t, maxChars || 300);
  }

  /**
   * Bold modal words MUST / MUST NOT in text.
   */
  function boldModals(text) {
    if (!text || typeof text !== 'string') return text;
    return text
      .replace(/\b(must not)\b/gi, '**$1**')
      .replace(/\b(must)\b/gi, '**$1**');
  }

  /**
   * Goal: first 20 messages, top-scoring, high-signal only. Prefer user when scores similar.
   */
  function buildGoal(messages) {
    var arr = (messages || []).slice(0, 20);
    var goalCandidatesTotal = arr.length;
    var scored = arr.map(function (m, i) {
      return { msg: m, score: scoreMessage(m), i: i, isUser: (m.role || '') === 'user' };
    });
    scored.sort(function (a, b) {
      var d = b.score - a.score;
      if (d !== 0) return d;
      if (a.isUser !== b.isUser) return a.isUser ? -1 : 1;
      return a.i - b.i;
    });
    var eligible = scored.filter(function (x) { return x.score >= 1 || alwaysKeep(x.msg); });
    var top = eligible.slice(0, 5);
    var lines = [];
    var userGoalCount = 0;
    var assistantGoalCount = 0;
    var distilledCount = 0;
    for (var i = 0; i < top.length; i++) {
      var t = (top[i].msg.content_markdown || '').trim();
      if (!t) continue;
      if (top[i].isUser) userGoalCount += 1; else assistantGoalCount += 1;
      if (hasCodeBlock(t)) {
        var briefNoCode = t.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim();
        if (!briefNoCode) { lines.push('- (Contains code; see Important Artifacts.)'); continue; }
      }
      var brief = t.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim().slice(0, 500);
      if (!brief) continue;
      var d = distillBullet(brief, 280, true);
      if (d.truncated) { distilledCount += 1; d.out += ESCAPE_HATCH; }
      lines.push('- ' + d.out);
    }
    var goalSelectedCount = lines.length;
    LOG('Goal: goalCandidatesTotal=' + goalCandidatesTotal + ', goalSelectedCount=' + goalSelectedCount + ', userGoalCount=' + userGoalCount + ', assistantGoalCount=' + assistantGoalCount + ', paragraphsDistilled=' + distilledCount);
    return lines.length ? lines.join('\n') : '- (No high-signal goal extracted from first 20 messages.)';
  }

  /**
   * Current State: mid-to-late high-score messages; what's done, current phase.
   */
  function buildCurrentState(messages) {
    var arr = messages || [];
    var n = arr.length;
    var from = Math.floor(n * 0.3);
    var to = Math.max(from, n - 5);
    var slice = arr.slice(from, to);
    var scored = slice.map(function (m, i) { return { msg: m, score: scoreMessage(m) }; });
    scored = scored.filter(function (x) { return x.score >= 2 || alwaysKeep(x.msg); }).slice(-5);
    var lines = [];
    var distilledCount = 0;
    for (var i = 0; i < scored.length; i++) {
      var t = (scored[i].msg.content_markdown || '').trim();
      if (!t) continue;
      var brief = t.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim().slice(0, 400);
      if (!brief) continue;
      var d = distillBullet(brief, 240, true);
      if (d.truncated) { distilledCount += 1; d.out += ESCAPE_HATCH; }
      lines.push('- ' + d.out);
    }
    LOG('Current State: ' + lines.length + ' items from mid-to-late, paragraphsDistilled=' + distilledCount);
    return lines.length ? lines.join('\n') : '- (Derived from conversation; no explicit status extracted.)';
  }

  function isSuggestion(s) {
    return /(?:you should|I recommend)/i.test(s || '');
  }

  function hasConfirmationSignal(s) {
    return /(?:we decided|we will use|finalized|locked in|this is implemented|this is fixed)/i.test(s || '');
  }

  /**
   * Key Decisions: explicit decisions, must/must-not, locked-in choices.
   * User: always eligible. Assistant: only if confirmation signals; exclude suggestions.
   */
  function buildKeyDecisions(messages) {
    var arr = messages || [];
    var lines = [];
    var seen = {};
    var decisionsFromUser = 0;
    var decisionsFromAssistantConfirmed = 0;
    var assistantSuggestionsDropped = 0;
    var distilledCount = 0;
    var re = /[^.!?\n]*(?:must|must not|never|cannot|don't|we decided|we will use|finalized|locked in|this is implemented|this is fixed)[^.!?\n]*[.!?\n]?/gi;
    for (var i = 0; i < arr.length; i++) {
      var c = (arr[i].content_markdown || '').trim();
      var isUser = (arr[i].role || '') === 'user';
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(c)) !== null) {
        var s = m[0].replace(/\s+/g, ' ').trim().slice(0, 220);
        if (!s || seen[s]) continue;
        if (isUser) {
          seen[s] = true;
          decisionsFromUser += 1;
        } else {
          if (isSuggestion(s)) {
            assistantSuggestionsDropped += 1;
            continue;
          }
          if (!hasConfirmationSignal(s)) continue;
          seen[s] = true;
          decisionsFromAssistantConfirmed += 1;
        }
        var isConstraint = /(?:must|must not)/i.test(s);
        var prefix = isConstraint ? '**Constraint**:' : '**Decision**:';
        var t = boldModals(stripMetaPreamble(s));
        var d = distillBullet(t, 180, true);
        if (d.truncated) { distilledCount += 1; d.out += ESCAPE_HATCH; }
        lines.push('- ' + prefix + ' ' + d.out);
      }
    }
    LOG('Key Decisions: decisionsFromUser=' + decisionsFromUser + ', decisionsFromAssistantConfirmed=' + decisionsFromAssistantConfirmed + ', assistantSuggestionsDropped=' + assistantSuggestionsDropped + ', paragraphsDistilled=' + distilledCount);
    return lines.length ? lines.join('\n') : '- (None explicitly extracted.)';
  }

  /**
   * Open Questions: question marks, unresolved TODOs.
   */
  function buildOpenQuestions(messages) {
    var arr = messages || [];
    var lines = [];
    var seen = {};
    var distilledCount = 0;
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i].content_markdown || '';
      var chunks = c.split(/(?<=[.?!\n])/);
      for (var j = 0; j < chunks.length; j++) {
        var s = chunks[j].replace(/\s+/g, ' ').trim();
        if (!(/\?/.test(s) || /\bTODO\b|\bFIXME\b|\bunresolved\b/i.test(s)) || s.length < 10 || s.length > 400) continue;
        if (seen[s]) continue;
        seen[s] = true;
        var d = distillBullet(s, 200, true);
        if (d.truncated) { distilledCount += 1; d.out += ESCAPE_HATCH; }
        lines.push('- ' + d.out);
      }
    }
    LOG('Open Questions: ' + lines.length + ' items, paragraphsDistilled=' + distilledCount);
    return lines.length ? lines.join('\n') : '- (None extracted.)';
  }

  /**
   * Important Artifacts: code blocks (verbatim, deduped), file names, commands, URLs.
   */
  function buildArtifacts(messages) {
    var codeSeen = {};
    var codeBlocks = [];
    var files = [];
    var commands = [];
    var urls = [];
    var pathRe = /(?:^|[\s\n])((?:\/|\.\/|~\/)[\w./-]+|\b[\w-]+\.(?:js|ts|tsx|jsx|py|json|md|html|css|yml|yaml|sh|bash|sql)(?:\s|$|\n))/g;
    var urlRe = /(?:\[([^\]]*)\]\((\s*https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)\]]+))/g;
    var cmdRe = /(?:^|[\n])\s*[$#]?\s*((?:npm|yarn|pnpm|npx|git|node|python|python3|cd|ls|cat|curl|mkdir|cp|mv)\s+[^\n]+)/gm;

    var totalCodeBlocks = 0;
    for (var i = 0; i < (messages || []).length; i++) {
      var c = (messages[i].content_markdown || '').trim();
      var blocks = extractCodeBlocksFromMarkdown(c);
      for (var j = 0; j < blocks.length; j++) {
        totalCodeBlocks += 1;
        var raw = blocks[j].raw;
        var sig = raw.length + ':' + raw.slice(0, 80) + ':' + raw.slice(-80);
        if (!codeSeen[sig]) { codeSeen[sig] = true; codeBlocks.push(blocks[j]); }
      }
      var m;
      while ((m = pathRe.exec(c)) !== null) {
        var f = (m[1] || '').trim();
        if (f && files.indexOf(f) === -1) files.push(f);
      }
      pathRe.lastIndex = 0;
      while ((m = urlRe.exec(c)) !== null) {
        var u = (m[2] || m[3] || '').trim();
        if (u && urls.indexOf(u) === -1) urls.push(u);
      }
      urlRe.lastIndex = 0;
      while ((m = cmdRe.exec(c)) !== null) {
        var cmd = (m[1] || '').trim();
        if (cmd && commands.indexOf(cmd) === -1) commands.push(cmd);
      }
      cmdRe.lastIndex = 0;
    }
    var uniqueCodeBlocks = codeBlocks.length;
    var duplicateCodeBlocksDropped = totalCodeBlocks - uniqueCodeBlocks;
    LOG('Artifacts: totalCodeBlocks=' + totalCodeBlocks + ', uniqueCodeBlocks=' + uniqueCodeBlocks + ', duplicateCodeBlocksDropped=' + duplicateCodeBlocksDropped + '; files=' + files.length + ', commands=' + commands.length + ', urls=' + urls.length);

    var out = [];
    for (var k = 0; k < codeBlocks.length; k++) {
      var b = codeBlocks[k];
      var fence = (b.lang ? '```' + b.lang + '\n' : '```\n') + b.raw + '\n```';
      out.push(fence);
    }
    if (files.length) { out.push('\n**File names:**\n- ' + files.slice(0, 30).join('\n- ')); }
    if (commands.length) { out.push('\n**Commands:**\n- ' + commands.slice(0, 20).join('\n- ')); }
    if (urls.length) { out.push('\n**Links:**\n- ' + urls.slice(0, 20).join('\n- ')); }

    return out.length ? out.join('\n\n') : '- (None extracted.)';
  }

  /**
   * Immediate Continuation Context: last 3–5 turns (User+Assistant each), verbatim, no filter.
   * Search window = last 30 messages. Output still only 3–5 turns.
   * Returns { md, included } where included = Set of messages used (for Last-stage dedup).
   */
  function buildImmediateContinuationContext(messages) {
    var arr = messages || [];
    var last = arr.slice(-30);
    var immediateSearchWindowSize = last.length;
    var turns = [];
    var included = new Set();
    var i = last.length - 1;
    while (i >= 1 && turns.length < 5) {
      var a = last[i];
      var b = last[i - 1];
      if (a && b && a.role !== b.role) {
        turns.unshift([b, a]);
        included.add(b);
        included.add(a);
        i -= 2;
      } else {
        i -= 1;
      }
    }
    if (i === 0 && turns.length < 5 && last[0]) {
      turns.unshift([last[0]]);
      included.add(last[0]);
    }
    var immediateTurnsFound = turns.length;
    var parts = [];
    for (var t = 0; t < turns.length; t++) {
      var turn = turns[t];
      for (var k = 0; k < turn.length; k++) {
        var msg = turn[k];
        var role = (msg.role === 'user' ? 'User' : 'Assistant');
        var body = (msg.content_markdown || '').trim();
        parts.push('**' + role + ':**\n\n' + body);
      }
    }
    var messagesIncludedInImmediateContext = included.size;
    LOG('Immediate Continuation Context: immediateSearchWindowSize=' + immediateSearchWindowSize + ', immediateTurnsFound=' + immediateTurnsFound + ', messagesIncludedInImmediateContext=' + messagesIncludedInImmediateContext);
    var md = parts.length ? parts.join('\n\n') : '- (No turns available.)';
    return { md: md, included: included };
  }

  /**
   * Last-stage Details: last 10–15 messages, drop pure filler, keep User/Assistant.
   * Excludes messages in excludeSet (e.g. those already in Immediate Continuation Context).
   */
  function buildLastStage(messages, excludeSet) {
    var arr = (messages || []).slice(-15);
    var kept = [];
    for (var i = 0; i < arr.length; i++) {
      if (isFiller(arr[i])) continue;
      if (excludeSet && excludeSet.has(arr[i])) continue;
      kept.push(arr[i]);
    }
    kept = kept.slice(-15);
    var dropped = arr.length - kept.length;
    var lastStageMessagesAfterDedup = kept.length;
    LOG('Last-stage: kept=' + kept.length + ', dropped=' + dropped + ' (filler+dedup); lastStageMessagesAfterDedup=' + lastStageMessagesAfterDedup);
    var parts = [];
    for (var j = 0; j < kept.length; j++) {
      var r = (kept[j].role === 'user' ? 'User' : 'Assistant');
      var b = (kept[j].content_markdown || '').trim();
      parts.push('### ' + r + '\n\n' + b);
    }
    return parts.length ? parts.join('\n\n') : '- (No messages after filtering; see Immediate Continuation Context.)';
  }

  function buildPasteInstructions() {
    return '1. Paste the **entire** document above into a **new** chat (same or another AI tool).\n'
      + '2. Tell the AI: "Please read everything above carefully."\n'
      + '3. Add: "The section **Immediate Continuation Context** represents the most recent live conversation. Continue from there without repeating earlier explanations."\n'
      + '4. The AI can use Goal, Current State, Key Decisions, and Last-stage Details as reference, and **Immediate Continuation Context** for exact handoff.\n'
      + '5. Start by answering the LAST user request/question in the Immediate Continuation Context.';
  }

  /**
   * Raw Extract: last 15 messages, compact.
   */
  function buildRawExtract(messages) {
    var arr = (messages || []).slice(-15);
    var parts = [];
    for (var i = 0; i < arr.length; i++) {
      var r = (arr[i].role === 'user' ? 'User' : 'Assistant');
      var b = (arr[i].content_markdown || '').replace(/\n{3,}/g, '\n\n').trim();
      parts.push('**' + r + ':** ' + b);
    }
    return parts.join('\n\n');
  }

  /**
   * Build full Continuation Snapshot Markdown.
   * @param {Array<{ role: "user"|"assistant", content_markdown: string }>} messages
   * @returns {string}
   */
  function buildContinuationSnapshotMarkdown(messages) {
    var arr = Array.isArray(messages) ? messages : [];
    LOG('Phase 5 input: ' + arr.length + ' messages');

    var goal = buildGoal(arr);
    var current = buildCurrentState(arr);
    var decisions = buildKeyDecisions(arr);
    var questions = buildOpenQuestions(arr);
    var artifacts = buildArtifacts(arr);
    var immediate = buildImmediateContinuationContext(arr);
    var lastStage = buildLastStage(arr, immediate.included);
    var paste = buildPasteInstructions();
    var raw = buildRawExtract(arr);

    var md = [
      '# Continuation Snapshot',
      '',
      '## Goal (Origin Context)',
      goal,
      '',
      '## Current State',
      current,
      '',
      '## Key Decisions & Constraints',
      decisions,
      '',
      '## Open Questions',
      questions,
      '',
      '## Important Artifacts',
      artifacts,
      '',
      '## Last-stage Details (Most Recent Context)',
      lastStage,
      '',
      '## Immediate Continuation Context (DO NOT SUMMARIZE)',
      immediate.md,
      '',
      '## Paste-into-New-Chat Instructions',
      paste,
      '',
      '<details>',
      '<summary>Raw Extract (Last 15 Messages)</summary>',
      '',
      raw,
      '',
      '</details>'
    ].join('\n');

    LOG('Phase 5 output: snapshot built');
    LOG('Phase 5 sections: Goal, Current State, Key Decisions, Open Questions, Artifacts, Last-stage, Immediate Continuation Context, Paste instructions, Raw Extract');
    return md;
  }

  global.buildContinuationSnapshotMarkdown = buildContinuationSnapshotMarkdown;
})(typeof window !== 'undefined' ? window : this);
