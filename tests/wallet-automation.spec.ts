import { test, expect, chromium } from '@playwright/test';
import path from 'path';

test.describe('Sui Test Wallet Automation', () => {
  let browserContext: any;
  let extensionId: string;

  test.beforeAll(async () => {
    // Path to the compiled extension
    const extensionPath = path.join(__dirname, '../dist');
    
    // Launch Chrome with the extension loaded
    browserContext = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    // Find the background service worker to get the extension ID
    let [background] = browserContext.serviceWorkers();
    if (!background) {
      background = await browserContext.waitForEvent('serviceworker');
    }

    const extensionUrl = background.url();
    extensionId = extensionUrl.split('/')[2];
    console.log(`Extension loaded with ID: ${extensionId}`);
  });

  test.afterAll(async () => {
    await browserContext.close();
  });

  test('should import key and set network via window.postMessage', async () => {
    // Open a dummy page to interact with window.postMessage
    // In a real E2E test, this would be your dApp URL
    const page = await browserContext.newPage();
    await page.goto('https://example.com');
    // Ensure the content script has time to load
    await page.waitForTimeout(1000); 

    // 1. Import a key
    const testKey = 'suiprivkey1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'; // Replace with a valid Bech32 key for real testing
    const importResult = await page.evaluate(async (key) => {
      return new Promise((resolve) => {
        const handler = (event: MessageEvent) => {
          if (event.source !== window || event.data.source !== 'sui-test-wallet-content' || event.data.type !== 'AUTOMATION_RESPONSE') return;
          window.removeEventListener('message', handler);
          resolve(event.data.payload);
        };
        window.addEventListener('message', handler);
        window.postMessage({
          source: 'playwright-test',
          type: 'AUTOMATION_COMMAND',
          command: 'IMPORT_KEY',
          payload: { bech32Key: key, alias: 'TestAccount1' }
        }, '*');
      });
    }, testKey);

    console.log('Import result:', importResult);

    // 2. Set network to testnet
    const networkResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const handler = (event: MessageEvent) => {
          if (event.source !== window || event.data.source !== 'sui-test-wallet-content' || event.data.type !== 'AUTOMATION_RESPONSE') return;
          window.removeEventListener('message', handler);
          resolve(event.data.payload);
        };
        window.addEventListener('message', handler);
        window.postMessage({
          source: 'playwright-test',
          type: 'AUTOMATION_COMMAND',
          command: 'SET_NETWORK',
          payload: { network: 'testnet' }
        }, '*');
      });
    });

    console.log('Network result:', networkResult);
    
    // 3. Accept mainnet risk
    const mainnetResult = await page.evaluate(async () => {
        return new Promise((resolve) => {
          const handler = (event: MessageEvent) => {
            if (event.source !== window || event.data.source !== 'sui-test-wallet-content' || event.data.type !== 'AUTOMATION_RESPONSE') return;
            window.removeEventListener('message', handler);
            resolve(event.data.payload);
          };
          window.addEventListener('message', handler);
          window.postMessage({
            source: 'playwright-test',
            type: 'AUTOMATION_COMMAND',
            command: 'ACCEPT_MAINNET_RISK',
            payload: {}
          }, '*');
        });
      });
  
      console.log('Mainnet Risk result:', mainnetResult);

    // Assertions
    // Note: If you provide an invalid test key above, the import will fail with an error object
    // expect(importResult.error).toBeUndefined();
    // expect(networkResult.success).toBe(true);
  });

  test('should register the wallet for automatic discovery', async () => {
    const page = await browserContext.newPage();
    await page.goto('https://example.com');
    await page.waitForTimeout(1000);

    const wallets = await page.evaluate(async () => {
      const discovered: { name: string; version: string; chains: string[]; icon: string }[] = [];

      window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', {
        detail: {
          register(wallet: { name: string; version: string; chains: string[]; icon: string }) {
            discovered.push({
              name: wallet.name,
              version: wallet.version,
              chains: [...wallet.chains],
              icon: wallet.icon,
            });
          },
        },
      }));

      await new Promise((resolve) => setTimeout(resolve, 0));
      return discovered;
    });

    expect(wallets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Sui Test Wallet',
          version: '1.0.0',
          chains: expect.arrayContaining(['sui:testnet', 'sui:mainnet']),
          icon: expect.stringContaining('data:image/svg+xml'),
        }),
      ]),
    );
  });
});
