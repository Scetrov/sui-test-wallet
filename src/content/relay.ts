export function setupRelay() {
  window.addEventListener('message', (event) => {
    // Only accept messages from the same frame
    if (event.source !== window || !event.data || event.data.source !== 'sui-test-wallet-injected') {
      return;
    }

    const { id, type, payload } = event.data;

    // Relay to background worker
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      // Check for chrome.runtime errors
      if (chrome.runtime.lastError) {
        window.postMessage({
          source: 'sui-test-wallet-content',
          id,
          error: chrome.runtime.lastError.message
        }, '*');
        return;
      }

      // If background returned an error property inside the response
      if (response && response.error) {
        window.postMessage({
          source: 'sui-test-wallet-content',
          id,
          error: response.error
        }, '*');
        return;
      }

      // Relay response back to page
      window.postMessage({
        source: 'sui-test-wallet-content',
        id,
        response
      }, '*');
    });
  });
}
