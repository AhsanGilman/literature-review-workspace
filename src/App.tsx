import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { PDFReader } from './components/PDFReader';
import { NoteEditor } from './components/NoteEditor';
import { SettingsModal } from './components/SettingsModal';
import { Login } from './components/Login';
import { syncToGitHub, syncFromGitHub } from './github';
import { db } from './db';

interface User {
  email: string;
  name: string;
  picture: string;
}

interface Settings {
  googleClientId: string;
  githubPat: string;
  githubRepo: string;
  theme: 'dark' | 'light';
}

const DEFAULT_SETTINGS: Settings = {
  googleClientId: '',
  githubPat: '',
  githubRepo: '',
  theme: 'dark',
};

export const App: React.FC = () => {
  // Authentication State
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('litsy_user');
    return saved ? JSON.parse(saved) : null;
  });

  // Settings State
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = localStorage.getItem('litsy_settings');
    return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
  });

  // UI Selection State
  const [currentProjectId, setCurrentProjectId] = useState<string>(() => {
    return localStorage.getItem('litsy_current_project_id') || 'default-project';
  });
  const [selectedPaperId, setSelectedPaperId] = useState<string>('');
  
  // Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Sync Progress States
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [syncError, setSyncError] = useState('');

  // Apply theme to body
  useEffect(() => {
    document.body.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  // Sync state to local storage
  useEffect(() => {
    localStorage.setItem('litsy_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (user) {
      localStorage.setItem('litsy_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('litsy_user');
    }
  }, [user]);

  useEffect(() => {
    localStorage.setItem('litsy_current_project_id', currentProjectId);
    setSelectedPaperId(''); // clear selection on project switch
  }, [currentProjectId]);

  const handleLoginSuccess = (loggedInUser: User) => {
    setUser(loggedInUser);
    // If they have GitHub credentials already saved in this browser, try to auto-sync
    if (settings.githubPat && settings.githubRepo) {
      handleSyncFromGitHub();
    }
  };

  const handleLogout = () => {
    if (confirm('Are you sure you want to log out? Local data will remain in this browser.')) {
      setUser(null);
      setSelectedPaperId('');
    }
  };

  const handleSaveSettings = (newSettings: Settings) => {
    setSettings(newSettings);
  };

  const handleSyncToGitHub = async () => {
    if (!settings.githubPat || !settings.githubRepo) {
      setSyncError('Please configure GitHub Token and Repository first.');
      return;
    }
    setSyncing(true);
    setSyncError('');
    setSyncStatus('Starting upload to GitHub...');
    try {
      await syncToGitHub(settings.githubPat, settings.githubRepo, (msg) => {
        setSyncStatus(msg);
      });
    } catch (err: any) {
      console.error(err);
      setSyncError(err.message || 'An error occurred during sync.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncFromGitHub = async () => {
    if (!settings.githubPat || !settings.githubRepo) {
      setSyncError('Please configure GitHub Token and Repository first.');
      return;
    }
    setSyncing(true);
    setSyncError('');
    setSyncStatus('Starting download from GitHub...');
    try {
      await syncFromGitHub(settings.githubPat, settings.githubRepo, (msg) => {
        setSyncStatus(msg);
      });
      // Force database reload / update UI
      const projects = await db.projects.toArray();
      if (projects.length > 0) {
        // If current project is no longer valid, switch to first available
        if (!projects.some(p => p.id === currentProjectId)) {
          setCurrentProjectId(projects[0].id);
        }
      }
    } catch (err: any) {
      console.error(err);
      setSyncError(err.message || 'An error occurred during sync.');
    } finally {
      setSyncing(false);
    }
  };

  // If user is not logged in, render the login screen
  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} clientId={settings.googleClientId} />;
  }

  return (
    <div className="dashboard">
      {/* Panel 1: Navigation & Papers (Left) */}
      <Sidebar
        currentProjectId={currentProjectId}
        onSelectProject={setCurrentProjectId}
        selectedPaperId={selectedPaperId}
        onSelectPaper={setSelectedPaperId}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Panel 2: PDF Reader (Middle) */}
      <PDFReader paperId={selectedPaperId} />

      {/* Panel 3: Notes Workspace (Right) */}
      <NoteEditor paperId={selectedPaperId} projectId={currentProjectId} />

      {/* Settings Dialog Overlay */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
        onSyncToGitHub={handleSyncToGitHub}
        onSyncFromGitHub={handleSyncFromGitHub}
        syncing={syncing}
        syncStatus={syncStatus}
        syncError={syncError}
        user={user}
        onLogout={handleLogout}
      />
    </div>
  );
};
