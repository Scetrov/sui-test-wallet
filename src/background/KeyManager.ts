import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

export interface StoredKey {
  alias: string;
  publicKey: string;
  bech32Key?: string;
}

export class KeyManager {
  private activeKeypair: Ed25519Keypair | null = null;
  private activeAddress: string | null = null;
  private storedKeys: StoredKey[] = [];

  constructor() {
    this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    const data = await chrome.storage.local.get(['suiTestWalletKeys', 'suiTestWalletActiveAddress']);
    if (data.suiTestWalletKeys && Array.isArray(data.suiTestWalletKeys)) {
      this.storedKeys = data.suiTestWalletKeys;
      
      this.activeAddress = (data.suiTestWalletActiveAddress as string) || null;
      
      if (!this.activeAddress && this.storedKeys.length > 0) {
        this.activeAddress = this.storedKeys[0].publicKey;
      }

      if (this.activeAddress) {
        const activeKey = this.storedKeys.find(k => k.publicKey === this.activeAddress);
        if (activeKey && activeKey.bech32Key) {
          this.activeKeypair = this.deriveKeypair(activeKey.bech32Key);
        } else if (this.storedKeys.length > 0) {
          const firstWithKey = this.storedKeys.find(k => k.bech32Key);
          if (firstWithKey) {
             // We don't necessarily want to force an active address change here if it was a watch wallet
             // but if we need a keypair and don't have one, we might need a fallback.
             // For now, let's just leave it null if it's a watch wallet.
          }
        }
      }
    }
  }

  private async saveToStorage(): Promise<void> {
    await chrome.storage.local.set({ suiTestWalletKeys: this.storedKeys });
  }

  private deriveKeypair(bech32Key: string): Ed25519Keypair {
    const { secretKey } = decodeSuiPrivateKey(bech32Key);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }

  public async importKey(bech32Key: string, alias: string = 'Test Account'): Promise<StoredKey> {
    // Validate by deriving
    const keypair = this.deriveKeypair(bech32Key);
    const publicKey = keypair.getPublicKey().toSuiAddress();

    // Check if exists
    const existingIndex = this.storedKeys.findIndex(k => k.publicKey === publicKey);
    if (existingIndex >= 0) {
      if (!this.storedKeys[existingIndex].bech32Key) {
        // Upgrade watch wallet to full wallet
        this.storedKeys[existingIndex].bech32Key = bech32Key;
        await this.saveToStorage();
      }
      return this.storedKeys[existingIndex];
    }

    const newKey: StoredKey = {
      alias: `${alias} ${this.storedKeys.length + 1}`,
      publicKey,
      bech32Key
    };

    this.storedKeys.push(newKey);
    await this.saveToStorage();

    // Set as active
    await this.setActiveAddress(publicKey);

    return newKey;
  }

  public async importWatchAddress(address: string, alias: string = 'Watch Wallet'): Promise<StoredKey> {
    // Basic validation
    if (!address.startsWith('0x') || address.length < 10) {
      throw new Error("Invalid Sui address format");
    }

    // Check if exists
    const existingIndex = this.storedKeys.findIndex(k => k.publicKey === address);
    if (existingIndex >= 0) {
      return this.storedKeys[existingIndex];
    }

    const newKey: StoredKey = {
      alias: `${alias} ${this.storedKeys.length + 1}`,
      publicKey: address
    };

    this.storedKeys.push(newKey);
    await this.saveToStorage();

    // Set as active
    await this.setActiveAddress(address);

    return newKey;
  }

  public async setActiveAddress(address: string): Promise<void> {
    const key = this.storedKeys.find(k => k.publicKey === address);
    if (key) {
      this.activeAddress = address;
      if (key.bech32Key) {
        this.activeKeypair = this.deriveKeypair(key.bech32Key);
      } else {
        this.activeKeypair = null;
      }
      await chrome.storage.local.set({ suiTestWalletActiveAddress: address });
    }
  }

  public async removeAccount(address: string): Promise<string | null> {
    if (this.storedKeys.length === 0) {
      await this.loadFromStorage();
    }

    const nextKeys = this.storedKeys.filter((key) => key.publicKey !== address);
    if (nextKeys.length === this.storedKeys.length) {
      return this.activeAddress;
    }

    this.storedKeys = nextKeys;
    await this.saveToStorage();

    if (this.activeAddress === address) {
      const nextActive = this.storedKeys[0]?.publicKey || null;
      this.activeAddress = nextActive;

      if (!nextActive) {
        this.activeKeypair = null;
        await chrome.storage.local.remove('suiTestWalletActiveAddress');
        return null;
      }

      await this.setActiveAddress(nextActive);
      return nextActive;
    }

    return this.activeAddress;
  }

  public getActiveKeypair(): Ed25519Keypair | null {
    return this.activeKeypair;
  }

  public async getAddress(): Promise<string | null> {
    if (!this.activeAddress) {
      await this.loadFromStorage();
    }
    return this.activeAddress;
  }

  public async generateKey(alias: string = 'Generated Account'): Promise<StoredKey> {
    const keypair = Ed25519Keypair.generate();
    const bech32Key = keypair.getSecretKey();
    return this.importKey(bech32Key, alias);
  }

  public async getAccounts(): Promise<string[]> {
    if (this.storedKeys.length === 0) {
      await this.loadFromStorage();
    }
    return this.storedKeys.map(k => k.publicKey);
  }

  public async getBech32Key(address: string): Promise<string | null> {
    if (this.storedKeys.length === 0) {
      await this.loadFromStorage();
    }
    const key = this.storedKeys.find(k => k.publicKey === address);
    return key?.bech32Key || null;
  }
}
