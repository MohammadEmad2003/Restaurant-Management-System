import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, AlertCircle } from 'lucide-react';
import { useAuth } from '../store/auth.js';

export default function LicenseActivation() {
  const nav = useNavigate();
  const { activateLicense, loading, error, user } = useAuth();
  const [token, setToken] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (await activateLicense(token)) nav('/');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 480, padding: 40, borderRadius: 'var(--r-lg)', background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="row" style={{ gap: 14, marginBottom: 24 }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--warning)', display: 'grid', placeItems: 'center' }}>
            <KeyRound size={28} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Activate License</div>
            <div className="muted" style={{ fontSize: 13 }}>{user?.restaurantName}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 16, borderRadius: 'var(--r-md)', background: 'rgba(var(--warning-rgb), 0.08)', marginBottom: 24 }}>
          <AlertCircle size={20} color="var(--warning)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            Your restaurant license is inactive. Enter the Activation Token provided by the Super Admin to continue.
            Only the Restaurant Admin can activate the license.
          </div>
        </div>

        <form onSubmit={submit}>
          <div className="field">
            <label>Activation Token</label>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ACT-XXXX-XXXX-XXXX"
              autoFocus
              style={{ width: '100%', padding: 12, borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', fontSize: 16, fontFamily: 'monospace' }}
            />
          </div>

          {error && <div className="badge badge--danger" style={{ marginBottom: 14 }}>{error}</div>}

          <button className="btn btn--primary" style={{ width: '100%', justifyContent: 'center', padding: 13 }} disabled={loading}>
            {loading ? 'Activating...' : 'Activate License'}
          </button>
        </form>
      </div>
    </div>
  );
}
