import { KeyManager } from './KeyManager';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';

const keyManager = new KeyManager();
const EVE_PACKAGE_ID = "0x23ba332291ace9e5926cef3551105f287826c63db3a0d0287b48c35b84246ceb";

async function getNetwork(): Promise<string> {
  const data = await chrome.storage.local.get(['suiTestWalletNetwork']);
  return (data.suiTestWalletNetwork as string) || 'localnet';
}

async function isMainnetAccepted(): Promise<boolean> {
  const data = await chrome.storage.local.get(['suiTestWalletMainnetAccepted']);
  return !!data.suiTestWalletMainnetAccepted;
}

async function resolveNames(client: SuiJsonRpcClient, address: string): Promise<{ suins?: string, eve?: string }> {
  const result: { suins?: string, eve?: string } = {};
  
  try {
    // SuiNS
    const names = await client.resolveNameServiceNames({ address });
    if (names.data && names.data.length > 0) {
      result.suins = names.data[0];
    }
  } catch (e) {
    console.warn('Failed to resolve SuiNS', e);
  }

  try {
    // EVE Frontier
    const playerProfileType = `${EVE_PACKAGE_ID}::character::PlayerProfile`;
    const ownedProfiles = await client.getOwnedObjects({
      owner: address,
      filter: { StructType: playerProfileType },
      options: { showContent: true }
    });

    if (ownedProfiles.data.length > 0) {
      const profile = ownedProfiles.data[0].data;
      if (profile?.content?.dataType === 'moveObject') {
        const characterId = (profile.content.fields as any).character_id;
        if (characterId) {
          const character = await client.getObject({
            id: characterId,
            options: { showContent: true }
          });
          if (character.data?.content?.dataType === 'moveObject') {
            const metadata = (character.data.content.fields as any).metadata;
            // Option<Metadata> handles
            const name = metadata?.fields?.name || metadata?.name;
            if (name) result.eve = name;
          }
        }
      }
    }
  } catch (e) {
    console.warn('Failed to resolve EVE name', e);
  }

  return result;
}

// Background script message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // We need to return true if we respond asynchronously
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ error: err.message || String(err) });
  });
  return true; 
});

async function handleMessage(message: any, _sender: chrome.runtime.MessageSender) {
  // Intercept and prevent mainnet usage if not explicitly accepted
  if (message.type === 'SIGN_TRANSACTION' || message.type === 'SIGN_AND_EXECUTE_TRANSACTION') {
    const network = await getNetwork();
    if (network === 'mainnet') {
      const accepted = await isMainnetAccepted();
      if (!accepted) {
        throw new Error("Sui Test Wallet: Mainnet is not allowed without explicit risk acceptance in the popup.");
      }
    }
  }

  switch (message.type) {
    case 'IMPORT_KEY': {
      const added = await keyManager.importKey(message.bech32Key, message.alias);
      return { success: true, address: added.publicKey };
    }

    case 'IMPORT_WATCH_ADDRESS': {
      const added = await keyManager.importWatchAddress(message.address, message.alias);
      return { success: true, address: added.publicKey };
    }

    case 'GET_ACCOUNTS': {
      const accounts = await keyManager.getAccounts();
      const active = await keyManager.getAddress();
      
      const network = await getNetwork();
      const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network as any), network: network as any });
      
      // Resolve names for all accounts in parallel
      const resolvedNames: Record<string, { suins?: string, eve?: string }> = {};
      const metadata: Record<string, { type: 'private-key' | 'watch-only' }> = {};
      
      const storedKeys = ((await chrome.storage.local.get(['suiTestWalletKeys'])).suiTestWalletKeys as any[]) || [];

      await Promise.all(accounts.map(async (addr) => {
        resolvedNames[addr] = await resolveNames(client, addr);
        const key = storedKeys.find((k: any) => k.publicKey === addr);
        metadata[addr] = { type: key?.bech32Key ? 'private-key' : 'watch-only' };
      }));

      return { accounts, active, resolvedNames, metadata };
    }

    case 'SET_NETWORK': {
      await chrome.storage.local.set({ suiTestWalletNetwork: message.network });
      return { success: true, network: message.network };
    }

    case 'GET_NETWORK': {
      const network = await getNetwork();
      return { network };
    }

    case 'ACCEPT_MAINNET_RISK': {
      await chrome.storage.local.set({ suiTestWalletMainnetAccepted: true });
      return { success: true };
    }

    case 'SET_ACTIVE_ACCOUNT': {
      await keyManager.setActiveAddress(message.address);
      return { success: true };
    }

    case 'REMOVE_ACCOUNT': {
      const active = await keyManager.removeAccount(message.address);
      return { success: true, active };
    }

    case 'SIGN_TRANSACTION': {
      const keypair = keyManager.getActiveKeypair();
      if (!keypair) {
        const address = await keyManager.getAddress();
        const storedKeys = ((await chrome.storage.local.get(['suiTestWalletKeys'])).suiTestWalletKeys as any[]) || [];
        const key = storedKeys.find((k: any) => k.publicKey === address);
        if (key && !key.bech32Key) {
            throw new Error("Cannot sign with a watch-only account. Please import the private key.");
        }
        throw new Error("No active keypair found. Import a key first.");
      }

      const tx = Transaction.from(message.txJson);
      const network = await getNetwork();
      const signature = await tx.sign({ client: new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network as any), network: network as any }), signer: keypair });

      return { signature: signature.signature, bytes: signature.bytes };
    }

    case 'SIGN_AND_EXECUTE_TRANSACTION': {
      const keypair = keyManager.getActiveKeypair();
      if (!keypair) {
        const address = await keyManager.getAddress();
        const storedKeys = ((await chrome.storage.local.get(['suiTestWalletKeys'])).suiTestWalletKeys as any[]) || [];
        const key = storedKeys.find((k: any) => k.publicKey === address);
        if (key && !key.bech32Key) {
            throw new Error("Cannot sign with a watch-only account. Please import the private key.");
        }
        throw new Error("No active keypair found. Import a key first.");
      }

      const network = await getNetwork();
      const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network as any), network: network as any });
      
      const tx = Transaction.from(message.txJson);
      const response = await client.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        options: message.options || { showEffects: true, showObjectChanges: true }
      });

      return response;
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}
