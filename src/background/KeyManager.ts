import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

export interface StoredKey {
  alias: string;
  publicKey: string;
  bech32Key: string;
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
        if (activeKey) {
          this.activeKeypair = this.deriveKeypair(activeKey.bech32Key);
        } else if (this.storedKeys.length > 0) {
          // Fallback if activeAddress not found in storedKeys
          this.activeAddress = this.storedKeys[0].publicKey;
          this.activeKeypair = this.deriveKeypair(this.storedKeys[0].bech32Key);
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

  public async setActiveAddress(address: string): Promise<void> {
    const key = this.storedKeys.find(k => k.publicKey === address);
    if (key) {
      this.activeAddress = address;
      this.activeKeypair = this.deriveKeypair(key.bech32Key);
      await chrome.storage.local.set({ suiTestWalletActiveAddress: address });
    }
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

  public async getAccounts(): Promise<string[]> {
    if (this.storedKeys.length === 0) {
      await this.loadFromStorage();
    }
    return this.storedKeys.map(k => k.publicKey);
  }
}
