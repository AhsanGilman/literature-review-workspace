import React, { useState } from 'react';
import { X, Save, RefreshCw, UploadCloud, DownloadCloud, LogOut, Sun, Moon } from 'lucide-react';

interface Settings {
  googleClientId: string;
  githubPat: string;
  githubRepo: string;
  theme: 'dark' | 'light';
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSaveSettings: (settings: Settings) => void;
  onSyncToGitHub: () => Promise<void>;
  onSyncFromGitHub: () => Promise<void>;
  syncing: boolean;
  syncStatus: string;
  syncError: string;
  user: { email: string; name: string; picture: string } | null;
  onLogout: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  onSyncToGitHub,
  onSyncFromGitHub,
  syncing,
  syncStatus,
  syncError,
  user,
  onLogout,
}) => {
  const [googleClientId, setGoogleClientId] = useState(settings.googleClientId);
  const [githubPat, setGithubPat] = useState(settings.githubPat);
  const [githubRepo, setGithubRepo] = useState(settings.githubRepo);
  const [theme, setTheme] = useState<'dark' | 'light'>(settings.theme);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings({
      googleClientId: googleClientId.trim(),
      githubPat: githubPat.trim(),
      githubRepo: githubRepo.trim(),
      theme,
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem' }}>Workspace Settings</h2>
          <button onClick={onClose} className="tool-btn" style={{ padding: '4px' }}>
            <X size={20} />
          </button>
        </div>

        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', marginBottom: '24px' }}>
            <img src={user.picture} alt={user.name} style={{ width: '40px', height: '40px', borderRadius: '50%' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
            </div>
            <button onClick={onLogout} className="tool-btn" style={{ color: 'var(--danger)', display: 'flex', gap: '6px', fontSize: '0.8rem', padding: '8px 12px', borderRadius: 'var(--radius-md)' }}>
              <LogOut size={16} />
              <span>Log Out</span>
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
              Appearance Theme
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button
                type="button"
                className={`btn-secondary ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => setTheme('dark')}
                style={{
                  border: theme === 'dark' ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                  backgroundColor: theme === 'dark' ? 'var(--accent-glow)' : 'var(--bg-primary)',
                  color: theme === 'dark' ? 'var(--accent-primary)' : 'var(--text-primary)',
                  display: 'flex',
                  gap: '8px',
                  justifyContent: 'center',
                }}
              >
                <Moon size={16} />
                <span>Slate Dark</span>
              </button>
              <button
                type="button"
                className={`btn-secondary ${theme === 'light' ? 'active' : ''}`}
                onClick={() => setTheme('light')}
                style={{
                  border: theme === 'light' ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                  backgroundColor: theme === 'light' ? 'var(--accent-glow)' : 'var(--bg-primary)',
                  color: theme === 'light' ? 'var(--accent-primary)' : 'var(--text-primary)',
                  display: 'flex',
                  gap: '8px',
                  justifyContent: 'center',
                }}
              >
                <Sun size={16} />
                <span>Paper Light</span>
              </button>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
              Google API Client ID (for Real Auth)
            </label>
            <input
              type="text"
              placeholder="123456-abcdef.apps.googleusercontent.com"
              value={googleClientId}
              onChange={(e) => setGoogleClientId(e.target.value)}
              className="input-field"
            />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Create a web app Client ID on your Google Developer Console. Leave blank for mock login.
            </span>
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px' }}>GitHub Sync Integration</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  GitHub Personal Access Token (PAT)
                </label>
                <input
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxx"
                  value={githubPat}
                  onChange={(e) => setGithubPat(e.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  GitHub Sync Repository
                </label>
                <input
                  type="text"
                  placeholder="username/lit-reviews"
                  value={githubRepo}
                  onChange={(e) => setGithubRepo(e.target.value)}
                  className="input-field"
                />
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  App will save projects, base64 PDFs, and notes (as Markdown) to this repository.
                </span>
              </div>
            </div>
          </div>

          {/* Sync operations status */}
          {(syncing || syncStatus || syncError) && (
            <div className={`sync-status ${syncError ? 'error' : syncStatus.includes('successfully') ? 'success' : ''}`}>
              {syncing ? <div className="sync-spinner" /> : <RefreshCw size={14} />}
              <div style={{ flex: 1, fontSize: '0.75rem', wordBreak: 'break-word' }}>
                {syncError || syncStatus}
              </div>
            </div>
          )}

          {githubPat && githubRepo && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button
                type="button"
                disabled={syncing}
                onClick={onSyncToGitHub}
                className="btn-secondary"
                style={{ fontSize: '0.8rem', gap: '6px', justifyContent: 'center' }}
              >
                <UploadCloud size={16} />
                <span>Sync to GitHub</span>
              </button>
              <button
                type="button"
                disabled={syncing}
                onClick={onSyncFromGitHub}
                className="btn-secondary"
                style={{ fontSize: '0.8rem', gap: '6px', justifyContent: 'center' }}
              >
                <DownloadCloud size={16} />
                <span>Sync from GitHub</span>
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
            <button type="button" onClick={onClose} className="btn-secondary" style={{ flex: 1 }}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" style={{ flex: 1, gap: '6px' }}>
              <Save size={16} />
              <span>Save & Apply</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
