(function () {
  'use strict';

  const GLOBAL_KEY = '__suiTestWalletInjected__';
  const ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="Sui Test Wallet">'
      + '<path fill="#F97316" d="M64 6C52 32 28 48 28 78c0 21.6 16.5 40.5 36 44 19.5-3.5 36-22.4 36-44C100 48 76 32 64 6Z"/>'
      + '<circle cx="64" cy="76" r="23" fill="#fff"/>'
      + '<circle cx="64" cy="76" r="10" fill="#F97316"/>'
      + '<circle cx="64" cy="76" r="4" fill="#fff"/>'
    + '</svg>'
  );
  const ACCOUNT_FEATURES = Object.freeze(['sui:signTransaction', 'sui:signAndExecuteTransaction']);
  const CHAINS = Object.freeze(['sui:localnet', 'sui:devnet', 'sui:testnet', 'sui:mainnet']);

  if (window[GLOBAL_KEY]) {
    return;
  }

  window[GLOBAL_KEY] = true;

  class RegisterWalletEvent extends Event {
    #detail;

    constructor(callback) {
      super('wallet-standard:register-wallet', {
        bubbles: false,
        cancelable: false,
        composed: false,
      });
      this.#detail = callback;
    }

    get detail() {
      return this.#detail;
    }

    preventDefault() {
      throw new Error('preventDefault cannot be called');
    }

    stopImmediatePropagation() {
      throw new Error('stopImmediatePropagation cannot be called');
    }

    stopPropagation() {
      throw new Error('stopPropagation cannot be called');
    }
  }

  function registerWallet(wallet) {
    const callback = ({ register }) => register(wallet);

    try {
      window.dispatchEvent(new RegisterWalletEvent(callback));
    } catch (error) {
      console.error('wallet-standard:register-wallet event could not be dispatched', error);
    }

    try {
      window.addEventListener('wallet-standard:app-ready', ({ detail }) => callback(detail));
    } catch (error) {
      console.error('wallet-standard:app-ready listener could not be added', error);
    }
  }

  function createWalletAccount(address) {
    return Object.freeze({
      address,
      publicKey: new Uint8Array(),
      chains: Array.from(CHAINS),
      features: Array.from(ACCOUNT_FEATURES),
    });
  }

  class SuiTestWallet {
    constructor() {
      this.version = '1.0.0';
      this.name = 'Sui Test Wallet';
      this.icon = ICON;
      this.accounts = [];
      this.chains = Array.from(CHAINS);
      this._listeners = {};
    }

    get features() {
      return {
        'standard:connect': {
          version: '1.0.0',
          connect: this.connect.bind(this),
        },
        'standard:disconnect': {
          version: '1.0.0',
          disconnect: this.disconnect.bind(this),
        },
        'standard:events': {
          version: '1.0.0',
          on: this.on.bind(this),
        },
        'sui:signTransaction': {
          version: '2.0.0',
          signTransaction: this.signTransaction.bind(this),
        },
        'sui:signAndExecuteTransaction': {
          version: '2.0.0',
          signAndExecuteTransaction: this.signAndExecuteTransaction.bind(this),
        },
      };
    }

    async connect() {
      const response = await requestFromExtension('GET_ACCOUNTS', {});
      this.accounts = (response.accounts || []).map(createWalletAccount);
      this.emit('change', { accounts: this.accounts });
      return { accounts: this.accounts };
    }

    async disconnect() {
      this.accounts = [];
      this.emit('change', { accounts: this.accounts });
    }

    on(event, listener) {
      if (!this._listeners[event]) {
        this._listeners[event] = [];
      }

      this._listeners[event].push(listener);

      return () => {
        this._listeners[event] = (this._listeners[event] || []).filter((candidate) => candidate !== listener);
      };
    }

    emit(event, payload) {
      for (const listener of this._listeners[event] || []) {
        listener(payload);
      }
    }

    async signTransaction(input) {
      const txJson = await input.transaction.toJSON();
      const response = await requestFromExtension('SIGN_TRANSACTION', { txJson });
      return {
        signature: response.signature,
        bytes: response.bytes,
      };
    }

    async signAndExecuteTransaction(input) {
      const txJson = await input.transaction.toJSON();
      return requestFromExtension('SIGN_AND_EXECUTE_TRANSACTION', {
        txJson,
        options: input.options,
      });
    }
  }

  function requestFromExtension(type, payload) {
    return new Promise((resolve, reject) => {
      const id = Date.now().toString() + Math.random().toString(16).slice(2);

      const listener = (event) => {
        if (
          event.source !== window ||
          !event.data ||
          event.data.source !== 'sui-test-wallet-content' ||
          event.data.id !== id
        ) {
          return;
        }

        window.removeEventListener('message', listener);

        if (event.data.error) {
          reject(new Error(event.data.error));
          return;
        }

        resolve(event.data.response);
      };

      window.addEventListener('message', listener);
      window.postMessage({
        source: 'sui-test-wallet-injected',
        id,
        type,
        payload,
      }, '*');
    });
  }

  registerWallet(new SuiTestWallet());
})();