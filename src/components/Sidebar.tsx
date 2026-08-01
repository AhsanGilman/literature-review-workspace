import React, { useState, useRef } from 'react';
import { db } from '../db';
import type { Project, Paper } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, Upload, Tag, FolderPlus, Settings, FileText, Trash2, Edit3 } from 'lucide-react';
import { parsePdfTitle } from '../pdfParser';
import { isSyncConfigured } from '../github';

interface SidebarProps {
  currentProjectId: string;
  onSelectProject: (id: string) => void;
  selectedPaperId: string;
  onSelectPaper: (id: string) => void;
  onOpenSettings: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentProjectId,
  onSelectProject,
  selectedPaperId,
  onSelectPaper,
  onOpenSettings,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  
  // Modal for new project
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');

  // Form for paper metadata editing when uploading
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [editingPaper, setEditingPaper] = useState<Paper | null>(null);
  const [paperTitle, setPaperTitle] = useState('');
  const [paperAuthors, setPaperAuthors] = useState('');
  const [paperJournal, setPaperJournal] = useState('');
  const [paperYear, setPaperYear] = useState('');
  const [paperTags, setPaperTags] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Selection state for papers (for bulk delete)
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(new Set());

  // Load projects from db
  const projects = useLiveQuery(() => db.projects.toArray()) as Project[] || [];
  
  // Load papers for current project
  const papers = useLiveQuery(
    () => db.papers.where('projectId').equals(currentProjectId).toArray(),
    [currentProjectId]
  ) as Paper[] || [];

  // Get all unique tags for the current project's papers
  const allTags = Array.from(
    new Set(papers.flatMap((paper) => paper.tags || []).filter(Boolean))
  );

  // Filter papers by search and tag
  const filteredPapers = papers.filter((paper) => {
    const matchesSearch =
      paper.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      paper.authors.toLowerCase().includes(searchQuery.toLowerCase()) ||
      paper.journal.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTag = !selectedTag || paper.tags.includes(selectedTag);
    return matchesSearch && matchesTag;
  });

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    const newId = `project-${Date.now()}`;
    await db.projects.add({
      id: newId,
      name: newProjectName.trim(),
      description: newProjectDesc.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    setNewProjectName('');
    setNewProjectDesc('');
    setShowNewProjectModal(false);
    onSelectProject(newId);
  };

  // Convert File to Base64
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (files.length === 1) {
      processFile(files[0]);
    } else {
      await handleMultipleFiles(files);
    }
  };

  const processFile = async (file: File) => {
    if (file.type !== 'application/pdf') return;
    setPendingFile(file);
    // Pre-fill fields: try to detect title automatically from PDF contents
    const detectedTitle = await parsePdfTitle(file, file.name);
    setPaperTitle(detectedTitle);
    setPaperAuthors('');
    setPaperJournal('');
    setPaperYear(new Date().getFullYear().toString());
    setPaperTags('');
  };

  // Process multiple files in batch (no interrupting modals!)
  const handleMultipleFiles = async (files: FileList) => {
    let importedCount = 0;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type !== 'application/pdf') continue;

      try {
        const paperId = `paper-${Date.now()}-${i}`;
        const detectedTitle = await parsePdfTitle(file, file.name);

        // Save paper metadata and content to IndexedDB
        await db.papers.add({
          id: paperId,
          projectId: currentProjectId,
          title: detectedTitle,
          authors: '',
          journal: '',
          year: new Date().getFullYear().toString(),
          tags: [],
          fileData: file, // Save raw file object directly
          fileName: file.name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Save default blank note for this paper
        await db.notes.add({
          id: paperId, // 1-to-1 matching id
          paperId,
          projectId: currentProjectId,
          content: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        importedCount++;
      } catch (err) {
        console.error('Error batch importing file:', file.name, err);
      }
    }

    if (importedCount > 0) {
      // Update project timestamp
      await db.projects.update(currentProjectId, { updatedAt: Date.now() });
      alert(`Successfully imported ${importedCount} papers! You can edit their metadata anytime by clicking the edit icon.`);
    }
  };

  const handleSavePaper = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingFile) return;

    const paperId = `paper-${Date.now()}`;
    const tagsArray = paperTags
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);

