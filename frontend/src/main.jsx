import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n/index.js';
import './styles/globals.css';
import App from './App.jsx';

try {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} catch (err) {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = '<div style="height:100vh;display:grid;place-items:center;background:#f6f7fb;color:#111827;font-family:system-ui,sans-serif;">' +
      '<div style="max-width:520px;padding:24px;">' +
      '<h2 style="color:#ef4444;margin:0 0 12px;">Application failed to start</h2>' +
      '<pre style="background:#fff;border:1px solid #eceef3;padding:16px;border-radius:12px;overflow:auto;font-size:13px;">' + (err?.stack || err?.message || String(err)) + '</pre>' +
      '<p>Open the browser console (F12) for more details.</p>' +
      '</div></div>';
  }
  console.error('React mount failed:', err);
}
