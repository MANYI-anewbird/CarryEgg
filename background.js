/**
 * CarryEgg — Background service worker (Manifest V3).
 * Minimal; popup and content handle messaging. No persistent state.
 */

'use strict';

// Optional: log extension install/update for debugging
try {
  chrome.runtime.onInstalled.addListener(function (details) {
    if (details && details.reason) {
      console.log('[CarryEgg]', details.reason);
    }
  });
} catch (_) {}
