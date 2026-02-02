/**
 * CarryEgg — Content script: DOM extraction for ChatGPT conversations.
 * Defensive, selector-fallback, no external deps. [Snapshot Debug] logging.
 */

(function () {
  'use strict';

  const LOG = (msg) => {
    try {
      console.log('[Snapshot Debug]', msg);
    } catch (_) {}
  };

  /**
   * Sleep helper for scroll/extract flows.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Selector fallback strategy. Returns array of message-container elements.
   * Priority: containers that GUARANTEE content first (conversation-turn, .markdown parents),
   * then heuristic article scan, then broad role/article (which can match empty shells).
   */
  function getConversationContainers() {
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.body) {
      LOG('getConversationContainers: no document/body');
      return [];
    }

    const candidates = [];

    try {
      // 1) data-testid="conversation-turn" — ChatGPT canonical; high confidence
      const byTestId = doc.querySelectorAll('[data-testid="conversation-turn"]');
      if (byTestId && byTestId.length > 0) {
        LOG('Selector fallback: using data-testid=conversation-turn, count=' + byTestId.length);
        return Array.from(byTestId);
      }
    } catch (e) {
      LOG('Selector fallback: data-testid failed: ' + (e && e.message));
    }

    try {
      // 2) Elements containing .markdown — closest article | data-testid | li (guarantees content)
      const markdownEls = doc.querySelectorAll('.markdown, [class*="markdown"]');
      if (markdownEls && markdownEls.length > 0) {
        const seen = new Set();
        for (const m of markdownEls) {
          const turn = m.closest('article') || m.closest('[data-testid="conversation-turn"]') || m.closest('li') || m.parentElement;
          if (turn && !seen.has(turn)) {
            seen.add(turn);
            candidates.push(turn);
          }
        }
        if (candidates.length > 0) {
          LOG('Selector fallback: using .markdown parents, count=' + candidates.length);
          return candidates;
        }
      }
    } catch (e) {
      LOG('Selector fallback: .markdown failed: ' + (e && e.message));
    }

    try {
      // 3) Heuristic: article with .markdown or pre>code inside (content-bearing)
      const main = doc.querySelector('main') || doc.querySelector('[role="main"]') || doc.body;
      if (main) {
        const articles = main.querySelectorAll('article');
        const HEURISTIC_CAP = 300;
        const blocks = [];
        for (const a of articles) {
          if (blocks.length >= HEURISTIC_CAP) break;
          const hasMarkdown = a.querySelector('.markdown, [class*="markdown"]');
          const hasCode = a.querySelector('pre > code');
          if (hasMarkdown || hasCode) blocks.push(a);
        }
        if (blocks.length > 0) {
          LOG('Selector fallback: heuristic (article + .markdown|pre>code), count=' + blocks.length);
          return blocks;
        }
      }
    } catch (e) {
      LOG('Selector fallback: heuristic failed: ' + (e && e.message));
    }

    try {
      // 4) role / aria-based (can match empty wrappers; use only if above fail)
      const byRole = doc.querySelectorAll('[role="article"], [aria-label*="message"], [aria-label*="turn"]');
      if (byRole && byRole.length > 0) {
        LOG('Selector fallback: using role/aria containers, count=' + byRole.length);
        return Array.from(byRole);
      }
    } catch (e) {
      LOG('Selector fallback: role/aria failed: ' + (e && e.message));
    }

    try {
      // 5) Plain <article> as last resort
      const articles = doc.querySelectorAll('article');
      if (articles && articles.length > 0) {
        LOG('Selector fallback: using article elements, count=' + articles.length);
        return Array.from(articles);
      }
    } catch (e) {
      LOG('Selector fallback: article failed: ' + (e && e.message));
    }

    LOG('Selector fallback: no containers found');
    return [];
  }

  /**
   * Extract code blocks from a node. Uses pre > code, textContent verbatim, fenced Markdown.
   * @param {Element} root
   * @returns {{ chunks: string[], codeNodes: Element[] }}
   */
  function extractCodeBlocks(root) {
    const chunks = [];
    const codeNodes = [];
    if (!root || typeof root.querySelectorAll !== 'function') return { chunks, codeNodes };

    try {
      const pres = root.querySelectorAll('pre > code');
      for (const code of pres) {
        if (!code) continue;
        try {
          const raw = (code.textContent || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          codeNodes.push(code);
          const lang = (code.getAttribute('class') || '').match(/language-(\S+)/);
          const fence = lang ? '```' + lang[1] : '```';
          chunks.push('\n' + fence + '\n' + raw + '\n```\n');
        } catch (e) {
          LOG('extractCodeBlocks: skip code node: ' + (e && e.message));
        }
      }
    } catch (e) {
      LOG('extractCodeBlocks: failed: ' + (e && e.message));
    }
    return { chunks, codeNodes };
  }

  /**
   * Serialize non-code content to markdown-like string. Preserves block structure.
   * Code is handled separately; we avoid double-including via codeNodes.
   */
  function serializeToMarkdown(root, codeNodes) {
    const skip = new Set(codeNodes);
    const out = [];

    function walk(n) {
      if (!n || skip.has(n)) return;
      if (n.nodeType === Node.TEXT_NODE) {
        const t = (n.textContent || '').trim();
        if (t) out.push(t);
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const el = /** @type {Element} */ (n);
      const tag = (el.tagName || '').toLowerCase();

      if (tag === 'script' || tag === 'style') return;

      if (tag === 'pre' && el.querySelector('code')) {
        return;
      }

      const block = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'tr'].includes(tag);
      const isList = ['ul', 'ol'].includes(tag);
      if (block && out.length > 0 && !out[out.length - 1].endsWith('\n\n')) out.push('\n');
      if (tag === 'h1') out.push('# ');
      if (tag === 'h2') out.push('## ');
      if (tag === 'h3') out.push('### ');
      if (tag === 'h4') out.push('#### ');
      if (tag === 'h5') out.push('##### ');
      if (tag === 'h6') out.push('###### ');
      if (tag === 'li') out.push('- ');
      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        const text = (el.textContent || '').trim();
        if (href) out.push('[' + text + '](' + href + ')');
        else walkChildren(el);
        return;
      }
      if (tag === 'strong' || tag === 'b') {
        out.push('**');
        walkChildren(el);
        out.push('**');
        return;
      }
      if (tag === 'em' || tag === 'i') {
        out.push('*');
        walkChildren(el);
        out.push('*');
        return;
      }
      if (tag === 'code' && !el.closest('pre')) {
        out.push('`');
        walkChildren(el);
        out.push('`');
        return;
      }

      walkChildren(el);
      if (block || isList) out.push('\n');
    }

    function walkChildren(parent) {
      if (!parent || !parent.childNodes) return;
      for (const c of parent.childNodes) walk(c);
    }

    try {
      walk(root);
    } catch (e) {
      LOG('serializeToMarkdown failed: ' + (e && e.message));
    }

    return out.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Infer role from container (user | assistant).
   * Priority: data-message-author-role only (ChatGPT). No fragile role/text heuristics.
   */
  function inferRole(container) {
    if (!container) return 'assistant';
    try {
      const el = container.closest('[data-message-author-role]') ||
        container.querySelector('[data-message-author-role]');
      if (!el) return 'assistant';
      const r = (el.getAttribute('data-message-author-role') || '').toLowerCase();
      if (r === 'user') return 'user';
      if (r === 'assistant') return 'assistant';
    } catch (_) {}
    return 'assistant';
  }

  /**
   * Find best content-bearing element inside container. Tries multiple selectors.
   * @param {Element} container
   * @returns {Element}
   */
  function findContentRoot(container) {
    if (!container || !container.querySelector) return container;
    const selectors = [
      '.markdown',
      '[class*="markdown"]',
      '[class*="prose"]',
      '[class*="message"]',
      '[class*="break-words"]'
    ];
    for (const sel of selectors) {
      try {
        const el = container.querySelector(sel);
        if (el && (el.textContent || '').trim().length > 0) return el;
      } catch (_) {}
    }
    return container;
  }

  /**
   * Extract single message { role, content_markdown } from a container.
   */
  function extractMessageFromElement(container) {
    let role = 'assistant';
    let content = '';

    try {
      if (!container) return { role: 'assistant', content_markdown: '' };
      role = inferRole(container);
    } catch (e) {
      LOG('inferRole failed: ' + (e && e.message));
    }

    try {
      const contentRoot = findContentRoot(container);
      const { chunks: codeChunks, codeNodes } = extractCodeBlocks(contentRoot);
      const nonCode = serializeToMarkdown(contentRoot, codeNodes);
      const codePart = codeChunks.join('');
      content = [nonCode, codePart].filter(Boolean).join('\n\n');
      if (!content.trim()) {
        const raw = (contentRoot.textContent || '').trim();
        if (raw.length > 10) content = raw;
      }
    } catch (e) {
      LOG('extractMessageFromElement failed: ' + (e && e.message));
    }

    return { role, content_markdown: content || '' };
  }

  const MAX_SCROLL_LOOPS = 80;
  const SCROLL_SLEEP_MS = 600;
  const UNCHANGED_STOP = 3;
  const MAX_SCROLL_NODES = 2000;

  /**
   * Find main scroll container: largest element with overflow-y auto|scroll and scrollHeight > clientHeight.
   * Scans main descendants first; hard limit MAX_SCROLL_NODES to avoid freezing on large DOMs.
   * @returns {Element | null}
   */
  function findScrollContainer() {
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.body) {
      LOG('findScrollContainer: no document/body');
      return null;
    }
    let best = null;
    let bestSize = 0;
    let nodes = 0;
    try {
      const main = doc.querySelector('main') || doc.querySelector('[role="main"]') || doc.body;
      const walk = (root) => {
        if (nodes >= MAX_SCROLL_NODES) return;
        if (!root || root.nodeType !== 1) return;
        nodes += 1;
        const el = /** @type {Element} */ (root);
        if ((el.tagName || '').toLowerCase() === 'iframe') return;
        try {
          const style = window.getComputedStyle(el);
          const oy = (style && style.overflowY) || '';
          if (oy === 'auto' || oy === 'scroll') {
            const sh = el.scrollHeight || 0;
            const ch = el.clientHeight || 0;
            if (sh > ch && sh > bestSize) {
              best = el;
              bestSize = sh;
            }
          }
        } catch (_) {}
        const children = el.children || [];
        for (let i = 0; i < children.length && nodes < MAX_SCROLL_NODES; i++) {
          walk(children[i]);
        }
      };
      walk(main);
      if (nodes >= MAX_SCROLL_NODES) {
        LOG('findScrollContainer: stopped at MAX_SCROLL_NODES=' + MAX_SCROLL_NODES);
      }
      if (best) LOG('findScrollContainer: found, scrollHeight=' + bestSize);
      else LOG('findScrollContainer: no suitable container');
    } catch (e) {
      LOG('findScrollContainer failed: ' + (e && e.message));
    }
    return best;
  }

  /**
   * Earliest-message signature for change detection (first container text prefix + length).
   * @param {Element[]} containers
   * @returns {string}
   */
  function getEarliestMessageSignature(containers) {
    if (!containers || containers.length === 0) return '';
    try {
      const first = containers[0];
      const text = (first && first.textContent) ? first.textContent.trim() : '';
      const prefix = text.length > 200 ? text.slice(0, 200) : text;
      return prefix.length + ':' + prefix;
    } catch (e) {
      LOG('getEarliestMessageSignature failed: ' + (e && e.message));
      return '';
    }
  }

  /**
   * Send progress update for Full Snapshot (e.g. popup status text).
   * Callback form only (no .catch); swallow lastError when no listener exists.
   * @param {string} [requestId] - If provided, included so popup can ignore stale progress.
   */
  function sendProgress(pass, maxLoops, status, requestId) {
    try {
      const payload = {
        type: 'snapshotProgress',
        pass,
        maxLoops,
        status: status || 'Loading older messages… pass ' + pass + ' / ' + maxLoops
      };
      if (requestId != null) payload.requestId = requestId;
      chrome.runtime.sendMessage(payload, function () { if (chrome.runtime.lastError) { /* no listener */ } });
    } catch (_) {}
  }

  /**
   * Scroll-to-load older messages (best-effort). Never freezes; stops gracefully.
   * @param {string} [requestId] - Passed through to sendProgress for popup request matching.
   * @returns {Promise<{ messages: Array<{ role: string, content_markdown: string }>, strategy: string }>}
   */
  async function scrollToLoadOlderMessages(requestId) {
    const out = { messages: [], strategy: 'dom' };
    const container = findScrollContainer();
    if (!container) {
      LOG('scrollToLoadOlderMessages: no container, extracting current only');
      return extractAllMessages();
    }
    let prevCount = 0;
    let prevSig = '';
    let unchanged = 0;
    const maxLoops = MAX_SCROLL_LOOPS;

    for (let pass = 1; pass <= maxLoops; pass++) {
      try {
        container.scrollTop = 0;
      } catch (e) {
        LOG('scrollToLoadOlderMessages: scrollTop failed: ' + (e && e.message));
        break;
      }
      sendProgress(pass, maxLoops, '[Snapshot Debug] Loading older messages… pass ' + pass + ' / ' + maxLoops, requestId);
      await sleep(SCROLL_SLEEP_MS);

      let containers = [];
      try {
        containers = getConversationContainers();
      } catch (e) {
        LOG('scrollToLoadOlderMessages: getConversationContainers failed: ' + (e && e.message));
      }
      const count = containers.length;
      const sig = getEarliestMessageSignature(containers);
      const changed = count > prevCount || (sig && sig !== prevSig);
      if (changed) {
        unchanged = 0;
      } else {
        unchanged += 1;
      }
      prevCount = count;
      prevSig = sig;
      LOG('scrollToLoadOlderMessages: pass ' + pass + ' count=' + count + ' unchanged=' + unchanged);

      if (unchanged >= UNCHANGED_STOP) {
        LOG('scrollToLoadOlderMessages: stopped (no change for ' + UNCHANGED_STOP + ' loops)');
        break;
      }
      if (pass >= maxLoops) {
        LOG('scrollToLoadOlderMessages: stopped (max loops ' + maxLoops + ')');
        break;
      }
    }

    try {
      const result = extractAllMessages();
      out.messages = result.messages || [];
      out.strategy = result.strategy || 'dom';
    } catch (e) {
      LOG('scrollToLoadOlderMessages: extractAllMessages failed: ' + (e && e.message));
    }
    return out;
  }

  /**
   * Extract all messages from the page using selector fallback.
   * @returns {{ messages: Array<{ role: 'user' | 'assistant', content_markdown: string }>, strategy: string }}
   */
  function extractAllMessages() {
    const containers = getConversationContainers();
    const messages = [];
    for (let i = 0; i < containers.length; i++) {
      try {
        const msg = extractMessageFromElement(containers[i]);
        if (msg.content_markdown && msg.content_markdown.trim().length > 0) {
          messages.push({ role: msg.role, content_markdown: msg.content_markdown.trim() });
        }
      } catch (e) {
        LOG('extractMessage skip index ' + i + ': ' + (e && e.message));
      }
    }
    LOG('extractAllMessages: count=' + messages.length);
    return { messages, strategy: 'dom' };
  }

  /**
   * Message listener for popup/background.
   * 'extract' → quick snapshot (current DOM only). 'fullSnapshot' → scroll-to-load then extract.
   */
  function setupMessaging() {
    try {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (!msg || (msg.type !== 'extract' && msg.type !== 'fullSnapshot')) {
          sendResponse({ error: 'unknown message type' });
          return;
        }
        if (msg.type === 'extract') {
          try {
            const result = extractAllMessages();
            sendResponse(result);
          } catch (e) {
            LOG('onMessage extract failed: ' + (e && e.message));
            sendResponse({ error: (e && e.message) || 'extract failed', messages: [] });
          }
          return;
        }
        if (msg.type === 'fullSnapshot') {
          const reqId = msg.requestId;
          (async () => {
            let result = { messages: [], strategy: 'dom' };
            try {
              result = await scrollToLoadOlderMessages(reqId);
              sendResponse(result);
            } catch (e) {
              LOG('onMessage fullSnapshot failed: ' + (e && e.message));
              result = { error: (e && e.message) || 'fullSnapshot failed', messages: [] };
              sendResponse(result);
            }
            try {
              const done = { type: 'fullSnapshotDone', result };
              if (reqId != null) done.requestId = reqId;
              chrome.runtime.sendMessage(done, function () { if (chrome.runtime.lastError) { /* no listener */ } });
            } catch (_) {}
          })();
          return true;
        }
      });
    } catch (e) {
      LOG('setupMessaging failed: ' + (e && e.message));
    }
  }

  setupMessaging();
})();