    // Save paper metadata and content to IndexedDB
    await db.papers.add({
      id: paperId,
      projectId: currentProjectId,
      title: paperTitle.trim(),
      authors: paperAuthors.trim(),
      journal: paperJournal.trim(),
      year: paperYear.trim(),
      tags: tagsArray,
      fileData: pendingFile, // Save file directly
      fileName: pendingFile.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Save default blank note for this paper
    await db.notes.add({
      id: paperId, // 1-to-1 matching id
      paperId,
      projectId: currentProjectId,
      content: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Update project timestamp
    await db.projects.update(currentProjectId, { updatedAt: Date.now() });

    setPendingFile(null);
    onSelectPaper(paperId);
  };

  const handleSaveEditPaper = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPaper) return;

    const tagsArray = paperTags
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);

    await db.papers.update(editingPaper.id, {
      title: paperTitle.trim(),
      authors: paperAuthors.trim(),
      journal: paperJournal.trim(),
      year: paperYear.trim(),
      tags: tagsArray,
      updatedAt: Date.now(),
    });

    // Update project timestamp
    await db.projects.update(currentProjectId, { updatedAt: Date.now() });
    setEditingPaper(null);
  };

  const handleDeletePaper = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this paper and its notes?')) {
      await db.papers.delete(id);
      await db.notes.delete(id);
      if (selectedPaperId === id) {
        onSelectPaper('');
      }
      // Remove from selection if deleted
      const newSelected = new Set(selectedPaperIds);
      newSelected.delete(id);
      setSelectedPaperIds(newSelected);
    }
  };

  const isAllFilteredSelected = filteredPapers.length > 0 && filteredPapers.every(p => selectedPaperIds.has(p.id));
  
  const handleToggleSelectAll = () => {
    const newSelected = new Set<string>();
    if (!isAllFilteredSelected) {
      // Add all current selected and filtered papers
      selectedPaperIds.forEach(id => newSelected.add(id));
      filteredPapers.forEach(p => newSelected.add(p.id));
    } else {
      // Remove all filtered papers from selection
      selectedPaperIds.forEach(id => newSelected.add(id));
      filteredPapers.forEach(p => newSelected.delete(p.id));
    }
    setSelectedPaperIds(newSelected);
  };

  const handleToggleSelectPaper = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selectedPaperIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedPaperIds(newSelected);
  };

  const handleBulkDelete = async () => {
    const count = selectedPaperIds.size;
    if (count === 0) return;
    if (confirm(`Are you sure you want to delete the ${count} selected paper(s) and their notes?`)) {
      const idsToDelete = Array.from(selectedPaperIds);
      await db.papers.bulkDelete(idsToDelete);
      await db.notes.bulkDelete(idsToDelete);
      
      if (idsToDelete.includes(selectedPaperId)) {
        onSelectPaper('');
      }
      setSelectedPaperIds(new Set());
      await db.projects.update(currentProjectId, { updatedAt: Date.now() });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    if (files.length === 1) {
      processFile(files[0]);
    } else {
      await handleMultipleFiles(files);
    }
  };

  return (
    <aside className="panel sidebar">
      <div>
        {/* Sidebar Header */}
        <div className="panel-header">
          <div className="brand">
            <span>📚</span>
            <span>Litsy</span>
          </div>
          <button onClick={onOpenSettings} className="tool-btn" title="Settings & Sync">
            <Settings size={18} />
          </button>
        </div>

        {/* Project Selector Card */}
        <div style={{ padding: '16px 16px 0 16px' }}>
          <div className="project-selector">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Active Project</span>
              <button onClick={() => setShowNewProjectModal(true)} className="tool-btn" style={{ padding: '2px' }} title="New Project">
                <FolderPlus size={16} />
              </button>
            </div>
            <div className="select-wrapper">
              <select
                value={currentProjectId}
                onChange={(e) => onSelectProject(e.target.value)}
                className="custom-select"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!isSyncConfigured() && (
            <div style={{
              fontSize: '0.75rem',
              color: '#d19a66',
              backgroundColor: 'rgba(209, 154, 102, 0.08)',
              border: '1px solid rgba(209, 154, 102, 0.25)',
              borderRadius: 'var(--radius-md)',
              padding: '8px 12px',
              marginBottom: '14px',
              lineHeight: '1.4',
            }}>
              ⚠️ <strong>Sync Disabled</strong>
              <div style={{ marginTop: '2px', color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
                GitHub Token is not configured. Data is saved in this browser only.
              </div>
            </div>
          )}

          {/* Search bar */}
          <div style={{ position: 'relative', marginBottom: '12px' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search papers, authors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field"
              style={{ paddingLeft: '34px', marginBottom: 0 }}
            />
          </div>

          {/* Tags cloud */}
          {allTags.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                <Tag size={12} />
                <span>Filter by Tag</span>
              </div>
              <div className="tag-list">
                <span
                  onClick={() => setSelectedTag(null)}
                  className={`badge ${!selectedTag ? 'active' : ''}`}
                  style={{
                    cursor: 'pointer',
                    opacity: !selectedTag ? 1 : 0.6,
                    backgroundColor: !selectedTag ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                    color: !selectedTag ? 'white' : 'var(--text-primary)',
                  }}
                >
                  All
                </span>
                {allTags.map((tag) => (
                  <span
                    key={tag}
                    onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                    className={`badge ${selectedTag === tag ? 'active' : ''}`}
                    style={{
                      cursor: 'pointer',
                      opacity: selectedTag === tag ? 1 : 0.6,
                      backgroundColor: selectedTag === tag ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                      color: selectedTag === tag ? 'white' : 'var(--text-primary)',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Paper List Content */}
      <div className="panel-content" style={{ padding: '0 16px 16px 16px', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input 
              type="checkbox" 
              checked={isAllFilteredSelected} 
              onChange={handleToggleSelectAll}
              style={{ cursor: 'pointer' }}
              title="Select All"
            />
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Papers ({filteredPapers.length})</span>
          </div>
          {selectedPaperIds.size > 0 && (
            <button 
              onClick={handleBulkDelete}
              className="tool-btn"
              style={{ color: 'var(--danger)', fontSize: '0.75rem', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 'var(--radius-sm)' }}
            >
              <Trash2 size={12} />
              <span>Delete ({selectedPaperIds.size})</span>
            </button>
          )}
        </div>

        {/* Drag & Drop Upload Zone */}
        <div
          className="upload-zone"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="upload-icon" size={24} />
          <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>Drop PDFs here or click</div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Multiple PDFs supported</div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="application/pdf"
            style={{ display: 'none' }}
            multiple
          />
        </div>

        {/* File list */}
        {filteredPapers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            No papers found. Drag & drop PDFs to add.
          </div>
        ) : (
          filteredPapers.map((paper) => (
            <div
              key={paper.id}
              className={`paper-item ${selectedPaperId === paper.id ? 'active' : ''}`}
              onClick={() => onSelectPaper(paper.id)}
              style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
            >
              <input
                type="checkbox"
                checked={selectedPaperIds.has(paper.id)}
                onChange={() => {}}
                onClick={(e) => handleToggleSelectPaper(paper.id, e)}
                style={{ cursor: 'pointer', flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div className="paper-title">{paper.fileName || paper.title}</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingPaper(paper);
                        setPaperTitle(paper.title);
                        setPaperAuthors(paper.authors);
                        setPaperJournal(paper.journal);
                        setPaperYear(paper.year);
                        setPaperTags(paper.tags.join(', '));
                      }}
                      className="tool-btn"
                      style={{ padding: '2px', color: 'var(--text-muted)' }}
                      title="Edit Paper Details"
                    >
                      <Edit3 size={13} />
                    </button>
                    <button
                      onClick={(e) => handleDeletePaper(paper.id, e)}
                      className="tool-btn"
                      style={{ padding: '2px', color: 'var(--text-muted)' }}
                      title="Delete Paper"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* New Project Modal */}
      {showNewProjectModal && (
        <div className="modal-overlay" onClick={() => setShowNewProjectModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '24px' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.4rem', marginBottom: '16px' }}>Create New Project</h3>
            <form onSubmit={handleCreateProject}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>Project Name</label>
                <input
                  type="text"
                  placeholder="e.g. Deep Learning in NLP"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="input-field"
                  required
                />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>Description</label>
                <textarea
                  placeholder="Describe your research project goals..."
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  className="input-field"
                  style={{ height: '80px', resize: 'none' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" onClick={() => setShowNewProjectModal(false)} className="btn-secondary" style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Paper Import Form Modal (to configure metadata when uploading a new file) */}
      {pendingFile && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ padding: '24px' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.3rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText size={20} className="upload-icon" /> Import Paper Details
            </h3>
            <form onSubmit={handleSavePaper} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>Document Title</label>
                <input
                  type="text"
                  value={paperTitle}
                  onChange={(e) => setPaperTitle(e.target.value)}
                  className="input-field"
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>Authors (comma separated)</label>
                <input
                  type="text"
                  placeholder="e.g. Bengio Y., LeCun Y., Hinton G."
                  value={paperAuthors}
                  onChange={(e) => setPaperAuthors(e.target.value)}
                  className="input-field"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>Journal / Conference</label>
                  <input
                    type="text"
                    placeholder="e.g. NeurIPS"
                    value={paperJournal}
                    onChange={(e) => setPaperJournal(e.target.value)}
                    className="input-field"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>Year</label>
                  <input
                    type="text"
                    placeholder="e.g. 2024"
                    value={paperYear}
                    onChange={(e) => setPaperYear(e.target.value)}
                    className="input-field"
                  />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>Tags (comma separated)</label>
                <input
                  type="text"
                  placeholder="e.g. NLP, transformer, attention"
                  value={paperTags}
                  onChange={(e) => setPaperTags(e.target.value)}
                  className="input-field"
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="button" onClick={() => setPendingFile(null)} className="btn-secondary" style={{ flex: 1 }}>
                  Discard
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>
                  Import & Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Paper Edit Form Modal */}
      {editingPaper && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ padding: '24px' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.3rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText size={20} className="upload-icon" /> Edit Paper Details
            </h3>
            <form onSubmit={handleSaveEditPaper} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>Document Title</label>
                <input
                  type="text"
                  value={paperTitle}
                  onChange={(e) => setPaperTitle(e.target.value)}
                  className="input-field"
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>Authors (comma separated)</label>
                <input
                  type="text"
                  placeholder="e.g. Bengio Y., LeCun Y., Hinton G."
                  value={paperAuthors}
                  onChange={(e) => setPaperAuthors(e.target.value)}
                  className="input-field"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>Journal / Conference</label>
                  <input
                    type="text"
                    placeholder="e.g. NeurIPS"
                    value={paperJournal}
                    onChange={(e) => setPaperJournal(e.target.value)}
                    className="input-field"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>Year</label>
                  <input
                    type="text"
                    placeholder="e.g. 2024"
                    value={paperYear}
                    onChange={(e) => setPaperYear(e.target.value)}
                    className="input-field"
                  />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>Tags (comma separated)</label>
                <input
                  type="text"
                  placeholder="e.g. NLP, transformer, attention"
                  value={paperTags}
                  onChange={(e) => setPaperTags(e.target.value)}
                  className="input-field"
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="button" onClick={() => setEditingPaper(null)} className="btn-secondary" style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
};
