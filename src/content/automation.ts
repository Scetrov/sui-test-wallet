export function setupAutomation() {
  window.addEventListener('message', (event) => {
    // Only accept messages from the same frame
    if (event.source !== window || !event.data || event.data.type !== 'SUI_TEST_WALLET_AUTOMATION') {
      return;
    }

    const { action, id, ...payload } = event.data;

    const respond = (data: any, error?: string) => {
      if (!id) return; // one-way message if no ID
      window.postMessage({
        type: 'SUI_TEST_WALLET_AUTOMATION_RESPONSE',
        id,
        response: data,
        error
      }, '*');
    };

    if (action === 'ACCEPT_MAINNET_RISK') {
      chrome.runtime.sendMessage({ type: 'ACCEPT_MAINNET_RISK' }, (res) => {
        if (chrome.runtime.lastError) return respond(null, chrome.runtime.lastError.message);
        respond(res);
      });
    } else if (action === 'IMPORT_KEY') {
      chrome.runtime.sendMessage({ type: 'IMPORT_KEY', bech32Key: payload.bech32Key, alias: payload.alias }, (res) => {
        if (chrome.runtime.lastError) return respond(null, chrome.runtime.lastError.message);
        respond(res);
      });
    } else if (action === 'SET_NETWORK') {
      chrome.runtime.sendMessage({ type: 'SET_NETWORK', network: payload.network }, (res) => {
        if (chrome.runtime.lastError) return respond(null, chrome.runtime.lastError.message);
        respond(res);
      });
    } else if (action === 'SET_AUTO_APPROVE') {
      chrome.runtime.sendMessage({ type: 'SET_AUTO_APPROVE', enabled: payload.enabled }, (res) => {
        if (chrome.runtime.lastError) return respond(null, chrome.runtime.lastError.message);
        respond(res);
      });
    } else if (action === 'OPEN_TEST_APPROVAL') {
      chrome.runtime.sendMessage({ type: 'OPEN_TEST_APPROVAL', requestType: payload.requestType, txJson: payload.txJson }, (res) => {
        if (chrome.runtime.lastError) return respond(null, chrome.runtime.lastError.message);
        respond(res);
      });
    } else if (action === 'GET_STATE') {
      Promise.all([
        new Promise(r => chrome.runtime.sendMessage({ type: 'GET_NETWORK' }, r)),
        new Promise(r => chrome.runtime.sendMessage({ type: 'GET_ACCOUNTS' }, r))
      ]).then(([networkRes, accountsRes]: any[]) => {
        respond({ network: networkRes?.network, accounts: accountsRes?.accounts, active: accountsRes?.active });
      });
    }
  });

  // Inject a hidden DOM element so Playwright knows automation is ready
  const el = document.createElement('div');
  el.id = 'sui-test-wallet-automation-ready';
  el.style.display = 'none';
  if (document.body) {
    document.body.appendChild(el);
  } else {
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(el));
  }
}
