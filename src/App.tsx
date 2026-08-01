import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { PDFReader } from './components/PDFReader';
import { NoteEditor } from './components/NoteEditor';
import { SettingsModal } from './components/SettingsModal';
import { Login } from './components/Login';
import { syncToGitHub, syncFromGitHub } from './github';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';

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

  // Panel Width States (persisted)
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const saved = localStorage.getItem('litsy_left_width');
    return saved ? parseInt(saved, 10) : 280;
  });
  const [rightWidth, setRightWidth] = useState<number>(() => {
    const saved = localStorage.getItem('litsy_right_width');
    return saved ? parseInt(saved, 10) : 400;
  });

  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);

  const startResizeLeft = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingLeft(true);
  };

  const startResizeRight = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingRight(true);
  };

  useEffect(() => {
    localStorage.setItem('litsy_left_width', leftWidth.toString());
  }, [leftWidth]);

  useEffect(() => {
    localStorage.setItem('litsy_right_width', rightWidth.toString());
  }, [rightWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingLeft) {
        const newWidth = Math.max(200, Math.min(500, e.clientX));
        setLeftWidth(newWidth);
      } else if (isResizingRight) {
        const newWidth = Math.max(250, Math.min(600, window.innerWidth - e.clientX));
        setRightWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
      setIsResizingRight(false);
    };

    if (isResizingLeft || isResizingRight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingLeft, isResizingRight]);

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

  // Max updatedAt reactive query to trigger background sync
  const lastUpdated = useLiveQuery(async () => {
    const proj = await db.projects.toArray();
    const papers = await db.papers.toArray();
    const notes = await db.notes.toArray();
    
    const maxProj = proj.length > 0 ? Math.max(...proj.map(p => p.updatedAt)) : 0;
    const maxPapers = papers.length > 0 ? Math.max(...papers.map(p => p.updatedAt)) : 0;
    const maxNotes = notes.length > 0 ? Math.max(...notes.map(n => n.updatedAt)) : 0;
    
    return Math.max(maxProj, maxPapers, maxNotes);
  });

  const isSyncingRef = useRef(false);

  const silentSyncToGitHub = async (email: string) => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    try {
      await syncToGitHub(email);
    } catch (e) {
      console.warn('Background sync failed:', e);
    } finally {
      isSyncingRef.current = false;
    }
  };

  // Debounced auto-save to cloud repository
  useEffect(() => {
    if (!user || !lastUpdated) return;

    const timer = setTimeout(() => {
      silentSyncToGitHub(user.email);
    }, 4000);

    return () => clearTimeout(timer);
  }, [lastUpdated, user]);

  // Pull data from repository automatically on mount (app load)
  useEffect(() => {
    if (user) {
      handleSyncFromGitHub(user.email);
    }
  }, []);

  const handleLoginSuccess = (loggedInUser: User) => {
    setUser(loggedInUser);
    handleSyncFromGitHub(loggedInUser.email);
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



  const handleSyncFromGitHub = async (email: string) => {
    setSyncing(true);
    setSyncError('');
    setSyncStatus('Starting download from GitHub...');
    try {
      await syncFromGitHub(email, (msg) => {
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
    <div 
      className="dashboard" 
      style={{ gridTemplateColumns: `${leftWidth}px 4px 1fr 4px ${rightWidth}px` }}
    >
      {/* Panel 1: Navigation & Papers (Left) */}
      <Sidebar
        currentProjectId={currentProjectId}
        onSelectProject={setCurrentProjectId}
        selectedPaperId={selectedPaperId}
        onSelectPaper={setSelectedPaperId}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Resize Handle 1 (Left-Middle) */}
      <div 
        className={`resize-handle ${isResizingLeft ? 'active' : ''}`} 
        onMouseDown={startResizeLeft}
      />

      {/* Panel 2: PDF Reader (Middle) */}
      <PDFReader paperId={selectedPaperId} />

      {/* Resize Handle 2 (Middle-Right) */}
      <div 
        className={`resize-handle ${isResizingRight ? 'active' : ''}`} 
        onMouseDown={startResizeRight}
      />

      {/* Panel 3: Notes Workspace (Right) */}
      <NoteEditor paperId={selectedPaperId} projectId={currentProjectId} />

      {/* Settings Dialog Overlay */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
        syncing={syncing}
        syncStatus={syncStatus}
        syncError={syncError}
        user={user}
        onLogout={handleLogout}
      />
    </div>
  );
};
