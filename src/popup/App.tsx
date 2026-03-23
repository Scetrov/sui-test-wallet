import React, { useEffect, useState } from 'react';

export default function App() {
  const [network, setNetwork] = useState('localnet');
  const [activeAddress, setActiveAddress] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [resolvedNames, setResolvedNames] = useState<Record<string, { suins?: string, eve?: string }>>({});
  const [bech32Key, setBech32Key] = useState('');
  const [mainnetAccepted, setMainnetAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [importExpanded, setImportExpanded] = useState(false);
  const [networkExpanded, setNetworkExpanded] = useState(false);

  useEffect(() => {
    // Load state from background
    chrome.runtime.sendMessage({ type: 'GET_NETWORK' }, (res) => {
      if (res && res.network) setNetwork(res.network);
    });
    const fetchAccounts = () => {
      chrome.runtime.sendMessage({ type: 'GET_ACCOUNTS' }, (res) => {
        if (res) {
          if (res.active) setActiveAddress(res.active);
          if (res.accounts) setAccounts(res.accounts);
          if (res.resolvedNames) setResolvedNames(res.resolvedNames);
        }
      });
    };
    fetchAccounts();
    // Check local storage for mainnet explicit accept
    chrome.storage.local.get(['suiTestWalletMainnetAccepted'], (res) => {
      if (res.suiTestWalletMainnetAccepted) setMainnetAccepted(true);
    });
  }, []);

  const handleImport = () => {
    setError(null);
    chrome.runtime.sendMessage({ type: 'IMPORT_KEY', bech32Key, alias: 'Playwright Test Key' }, (res) => {
      if (res?.error) {
        setError(res.error);
      } else if (res?.address) {
        setActiveAddress(res.address);
        setBech32Key('');
        // Refresh account list
        chrome.runtime.sendMessage({ type: 'GET_ACCOUNTS' }, (res) => {
          if (res?.accounts) setAccounts(res.accounts);
          if (res?.resolvedNames) setResolvedNames(res.resolvedNames);
        });
      } else {
        setError('Failed to import key: ' + chrome.runtime.lastError?.message);
      }
    });
  };

  const handleAccountChange = (address: string) => {
    setActiveAddress(address);
    chrome.runtime.sendMessage({ type: 'SET_ACTIVE_ACCOUNT', address });
  };

  const handleNetworkChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'mainnet' && !mainnetAccepted) return; // Guarded by UI but double check
    setNetwork(val);
    chrome.runtime.sendMessage({ type: 'SET_NETWORK', network: val });
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
                <label key={address} className={`account-item ${activeAddress === address ? 'active' : ''}`}>
                  <input 
                    type="radio" 
                    name="active-account"
                    checked={activeAddress === address}
                    onChange={() => handleAccountChange(address)}
                  />
                  <span className="radio-custom"></span>
                  <div className="account-info">
                    <span className="address-text">
                      {resolvedNames[address]?.eve || resolvedNames[address]?.suins || `${address.slice(0, 8)}...${address.slice(-6)}`}
                    </span>
                    {(resolvedNames[address]?.eve || resolvedNames[address]?.suins) && (
                      <span className="sub-address">{address.slice(0, 8)}...{address.slice(-6)}</span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <div className="text-sm">No accounts imported</div>
          )}
        </div>
      </div>

      <div className="section">
        <div className="section-header" onClick={() => setImportExpanded(!importExpanded)}>
          <h3>Import Key</h3>
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
            <button onClick={handleImport} className="btn-primary" disabled={bech32Key.length === 0}>
              Import
            </button>
            {error && <div className="error-text">{error}</div>}
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
      
      {/* Automation indicator */}
      <div id="sui-test-wallet-automation" data-ready="true" style={{ display: 'none' }} />
    </div>
  );
}
