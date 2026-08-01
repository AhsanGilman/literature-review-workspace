import React, { useState, useEffect } from 'react';
import { BookOpen, ShieldAlert, Cpu } from 'lucide-react';

// Declare google on window for GIS library
declare global {
  interface Window {
    google?: any;
  }
}

interface LoginProps {
  onLoginSuccess: (user: { email: string; name: string; picture: string }) => void;
  clientId: string;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess, clientId }) => {
  const [mockEmail, setMockEmail] = useState('');
  const [error, setError] = useState('');

  // Initializing Google Sign-In if a Client ID is provided
  useEffect(() => {
    if (!clientId) return;

    const initializeGoogleSignIn = () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleGoogleCredentialResponse,
        });
        window.google.accounts.id.renderButton(
          document.getElementById('google-signin-btn'),
          { theme: 'outline', size: 'large', width: '300' }
        );
      }
    };

    // Retry a few times if the script load is slightly delayed
    const timer = setTimeout(initializeGoogleSignIn, 500);
    return () => clearTimeout(timer);
  }, [clientId]);

  // Decode Google JWT token client-side
  const handleGoogleCredentialResponse = (response: any) => {
    try {
      const base64Url = response.credential.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      const payload = JSON.parse(jsonPayload);

      if (payload.email) {
        onLoginSuccess({
          email: payload.email,
          name: payload.name || payload.email.split('@')[0],
          picture: payload.picture || '',
        });
      } else {
        setError('Failed to extract email from Google Sign-In.');
      }
    } catch (e) {
      console.error(e);
      setError('An error occurred during Google Sign-In.');
    }
  };

  const handleMockLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mockEmail || !mockEmail.includes('@')) {
      setError('Please enter a valid Gmail / Email address.');
      return;
    }
    onLoginSuccess({
      email: mockEmail.trim(),
      name: mockEmail.split('@')[0],
      picture: `https://api.dicebear.com/7.x/bottts/svg?seed=${mockEmail}`,
    });
  };

  return (
    <div className="login-overlay">
      <div className="login-card">
        <div className="logo-large">📚</div>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '2.2rem', marginBottom: '8px' }}>Litsy</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', fontSize: '0.95rem' }}>
          Your Decentralized Literature Review Workspace
        </p>

        {error && (
          <div className="sync-status error" style={{ width: '100%' }}>
            <ShieldAlert size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* If Google Client ID is configured, show Google sign-in */}
        {clientId ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
            <div id="google-signin-btn" style={{ marginBottom: '20px' }}></div>
            <div style={{ margin: '12px 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>OR BYPASS WITH LOCAL DEV AUTH</div>
          </div>
        ) : (
          <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(255,255,255,0.02)', width: '100%', marginBottom: '24px', fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'left' }}>
            <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', color: 'var(--text-primary)' }}>
              <Cpu size={14} className="upload-icon" /> Local Developer Auth Active
            </div>
            You can sign in immediately using any email. To use real Google Sign-In, configure a Google Client ID in settings after logging in.
          </div>
        )}

        <form onSubmit={handleMockLogin} style={{ width: '100%' }}>
          <input
            type="email"
            placeholder="enter.your.gmail@gmail.com"
            value={mockEmail}
            onChange={(e) => setMockEmail(e.target.value)}
            className="input-field"
            style={{ textAlign: 'center' }}
            required
          />
          <button type="submit" className="btn-primary">
            <BookOpen size={18} />
            <span>Sign In with Email</span>
          </button>
        </form>

        <div style={{ marginTop: '32px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          All files and notes are stored locally in your browser's IndexedDB and synced to your own GitHub repository. No password required.
        </div>
      </div>
    </div>
  );
};
