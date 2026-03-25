import React, { useEffect, useState } from 'react';
import ApprovalView from './ApprovalView';

const MIST_PER_SUI = 1_000_000_000;

function formatSuiBalance(balance: string | undefined) {
  if (!balance) return '0 SUI';

  try {
    const mist = BigInt(balance);
    const whole = mist / BigInt(MIST_PER_SUI);
    const fraction = (mist % BigInt(MIST_PER_SUI)).toString().padStart(9, '0').slice(0, 4).replace(/0+$/, '');
    const wholeFormatted = new Intl.NumberFormat('en-US').format(Number(whole));
    return `${fraction ? `${wholeFormatted}.${fraction}` : wholeFormatted} SUI`;
  } catch {
    return '0 SUI';
  }
}

export default function App() {
  const approvalId = new URLSearchParams(window.location.search).get('approval');

  if (approvalId) {
    return <ApprovalView approvalId={approvalId} />;
  }

  return <WalletApp />;
}

function WalletApp() {
  const [network, setNetwork] = useState('localnet');
  const [activeAddress, setActiveAddress] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [resolvedNames, setResolvedNames] = useState<Record<string, { suins?: string, eve?: string }>>({});
  const [accountMetadata, setAccountMetadata] = useState<Record<string, { type: 'private-key' | 'watch-only' }>>({});
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [pendingDeleteAddress, setPendingDeleteAddress] = useState<string | null>(null);
  const [fundingAddress, setFundingAddress] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [copiedPrivateKey, setCopiedPrivateKey] = useState<string | null>(null);
  const [faucetAvailable, setFaucetAvailable] = useState(false);
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(false);
  const [bech32Key, setBech32Key] = useState('');
  const [watchAddress, setWatchAddress] = useState('');
  const [mainnetAccepted, setMainnetAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [importExpanded, setImportExpanded] = useState(false);
  const [generateExpanded, setGenerateExpanded] = useState(false);
  const [watchExpanded, setWatchExpanded] = useState(false);
  const [networkExpanded, setNetworkExpanded] = useState(false);
  const [approvalExpanded, setApprovalExpanded] = useState(false);

  const fetchAccounts = () => {
    chrome.runtime.sendMessage({ type: 'GET_ACCOUNTS' }, (res) => {
      if (res) {
        if (res.active !== undefined) setActiveAddress(res.active);
        if (res.accounts) setAccounts(res.accounts);
        if (res.resolvedNames) setResolvedNames(res.resolvedNames);
        if (res.metadata) setAccountMetadata(res.metadata);
        if (res.balances) setBalances(res.balances);
        if (res.network) setNetwork(res.network);
        setFaucetAvailable(!!res.faucetAvailable);
        if (pendingDeleteAddress && !res.accounts?.includes(pendingDeleteAddress)) {
          setPendingDeleteAddress(null);
        }
        if (fundingAddress && !res.accounts?.includes(fundingAddress)) {
          setFundingAddress(null);
        }
      }
    });
  };

  useEffect(() => {
    // Load state from background
    chrome.runtime.sendMessage({ type: 'GET_NETWORK' }, (res) => {
      if (res && res.network) setNetwork(res.network);
    });

    fetchAccounts();
    // Check local storage for mainnet explicit accept
    chrome.storage.local.get(['suiTestWalletMainnetAccepted'], (res) => {
      if (res.suiTestWalletMainnetAccepted) setMainnetAccepted(true);
    });
    chrome.runtime.sendMessage({ type: 'GET_APPROVAL_SETTINGS' }, (res) => {
      if (res && typeof res.autoApproveEnabled === 'boolean') {
        setAutoApproveEnabled(res.autoApproveEnabled);
      }
    });
  }, []);

  const handleImport = (mode: 'private-key' | 'watch-only') => {
    setError(null);
    const type = mode === 'private-key' ? 'IMPORT_KEY' : 'IMPORT_WATCH_ADDRESS';
    const payload = mode === 'private-key' 
      ? { type, bech32Key, alias: 'Playwright Test Key' }
      : { type, address: watchAddress, alias: 'Watch Account' };

    chrome.runtime.sendMessage(payload, (res) => {
      if (res?.error) {
        setError(res.error);
      } else if (res?.address) {
        setActiveAddress(res.address);
        if (mode === 'private-key') setBech32Key('');
        else setWatchAddress('');
        fetchAccounts();
      } else {
        setError('Failed to import: ' + chrome.runtime.lastError?.message);
      }
    });
  };

  const handleGenerate = () => {
    setError(null);
    chrome.runtime.sendMessage({ type: 'GENERATE_ACCOUNT', alias: 'Generated Account' }, (res) => {
      if (res?.error) {
        setError(res.error);
      } else if (res?.address) {
        setActiveAddress(res.address);
        setGenerateExpanded(false);
        fetchAccounts();
      } else {
        setError('Failed to generate: ' + chrome.runtime.lastError?.message);
      }
    });
  };

  const handleAccountChange = (address: string) => {
    setActiveAddress(address);
    chrome.runtime.sendMessage({ type: 'SET_ACTIVE_ACCOUNT', address });
  };

  const handleDeleteAccount = (address: string) => {
    setError(null);
    setPendingDeleteAddress(null);
    chrome.runtime.sendMessage({ type: 'REMOVE_ACCOUNT', address }, (res) => {
      if (res?.error) {
        setError(res.error);
        return;
      }

      if (res && 'active' in res) {
        setActiveAddress(res.active ?? null);
      }

      fetchAccounts();
    });
  };

  const toggleDeleteConfirmation = (address: string) => {
    setPendingDeleteAddress((current) => current === address ? null : address);
  };

  const handleFundAccount = (address: string) => {
    setError(null);
    setFundingAddress(address);

    chrome.runtime.sendMessage({ type: 'REQUEST_FAUCET', address }, (res) => {
      setFundingAddress(null);

      if (res?.error) {
        setError(res.error);
        return;
      }

      window.setTimeout(() => {
        fetchAccounts();
      }, 1500);
    });
  };

  const handleCopyAddress = async (address: string) => {
    setError(null);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
      } else {
        const input = document.createElement('textarea');
        input.value = address;
        input.setAttribute('readonly', '');
        input.style.position = 'absolute';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }

      setCopiedAddress(address);
      window.setTimeout(() => {
        setCopiedAddress((current) => current === address ? null : current);
      }, 1200);
    } catch {
      setError('Failed to copy address to clipboard.');
    }
  };

  const handleCopyPrivateKey = async (address: string) => {
    setError(null);

    chrome.runtime.sendMessage({ type: 'GET_PRIVATE_KEY', address }, async (res) => {
      if (res?.bech32Key) {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(res.bech32Key);
          } else {
            const input = document.createElement('textarea');
            input.value = res.bech32Key;
            input.setAttribute('readonly', '');
            input.style.position = 'absolute';
            input.style.left = '-9999px';
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
          }

          setCopiedPrivateKey(address);
          window.setTimeout(() => {
            setCopiedPrivateKey((current) => current === address ? null : current);
          }, 1200);
        } catch {
          setError('Failed to copy private key to clipboard.');
        }
      } else {
        setError('Failed to retrieve private key.');
      }
    });
  };

  const handleNetworkChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'mainnet' && !mainnetAccepted) return; // Guarded by UI but double check
    setNetwork(val);
    chrome.runtime.sendMessage({ type: 'SET_NETWORK', network: val }, () => {
      fetchAccounts();
    });
  };

  const handleRiskAccept = (e: React.ChangeEvent<HTMLInputElement>) => {
    const accepted = e.target.checked;
    setMainnetAccepted(accepted);
    if (accepted) {
      chrome.runtime.sendMessage({ type: 'ACCEPT_MAINNET_RISK' });
    } else if (network === 'mainnet') {
      // Revert from mainnet if risk is unchecked
      setNetwork('localnet');
      chrome.runtime.sendMessage({ type: 'SET_NETWORK', network: 'localnet' });
    }
  };

  const handleAutoApproveChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    setAutoApproveEnabled(enabled);
    chrome.runtime.sendMessage({ type: 'SET_AUTO_APPROVE', enabled });
  };

  return (
    <div className="popup-container">
      <div className="warning-banner">
        <span className="warning-icon">⚠️</span>
        <div className="warning-text">
          Insecure automation wallet<br/>
          Do not use with real assets
        </div>
      </div>
      
      <div className="section">
        <div className="section-header">
          <h3>Accounts</h3>
        </div>
        <div className="section-content">
          {accounts.length > 0 ? (
            <div className="account-list">
              {accounts.map((address) => (
                <div key={address} className={`account-item ${activeAddress === address ? 'active' : ''}`}>
                  <label className="account-select">
                    <input 
                      type="radio" 
                      name="active-account"
                      checked={activeAddress === address}
                      onChange={() => handleAccountChange(address)}
                    />
                    <span className="radio-custom"></span>
                    <div className="account-info">
                      <div className="account-header-row">
                        <span className="address-text">
                          {resolvedNames[address]?.eve || resolvedNames[address]?.suins || `${address.slice(0, 8)}...${address.slice(-6)}`}
                        </span>
                        {accountMetadata[address]?.type === 'watch-only' && (
                          <span className="badge badge-watch">Watch Only</span>
                        )}
                      </div>
                      {(resolvedNames[address]?.eve || resolvedNames[address]?.suins) && (
                        <span className="sub-address">{address.slice(0, 8)}...{address.slice(-6)}</span>
                      )}
                      <div className="account-balance-row">
                        <span className="balance-value">{formatSuiBalance(balances[address])}</span>
                      </div>
                    </div>
                  </label>
                  <div className={`account-actions ${pendingDeleteAddress === address ? 'confirming' : ''}`}>
                    <button
                      type="button"
                      className={`account-action-button copy-account-button ${copiedAddress === address ? 'copied' : ''}`}
                      aria-label={`Copy address ${address}`}
                      onClick={() => handleCopyAddress(address)}
                    >
                      {copiedAddress === address ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z" fill="currentColor" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      className={`account-action-button copy-account-button ${copiedPrivateKey === address ? 'copied' : ''}`}
                      aria-label={`Copy private key for ${address}`}
                      disabled={accountMetadata[address]?.type === 'watch-only'}
                      title={accountMetadata[address]?.type === 'watch-only' ? 'Private key not available for watch-only addresses' : 'Copy private key'}
                      onClick={() => handleCopyPrivateKey(address)}
                    >
                      {copiedPrivateKey === address ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" fill="currentColor" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      className="account-action-button fund-account-button"
                      aria-label={`Fund account ${address}`}
                      disabled={!faucetAvailable || fundingAddress === address}
                      onClick={() => handleFundAccount(address)}
                    >
                      {fundingAddress === address ? (
                        <span className="fund-loading-indicator" aria-hidden="true">...</span>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M11 3h2v7h7v2h-7v7h-2v-7H4v-2h7V3z" fill="currentColor" />
                        </svg>
                      )}
                    </button>
                    {pendingDeleteAddress === address ? (
                      <>
                        <button
                          type="button"
                          className="account-action-button confirm-account-button"
                          aria-label={`Confirm delete account ${address}`}
                          onClick={() => handleDeleteAccount(address)}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="account-action-button cancel-account-button"
                          aria-label={`Cancel delete account ${address}`}
                          onClick={() => setPendingDeleteAddress(null)}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.29 19.7 2.88 18.3 9.17 12l-6.3-6.29L4.29 4.3l6.3 6.29 6.29-6.3z" fill="currentColor" />
                          </svg>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="account-action-button delete-account-button"
                        aria-label={`Delete account ${address}`}
                        onClick={() => toggleDeleteConfirmation(address)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v7h-2v-7zm4 0h2v7h-2v-7zM7 10h2v7H7v-7zm1 10h8a2 2 0 0 0 2-2V8H6v10a2 2 0 0 0 2 2z" fill="currentColor" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm">No accounts imported</div>
          )}
          {error && <div className="error-text account-error">{error}</div>}
        </div>
      </div>

      <div className="section">
        <div className="section-header" onClick={() => setGenerateExpanded(!generateExpanded)}>
          <h3>Generate New Account</h3>
          <span className={`chevron ${generateExpanded ? 'expanded' : ''}`}>▼</span>
        </div>
        
        {generateExpanded && (
          <div className="section-content">
            <div className="text-sm" style={{ marginBottom: '12px' }}>
              This will generate a brand new Sui account and automatically import it.
            </div>
            <button 
              onClick={handleGenerate} 
              className="btn-primary"
            >
              Generate Account
            </button>
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-header" onClick={() => setImportExpanded(!importExpanded)}>
          <h3>Import Private Key</h3>
          <span className={`chevron ${importExpanded ? 'expanded' : ''}`}>▼</span>
        </div>
        
        {importExpanded && (
          <div className="section-content">
            <input 
              type="password" 
              value={bech32Key}
              onChange={(e) => setBech32Key(e.target.value)}
              placeholder="suiprivkey1..." 
              className="input-field"
            />
            <button 
              onClick={() => handleImport('private-key')} 
              className="btn-primary" 
              disabled={bech32Key.length === 0}
            >
              Import Key
            </button>
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-header" onClick={() => setWatchExpanded(!watchExpanded)}>
          <h3>Watch Wallet</h3>
          <span className={`chevron ${watchExpanded ? 'expanded' : ''}`}>▼</span>
        </div>
        
        {watchExpanded && (
          <div className="section-content">
            <input 
              type="text" 
              value={watchAddress}
              onChange={(e) => setWatchAddress(e.target.value)}
              placeholder="0x..." 
              className="input-field"
            />
            <button 
              onClick={() => handleImport('watch-only')} 
              className="btn-primary" 
              disabled={watchAddress.length === 0}
            >
              Add Watch Address
            </button>
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-header" onClick={() => setNetworkExpanded(!networkExpanded)}>
          <h3>Network</h3>
          <span className={`chevron ${networkExpanded ? 'expanded' : ''}`}>▼</span>
        </div>

        {networkExpanded && (
          <div className="section-content">
            <select value={network} onChange={handleNetworkChange} className="select-field">
              <option value="localnet">Localnet</option>
              <option value="devnet">Devnet</option>
              <option value="testnet">Testnet</option>
              <option value="mainnet" disabled={!mainnetAccepted}>Mainnet</option>
            </select>
            
            <label className="checkbox-label">
              <input 
                type="checkbox" 
                checked={mainnetAccepted} 
                onChange={handleRiskAccept}
              />
              I accept the risks of using mainnet with this insecure wallet
            </label>
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-header" onClick={() => setApprovalExpanded(!approvalExpanded)}>
          <h3>Transaction Approval</h3>
          <span className={`chevron ${approvalExpanded ? 'expanded' : ''}`}>▼</span>
        </div>

        {approvalExpanded && (
          <div className="section-content">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autoApproveEnabled}
                onChange={handleAutoApproveChange}
              />
              Show the approval dialog and auto-approve after 5 seconds
            </label>
          </div>
        )}
      </div>
      
      {/* Automation indicator */}
      <div id="sui-test-wallet-automation" data-ready="true" style={{ display: 'none' }} />
    </div>
  );
}
