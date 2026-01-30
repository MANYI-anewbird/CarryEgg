/**
 * CarryEgg — Popup script. Quick / Full snapshot, Copy, Download.
 * Uses chrome.tabs.sendMessage to content script; listens for snapshotProgress.
 */

(function () {
  'use strict';

  const QUICK_KEEP = 40;

  const statusEl = document.getElementById('status');
  const outEl = document.getElementById('output');
  const btnQuick = document.getElementById('quickSnap');
  const btnFull = document.getElementById('fullSnap');
  const btnCopy = document.getElementById('copyBtn');
  const btnDownload = document.getElementById('downloadBtn');
  const cartonBtn = document.getElementById('cartonBtn');
  const historyDrawer = document.getElementById('historyDrawer');
  const closeDrawerBtn = document.getElementById('closeDrawer');
  const historyList = document.getElementById('historyList');

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
      if (btnQuick) btnQuick.disabled = busy;
      if (btnFull) btnFull.disabled = busy;
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

  function runQuick() {
    setStatus('');
    setOutput('');
    setButtons(false);
    setBusy(true);

    getActiveTab()
      .then(function (tab) {
        if (!isChatGptTab(tab)) {
          setStatus('Open a ChatGPT chat first!');
          setBusy(false);
          return;
        }
        setStatus('Hatching quick egg...');
        return ensureContentAndSend(tab.id, { type: 'extract' });
      })
      .then(function (res) {
        if (!res) return;
        const messages = (res.messages || []).slice(-QUICK_KEEP);
        const md = buildContinuationSnapshotMarkdown(messages);
        setOutput(md);
        setStatus('Egg is served! (' + messages.length + ' msgs)');
        setButtons(!!md);
        if (md) saveToCarton(md);
      })
      .catch(function (err) {
        setStatus(err && err.message ? err.message : 'Something went wrong');
        setOutput('');
        setButtons(false);
      })
      .then(function () {
        setBusy(false);
      });
  }

  function runFull() {
    setStatus('Rolling...');
    setOutput('');
    setButtons(false);
    setBusy(true);

    var fullDone = false;
    var requestId = Date.now().toString();

    function onMessage(payload) {
      try {
        if (!payload || !payload.type) return;
        if (payload.requestId !== requestId) return;
        if (payload.type === 'snapshotProgress' && payload.status) {
          var t = (payload.status || '').replace(/^\[Snapshot Debug\]\s*/i, '');
          setStatus(t || 'Rolling...');
          return;
        }
        if (payload.type === 'fullSnapshotDone' && payload.result && !fullDone) {
          fullDone = true;
          removeListener();
          var messages = (payload.result.messages || []);
          var md = buildContinuationSnapshotMarkdown(messages);
          setOutput(md);
          setStatus('Egg is served! (' + messages.length + ' msgs)');
          setButtons(!!md);
          setBusy(false);
          if (md) saveToCarton(md);
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
        var messages = (res.messages || []);
        var md = buildContinuationSnapshotMarkdown(messages);
        setOutput(md);
        setStatus('Egg is served! (' + messages.length + ' msgs)');
        setButtons(!!md);
        setBusy(false);
        if (md) saveToCarton(md);
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

  function downloadOutput() {
    const text = outEl ? outEl.value : '';
    if (!text) return;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const name = 'carryegg-snapshot-' + y + '-' + m + '-' + d + '-' + h + '-' + min + '.md';
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
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

  // Close drawer when clicking outside
  if (historyDrawer) {
    historyDrawer.addEventListener('click', function (e) {
      if (e.target === historyDrawer) closeDrawer();
    });
  }

  // ========== Main Event Listeners ==========

  if (btnQuick) btnQuick.addEventListener('click', runQuick);
  if (btnFull) btnFull.addEventListener('click', runFull);
  if (btnCopy) btnCopy.addEventListener('click', copyOutput);
  if (btnDownload) btnDownload.addEventListener('click', downloadOutput);
})();
