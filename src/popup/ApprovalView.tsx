import { useEffect, useMemo, useState } from 'react';

type ApprovalRequest = {
  id: string;
  requestType: 'SIGN_TRANSACTION' | 'SIGN_AND_EXECUTE_TRANSACTION';
  txJson: string;
  address: string | null;
  network: string;
  autoApproveEnabled: boolean;
  autoApproveAt: number | null;
};

function formatRequestType(requestType: ApprovalRequest['requestType']) {
  return requestType === 'SIGN_AND_EXECUTE_TRANSACTION' ? 'Sign and Execute Transaction' : 'Sign Transaction';
}

function summarizeTransaction(txJson: string) {
  try {
    const parsed = JSON.parse(txJson) as Record<string, unknown>;
    const summary: Array<{ label: string; value: string }> = [];

    const kind = typeof parsed.kind === 'string'
      ? parsed.kind
      : typeof parsed.transactionKind === 'string'
        ? parsed.transactionKind
        : typeof parsed.version === 'number'
          ? `Transaction v${parsed.version}`
          : null;

    if (kind) {
      summary.push({ label: 'Type', value: kind });
    }

    if (typeof parsed.sender === 'string') {
      summary.push({ label: 'Sender', value: parsed.sender });
    }

    const commands = Array.isArray(parsed.commands)
      ? parsed.commands
      : Array.isArray((parsed as { transactions?: unknown[] }).transactions)
        ? (parsed as { transactions: unknown[] }).transactions
        : null;

    if (commands) {
      summary.push({ label: 'Commands', value: `${commands.length}` });
    }

    const gasBudget =
      typeof (parsed as { gasData?: { budget?: string | number } }).gasData?.budget !== 'undefined'
        ? String((parsed as { gasData?: { budget?: string | number } }).gasData?.budget)
        : typeof (parsed as { gasConfig?: { budget?: string | number } }).gasConfig?.budget !== 'undefined'
          ? String((parsed as { gasConfig?: { budget?: string | number } }).gasConfig?.budget)
          : null;

    if (gasBudget) {
      summary.push({ label: 'Gas Budget', value: gasBudget });
    }

    return summary;
  } catch {
    return [];
  }
}

export default function ApprovalView({ approvalId }: { approvalId: string }) {
  const [request, setRequest] = useState<ApprovalRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_PENDING_APPROVAL', id: approvalId }, (res) => {
      setLoading(false);

      if (res?.error) {
        setError(res.error);
        return;
      }

      if (!res?.request) {
        setError('This approval request is no longer available.');
        return;
      }

      setRequest(res.request);
    });
  }, [approvalId]);

  useEffect(() => {
    if (!request?.autoApproveAt) {
      setRemainingMs(null);
      return;
    }

    const updateRemaining = () => {
      setRemainingMs(Math.max(0, request.autoApproveAt! - Date.now()));
    };

    updateRemaining();
    const intervalId = window.setInterval(updateRemaining, 200);
    return () => window.clearInterval(intervalId);
  }, [request]);

  const prettyTx = useMemo(() => {
    if (!request) {
      return '';
    }

    try {
      return JSON.stringify(JSON.parse(request.txJson), null, 2);
    } catch {
      return request.txJson;
    }
  }, [request]);

  const transactionSummary = useMemo(() => {
    if (!request) {
      return [];
    }

    return summarizeTransaction(request.txJson);
  }, [request]);

  const handleDecision = (type: 'APPROVE_PENDING_APPROVAL' | 'REJECT_PENDING_APPROVAL') => {
    setSubmitting(type === 'APPROVE_PENDING_APPROVAL' ? 'approve' : 'reject');
    chrome.runtime.sendMessage({ type, id: approvalId }, (res) => {
      if (res?.error) {
        setSubmitting(null);
        setError(res.error);
        return;
      }

      window.close();
    });
  };

  return (
    <div className="popup-container approval-page">
      <div className="warning-banner approval-banner">
        <span className="warning-icon">⚠️</span>
        <div className="warning-text">
          Transaction approval required<br/>
          Review before signing
        </div>
      </div>

      <div className="section approval-section">
        <div className="section-header approval-header">
          <h3>Approve Transaction</h3>
        </div>

        <div className="section-content approval-content">
          {loading && <div className="text-sm">Loading approval request...</div>}

          {!loading && error && <div className="error-text approval-error">{error}</div>}

          {!loading && request && (
            <>
              <div className="approval-meta-list">
                <div className="approval-meta-row">
                  <span className="approval-label">Action</span>
                  <span className="approval-value">{formatRequestType(request.requestType)}</span>
                </div>
                <div className="approval-meta-row">
                  <span className="approval-label">Network</span>
                  <span className="approval-value">{request.network}</span>
                </div>
                <div className="approval-meta-row approval-address-row">
                  <span className="approval-label">Account</span>
                  <span className="approval-value monospace-value">{request.address || 'No active account'}</span>
                </div>
              </div>

              <div className="approval-countdown-card">
                {request.autoApproveEnabled ? (
                  <>
                    <span className="countdown-label">Auto-approve enabled</span>
                    <span className="countdown-value">
                      Approving in {remainingMs !== null ? (remainingMs / 1000).toFixed(1) : '5.0'}s
                    </span>
                  </>
                ) : (
                  <>
                    <span className="countdown-label">Manual approval</span>
                    <span className="countdown-value">This request will wait until you approve or reject it.</span>
                  </>
                )}
              </div>

              {transactionSummary.length > 0 && (
                <div className="approval-summary-card">
                  <div className="approval-tx-label">Transaction summary</div>
                  <div className="approval-summary-list">
                    {transactionSummary.map((item) => (
                      <div key={item.label} className="approval-meta-row">
                        <span className="approval-label">{item.label}</span>
                        <span className="approval-value monospace-value">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="approval-tx-block">
                <div className="approval-tx-label">Transaction payload</div>
                <pre className="approval-tx-preview">{prettyTx}</pre>
              </div>

              <div className="approval-button-row">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={submitting !== null}
                  onClick={() => handleDecision('REJECT_PENDING_APPROVAL')}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={submitting !== null}
                  onClick={() => handleDecision('APPROVE_PENDING_APPROVAL')}
                >
                  Approve
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}