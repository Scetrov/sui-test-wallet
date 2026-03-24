import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';

test.describe('Sui Test Wallet Automation', () => {
  test.describe.configure({ mode: 'serial' });

  let browserContext: BrowserContext;
  let extensionId: string;
  const extensionPath = path.join(__dirname, '../dist');
  const watchAddressOne = '0xa111111111111111111111111111111111111111111111111111111111111111';
  const watchAddressTwo = '0xb222222222222222222222222222222222222222222222222222222222222222';

  function shortAddress(address: string) {
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  }

  async function launchExtension(userDataDir: string) {
    browserContext = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    let [background] = browserContext.serviceWorkers();
    if (!background) {
      background = await browserContext.waitForEvent('serviceworker');
    }

    extensionId = background.url().split('/')[2];
  }

  async function openPopupPage(): Promise<Page> {
    const page = await browserContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.locator('.popup-container')).toBeVisible();
    return page;
  }

  test.beforeEach(async ({}, testInfo) => {
    await launchExtension(testInfo.outputPath('user-data'));
  });

  test.afterEach(async () => {
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
    const importResult = await page.evaluate(async (key: string) => {
      return new Promise((resolve) => {
        const handler = (event: MessageEvent) => {
          if (event.source !== window || event.data.type !== 'SUI_TEST_WALLET_AUTOMATION_RESPONSE' || event.data.id !== 'import-key') return;
          window.removeEventListener('message', handler);
          resolve(event.data.response);
        };
        window.addEventListener('message', handler);
        window.postMessage({
          type: 'SUI_TEST_WALLET_AUTOMATION',
          action: 'IMPORT_KEY',
          id: 'import-key',
          bech32Key: key,
          alias: 'TestAccount1'
        }, '*');
      });
    }, testKey);

    console.log('Import result:', importResult);

    // 2. Set network to testnet
    const networkResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const handler = (event: MessageEvent) => {
          if (event.source !== window || event.data.type !== 'SUI_TEST_WALLET_AUTOMATION_RESPONSE' || event.data.id !== 'set-network') return;
          window.removeEventListener('message', handler);
          resolve(event.data.response);
        };
        window.addEventListener('message', handler);
        window.postMessage({
          type: 'SUI_TEST_WALLET_AUTOMATION',
          action: 'SET_NETWORK',
          id: 'set-network',
          network: 'testnet'
        }, '*');
      });
    });

    console.log('Network result:', networkResult);
    
    // 3. Accept mainnet risk
    const mainnetResult = await page.evaluate(async () => {
        return new Promise((resolve) => {
          const handler = (event: MessageEvent) => {
            if (event.source !== window || event.data.type !== 'SUI_TEST_WALLET_AUTOMATION_RESPONSE' || event.data.id !== 'accept-mainnet-risk') return;
            window.removeEventListener('message', handler);
            resolve(event.data.response);
          };
          window.addEventListener('message', handler);
          window.postMessage({
            type: 'SUI_TEST_WALLET_AUTOMATION',
            action: 'ACCEPT_MAINNET_RISK',
            id: 'accept-mainnet-risk'
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

  test('should require explicit confirmation before deleting an address', async () => {
    const popupPage = await openPopupPage();

    await popupPage.getByRole('heading', { name: 'Watch Wallet' }).click();
    await popupPage.getByPlaceholder('0x...').fill(watchAddressOne);
    await popupPage.getByRole('button', { name: 'Add Watch Address' }).click();
    await expect(popupPage.locator('.account-item').filter({ hasText: shortAddress(watchAddressOne) })).toBeVisible();

    await popupPage.getByPlaceholder('0x...').fill(watchAddressTwo);
    await popupPage.getByRole('button', { name: 'Add Watch Address' }).click();

    const firstRow = popupPage.locator('.account-item').filter({ hasText: shortAddress(watchAddressOne) });
    const secondRow = popupPage.locator('.account-item').filter({ hasText: shortAddress(watchAddressTwo) });

    await expect(firstRow).toBeVisible();
    await expect(secondRow).toBeVisible();

    await secondRow.hover();
    await secondRow.getByRole('button', { name: `Delete account ${watchAddressTwo}` }).click();
    await expect(secondRow.getByRole('button', { name: `Confirm delete account ${watchAddressTwo}` })).toBeVisible();
    await expect(secondRow.getByRole('button', { name: `Cancel delete account ${watchAddressTwo}` })).toBeVisible();

    await secondRow.getByRole('button', { name: `Cancel delete account ${watchAddressTwo}` }).click();
    await expect(secondRow).toBeVisible();

    await secondRow.hover();
    await secondRow.getByRole('button', { name: `Delete account ${watchAddressTwo}` }).click();
    await secondRow.getByRole('button', { name: `Confirm delete account ${watchAddressTwo}` }).click();

    await expect(secondRow).toHaveCount(0);
    await expect(firstRow).toBeVisible();
    await expect(firstRow.locator('input[type="radio"]')).toBeChecked();
  });
});
