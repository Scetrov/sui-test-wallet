import { KeyManager } from './KeyManager';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { Transaction } from '@mysten/sui/transactions';

const keyManager = new KeyManager();
const EVE_PACKAGE_ID = "0x23ba332291ace9e5926cef3551105f287826c63db3a0d0287b48c35b84246ceb";
const AUTO_APPROVE_DELAY_MS = 5000;

type ApprovalRequestType = 'SIGN_TRANSACTION' | 'SIGN_AND_EXECUTE_TRANSACTION';

interface PendingApproval {
  id: string;
  requestType: ApprovalRequestType;
  txJson: string;
  address: string | null;
  network: string;
  autoApproveEnabled: boolean;
  autoApproveAt: number | null;
  windowId?: number;
  timeoutId?: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

const pendingApprovals = new Map<string, PendingApproval>();

async function getNetwork(): Promise<string> {
  const data = await chrome.storage.local.get(['suiTestWalletNetwork']);
  return (data.suiTestWalletNetwork as string) || 'localnet';
}

async function isMainnetAccepted(): Promise<boolean> {
  const data = await chrome.storage.local.get(['suiTestWalletMainnetAccepted']);
  return !!data.suiTestWalletMainnetAccepted;
}

async function isAutoApproveEnabled(): Promise<boolean> {
  const data = await chrome.storage.local.get(['suiTestWalletAutoApprove']);
  return !!data.suiTestWalletAutoApprove;
}

function canUseFaucet(network: string): network is 'localnet' | 'devnet' | 'testnet' {
  return network === 'localnet' || network === 'devnet' || network === 'testnet';
}

function createApprovalId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function serializePendingApproval(approval: PendingApproval) {
  return {
    id: approval.id,
    requestType: approval.requestType,
    txJson: approval.txJson,
    address: approval.address,
    network: approval.network,
    autoApproveEnabled: approval.autoApproveEnabled,
    autoApproveAt: approval.autoApproveAt,
  };
}

function finalizePendingApproval(id: string, approved: boolean, reason = 'Transaction rejected by user.') {
  const approval = pendingApprovals.get(id);
  if (!approval) {
    return false;
  }

  pendingApprovals.delete(id);

  if (approval.timeoutId !== undefined) {
    clearTimeout(approval.timeoutId);
  }

  if (approval.windowId !== undefined) {
    chrome.windows.remove(approval.windowId).catch(() => undefined);
  }

  if (approved) {
    approval.resolve();
  } else {
    approval.reject(new Error(reason));
  }

  return true;
}

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [id, approval] of pendingApprovals.entries()) {
    if (approval.windowId === windowId) {
      finalizePendingApproval(id, false, 'Approval window closed.');
      break;
    }
  }
});

async function requestTransactionApproval(requestType: ApprovalRequestType, txJson: string): Promise<void> {
  const approvalId = createApprovalId();
  const address = await keyManager.getAddress();
  const network = await getNetwork();
  const autoApproveEnabled = await isAutoApproveEnabled();
  const autoApproveAt = autoApproveEnabled ? Date.now() + AUTO_APPROVE_DELAY_MS : null;

  await new Promise<void>((resolve, reject) => {
    const approval: PendingApproval = {
      id: approvalId,
      requestType,
      txJson,
      address,
      network,
      autoApproveEnabled,
      autoApproveAt,
      resolve,
      reject,
    };

    pendingApprovals.set(approvalId, approval);

    if (autoApproveEnabled) {
      approval.timeoutId = setTimeout(() => {
        finalizePendingApproval(approvalId, true);
      }, AUTO_APPROVE_DELAY_MS) as unknown as number;
    }

    chrome.windows.create({
      url: chrome.runtime.getURL(`popup.html?approval=${encodeURIComponent(approvalId)}`),
      type: 'popup',
      width: 460,
      height: 760,
      focused: true,
    }).then((approvalWindow) => {
      if (approvalWindow && approvalWindow.id !== undefined) {
        approval.windowId = approvalWindow.id;
      }
    }).catch((error) => {
      pendingApprovals.delete(approvalId);
      if (approval.timeoutId !== undefined) {
        clearTimeout(approval.timeoutId);
      }
      reject(new Error(`Failed to open approval dialog: ${error.message || String(error)}`));
    });
  });
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

    case 'GENERATE_ACCOUNT': {
      const added = await keyManager.generateKey(message.alias);
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
      const balances: Record<string, string> = {};
      
      const storedKeys = ((await chrome.storage.local.get(['suiTestWalletKeys'])).suiTestWalletKeys as any[]) || [];

      await Promise.all(accounts.map(async (addr: string) => {
        const [names, balance] = await Promise.all([
          resolveNames(client, addr),
          client.getBalance({ owner: addr }).catch((error) => {
            console.warn('Failed to load balance', addr, error);
            return { totalBalance: '0' };
          }),
        ]);

        resolvedNames[addr] = names;
        balances[addr] = balance.totalBalance;
        const key = storedKeys.find((k: any) => k.publicKey === addr);
        metadata[addr] = { type: key?.bech32Key ? 'private-key' : 'watch-only' };
      }));

      return { accounts, active, resolvedNames, metadata, balances, network, faucetAvailable: canUseFaucet(network) };
    }

    case 'SET_NETWORK': {
      await chrome.storage.local.set({ suiTestWalletNetwork: message.network });
      return { success: true, network: message.network };
    }

    case 'GET_NETWORK': {
      const network = await getNetwork();
      return { network };
    }

    case 'GET_PRIVATE_KEY': {
      const bech32Key = await keyManager.getBech32Key(message.address);
      return { bech32Key };
    }

    case 'GET_APPROVAL_SETTINGS': {
      const autoApproveEnabled = await isAutoApproveEnabled();
      return { autoApproveEnabled };
    }

    case 'SET_AUTO_APPROVE': {
      await chrome.storage.local.set({ suiTestWalletAutoApprove: !!message.enabled });
      return { success: true, autoApproveEnabled: !!message.enabled };
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

    case 'REQUEST_FAUCET': {
      const network = await getNetwork();

      if (!canUseFaucet(network)) {
        throw new Error(`Faucet is not available for ${network}.`);
      }

      await requestSuiFromFaucetV2({
        host: getFaucetHost(network),
        recipient: message.address,
      });

      return { success: true, network };
    }

    case 'GET_PENDING_APPROVAL': {
      const approval = pendingApprovals.get(message.id);
      if (!approval) {
        return { request: null };
      }

      return { request: serializePendingApproval(approval) };
    }

    case 'APPROVE_PENDING_APPROVAL': {
      const didApprove = finalizePendingApproval(message.id, true);
      if (!didApprove) {
        throw new Error('Approval request not found.');
      }

      return { success: true };
    }

    case 'REJECT_PENDING_APPROVAL': {
      const didReject = finalizePendingApproval(message.id, false);
      if (!didReject) {
        throw new Error('Approval request not found.');
      }

      return { success: true };
    }

    case 'OPEN_TEST_APPROVAL': {
      await requestTransactionApproval(
        (message.requestType as ApprovalRequestType) || 'SIGN_TRANSACTION',
        message.txJson || JSON.stringify({ kind: 'test-approval' }),
      );

      return { success: true };
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

          await requestTransactionApproval('SIGN_TRANSACTION', message.txJson);

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

          await requestTransactionApproval('SIGN_AND_EXECUTE_TRANSACTION', message.txJson);

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
