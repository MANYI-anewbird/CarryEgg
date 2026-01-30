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
          setStatus('🥚 Open a ChatGPT chat first!');
          setBusy(false);
          return;
        }
        setStatus('🥚 Hatching quick egg...');
        return ensureContentAndSend(tab.id, { type: 'extract' });
      })
      .then(function (res) {
        if (!res) return;
        const messages = (res.messages || []).slice(-QUICK_KEEP);
        const md = buildContinuationSnapshotMarkdown(messages);
        setOutput(md);
        setStatus('✨ Egg is served! (' + messages.length + ' msgs)');
        setButtons(!!md);
      })
      .catch(function (err) {
        setStatus('😵 ' + (err && err.message ? err.message : 'Something went wrong'));
        setOutput('');
        setButtons(false);
      })
      .then(function () {
        setBusy(false);
      });
  }

  function runFull() {
    setStatus('🐣 Rolling...');
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
          setStatus(t ? '🐣 ' + t : '🐣 Rolling...');
          return;
        }
        if (payload.type === 'fullSnapshotDone' && payload.result && !fullDone) {
          fullDone = true;
          removeListener();
          var messages = (payload.result.messages || []);
          var md = buildContinuationSnapshotMarkdown(messages);
          setOutput(md);
          setStatus('✨ Egg is served! (' + messages.length + ' msgs)');
          setButtons(!!md);
          setBusy(false);
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
          setStatus('🥚 Open a ChatGPT chat first!');
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
        setStatus('✨ Egg is served! (' + messages.length + ' msgs)');
        setButtons(!!md);
        setBusy(false);
      })
      .catch(function (err) {
        teardown();
        if (fullDone) return;
        setStatus('😵 ' + (err && err.message ? err.message : 'Something went wrong'));
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
      function () { setStatus('🍳 Copied to clipboard!'); },
      function () { setStatus('😵 Copy failed.'); }
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
    setStatus('💾 Saved! ' + name);
  }

  if (btnQuick) btnQuick.addEventListener('click', runQuick);
  if (btnFull) btnFull.addEventListener('click', runFull);
  if (btnCopy) btnCopy.addEventListener('click', copyOutput);
  if (btnDownload) btnDownload.addEventListener('click', downloadOutput);
})();
