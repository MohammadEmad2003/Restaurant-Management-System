import { WifiOff } from 'lucide-react';
import { Card } from './ui.jsx';

/** Full-screen blocking state for offline access that has lapsed its rolling
 * validation window (or has no valid offline license at all) — shown instead
 * of the app until connectivity returns. */
export default function OfflineBlock({ reason }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', padding: 24 }}>
      <Card style={{ maxWidth: 440, textAlign: 'center', padding: 32 }}>
        <div style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--warning)', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
          <WifiOff size={26} color="#fff" />
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Reconnect to continue</div>
        <div className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
          {reason || 'This device needs to check in online before continuing.'}
        </div>
      </Card>
    </div>
  );
}
