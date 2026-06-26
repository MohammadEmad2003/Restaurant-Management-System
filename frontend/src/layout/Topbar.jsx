import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, Search, Sun, Moon, Languages, LogOut, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../store/auth.js';
import { useUI } from '../store/ui.js';
import { api } from '../api/client.js';
import { Avatar } from '../components/ui.jsx';

export default function Topbar() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme, toggleLang, toggleSidebar, lang } = useUI();
  const [online, setOnline] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    let on = true;
    const ping = () => api.get('/sync/status').then((r) => on && setOnline(r.data.online)).catch(() => {});
    ping();
    const id = setInterval(ping, 12000);
    return () => { on = false; clearInterval(id); };
  }, []);

  return (
    <header style={{
      height: 'var(--topbar-h)', position: 'sticky', top: 0, zIndex: 50,
      background: 'color-mix(in srgb, var(--bg-elev) 88%, transparent)', backdropFilter: 'blur(10px)',
      borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center',
      gap: 14, padding: '0 24px',
    }}>
      <button className="btn btn--icon btn--ghost" onClick={toggleSidebar}><Menu size={20} /></button>

      <div className="search" style={{ maxWidth: 340 }}>
        <Search size={16} color="var(--muted)" />
        <input placeholder={t('common.search')} />
      </div>

      <div className="spacer" />

      <span className={`badge badge--${online ? 'success' : 'warning'}`} title="Connectivity / sync mode">
        {online ? <Wifi size={13} /> : <WifiOff size={13} />}
        {online ? t('common.online') : t('common.offline')}
      </span>

      <button className="btn btn--icon btn--ghost" onClick={toggleLang} title={t('common.language')}>
        <Languages size={18} /><span style={{ fontSize: 12, fontWeight: 700 }}>{lang === 'en' ? 'ع' : 'EN'}</span>
      </button>

      <button className="btn btn--icon btn--ghost" onClick={toggleTheme} title={t('common.theme')}>
        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
      </button>

      <div style={{ position: 'relative' }}>
        <button className="row" style={{ gap: 10 }} onClick={() => setMenu((m) => !m)}>
          <Avatar name={user?.name} size={36} />
          <div style={{ textAlign: 'start', lineHeight: 1.25 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{(user?.name || '').replace(/—.*/, '')}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'capitalize' }}>{user?.role}</div>
          </div>
        </button>
        {menu && (
          <div className="card" style={{ position: 'absolute', insetInlineEnd: 0, top: 48, minWidth: 180, padding: 8, zIndex: 60 }}
            onMouseLeave={() => setMenu(false)}>
            <button className="btn btn--ghost" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={logout}>
              <LogOut size={16} /> {t('common.logout')}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
