import {
  Wallet,
  SuiFeatures,
  SuiSignTransactionInput,
  SuiSignAndExecuteTransactionInput,
  StandardConnectInput,
  StandardConnectOutput,
  SuiSignAndExecuteTransactionOutput,
} from '@mysten/wallet-standard';
import { ReadonlyWalletAccount } from '@wallet-standard/core';
import type { StandardConnectFeature, StandardDisconnectFeature, StandardEventsFeature, StandardEventsListeners, WalletAccount } from '@wallet-standard/core';

const ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4IiByb2xlPSJpbWciIGFyaWEtbGFiZWw9IlN1aSBUZXN0IFdhbGxldCI+PHBhdGggZmlsbD0iI0Y5NzMxNiIgZD0iTTY0IDZDNTIgMzIgMjggNDggMjggNzhjMCAyMS42IDE2LjUgNDAuNSAzNiA0NCAxOS41LTMuNSAzNi0yMi40IDM2LTQ0QzEwMCA0OCA3NiAzMiA2NCA2WiIvPjxjaXJjbGUgY3g9IjY0IiBjeT0iNzYiIHI9IjIzIiBmaWxsPSIjZmZmIi8+PGNpcmNsZSBjeD0iNjQiIGN5PSI3NiIgcj0iMTAiIGZpbGw9IiNGOTczMTYiLz48Y2lyY2xlIGN4PSI2NCIgY3k9Ijc2IiByPSI0IiBmaWxsPSIjZmZmIi8+PC9zdmc+' as const;

export class SuiTestWallet implements Wallet {
  #version = '1.0.0' as const;
  #name = 'Sui Test Wallet';
  #icon = ICON;
  #accounts: WalletAccount[] = [];
  #listeners: { [E in keyof StandardEventsListeners]?: StandardEventsListeners[E][] } = {};

  get version() { return this.#version; }
  get name() { return this.#name; }
  get icon() { return this.#icon; }
  get accounts() { return this.#accounts; }
  get chains(): `${string}:${string}`[] { return ['sui:localnet', 'sui:devnet', 'sui:testnet', 'sui:mainnet']; }

  get features(): StandardConnectFeature & StandardDisconnectFeature & StandardEventsFeature & SuiFeatures {
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
    } as any;
  }

  async connect(_input?: StandardConnectInput): Promise<StandardConnectOutput> {
    const res = await this.requestFromExtension('GET_ACCOUNTS', {});
    this.#accounts = res.accounts.map((address: string) => new ReadonlyWalletAccount({
      address,
      publicKey: new Uint8Array(), // Placeholder for now, typically dApps just need the address
      chains: this.chains,
      features: ['sui:signTransaction', 'sui:signAndExecuteTransaction']
    }));

    this.emit('change', { accounts: this.accounts });

    return { accounts: this.accounts };
  }

  async disconnect(): Promise<void> {
    this.#accounts = [];
    this.emit('change', { accounts: this.accounts });
  }

  on<E extends keyof StandardEventsListeners>(event: E, listener: StandardEventsListeners[E]): () => void {
    this.#listeners[event] = this.#listeners[event] || [];
    this.#listeners[event]!.push(listener);
    return () => {
      this.#listeners[event] = this.#listeners[event]?.filter((l) => l !== listener);
    };
  }

  private emit<E extends keyof StandardEventsListeners>(event: E, ...args: Parameters<StandardEventsListeners[E]>): void {
    this.#listeners[event]?.forEach((listener) => (listener as any)(...args));
  }

  async signTransaction(input: SuiSignTransactionInput): Promise<any> {
    const txJson = await input.transaction.toJSON(); 
    const res = await this.requestFromExtension('SIGN_TRANSACTION', {
      txJson
    });
    return { signature: res.signature, bytes: res.bytes };
  }

  async signAndExecuteTransaction(input: SuiSignAndExecuteTransactionInput): Promise<SuiSignAndExecuteTransactionOutput> {
    const txJson = await input.transaction.toJSON();
    const res = await this.requestFromExtension('SIGN_AND_EXECUTE_TRANSACTION', {
      txJson,
      options: (input as any).options
    });
    return res;
  }

  private requestFromExtension(type: string, payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = Date.now().toString() + Math.random().toString();
      const listener = (event: MessageEvent) => {
        if (event.source !== window || event.data.source !== 'sui-test-wallet-content' || event.data.id !== id) return;
        window.removeEventListener('message', listener);
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.response);
      };
      window.addEventListener('message', listener);
      window.postMessage({
        source: 'sui-test-wallet-injected',
        id,
        type,
        payload
      }, '*');
    });
  }
}
