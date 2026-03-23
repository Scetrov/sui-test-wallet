import { setupRelay } from './relay';
import { setupAutomation } from './automation';

const INJECTED_SCRIPT_ID = 'sui-test-wallet-injected-script';

function injectWalletBridge() {
	if (window !== window.top) {
		return;
	}

	if (document.getElementById(INJECTED_SCRIPT_ID)) {
		return;
	}

	const script = document.createElement('script');
	script.id = INJECTED_SCRIPT_ID;
	script.async = false;
	script.src = chrome.runtime.getURL('injected-wallet.js');

	const target = document.documentElement || document.head;
	if (!target) {
		window.addEventListener('DOMContentLoaded', injectWalletBridge, { once: true });
		return;
	}

	target.prepend(script);
}

injectWalletBridge();

// 1. Setup message relay between page and background worker
setupRelay();

// 2. Setup automation hooks for Playwright tests
setupAutomation();

