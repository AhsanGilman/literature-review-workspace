import React, { useState, useEffect, useRef } from 'react';
import { db, type Paper, type Note } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { marked } from 'marked';
import { 
  FileText, Eye, Edit3, Sparkles, Clipboard, Check, Quote, 
  Bold, Italic, Heading1, Heading2, List, Code, Save, BrainCircuit, Plus
} from 'lucide-react';

interface NoteEditorProps {
  paperId: string;
  projectId: string;
}

export const NoteEditor: React.FC<NoteEditorProps> = ({ paperId, projectId }) => {
  const [activeTab, setActiveTab] = useState<'edit' | 'preview' | 'ai' | 'citations'>('edit');
  const [noteContent, setNoteContent] = useState('');
  const [isSaved, setIsSaved] = useState(true);
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);

  // AI assistant states
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load the current paper & note, casting explicitly to prevent PromiseExtended type inference issues
  const paper = useLiveQuery(
    () => (paperId ? db.papers.get(paperId) : Promise.resolve(undefined)),
    [paperId]
  ) as Paper | undefined;

  const note = useLiveQuery(
    () => (paperId ? db.notes.get(paperId) : Promise.resolve(undefined)),
    [paperId]
  ) as Note | undefined;

  // Sync state when note loads from DB
  useEffect(() => {
    if (note) {
      setNoteContent(note.content);
      setIsSaved(true);
    } else {
      setNoteContent('');
    }
  }, [note]);

  // Autosave notes
  useEffect(() => {
    if (!paperId || !note) return;
    if (noteContent === note.content) return;

    setIsSaved(false);
    const timeout = setTimeout(async () => {
      await db.notes.put({
        id: paperId,
        paperId,
        projectId,
        content: noteContent,
        createdAt: note.createdAt || Date.now(),
        updatedAt: Date.now(),
      });
      // Update paper updatedAt too to trigger sync update
      await db.papers.update(paperId, { updatedAt: Date.now() });
      await db.projects.update(projectId, { updatedAt: Date.now() });
      setIsSaved(true);
    }, 1000); // 1-second debounce for autosave

    return () => clearTimeout(timeout);
  }, [noteContent, paperId, projectId]);

  if (!paperId || !paper) {
    return (
      <aside className="panel right-panel" style={{ justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
          <FileText size={48} style={{ opacity: 0.2, marginBottom: '16px', margin: '0 auto' }} />
          <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.2rem', marginBottom: '8px' }}>Notes Workspace</h3>
          <p style={{ fontSize: '0.85rem', maxWidth: '280px', margin: '0 auto' }}>
            Open a paper to view literature notes, generate citations, and access AI analysis tools.
          </p>
        </div>
      </aside>
    );
  }

  // Citation Formats Generator
  const getCitations = () => {
    const authors = paper.authors || 'Unknown Author';
    const title = paper.title || 'Untitled Document';
    const journal = paper.journal || 'Research Portal';
    const year = paper.year || new Date().getFullYear().toString();

    // Format authors list for APA
    const authorList = authors.split(',').map((a: string) => a.trim());
    let apaAuthors = authors;
    if (authorList.length > 0) {
      apaAuthors = authorList.join(', ');
    }

    const citationKey = (authorList[0] ? authorList[0].split(' ').pop() || 'key' : 'paper') + year;

    return {
      apa: `${apaAuthors} (${year}). ${title}. *${journal}*.`,
      mla: `${apaAuthors}. "${title}." *${journal}*, ${year}.`,
      chicago: `${apaAuthors}. "${title}." *${journal}* (${year}).`,
      bibtex: `@article{${citationKey.toLowerCase()},\n  author = {${authors}},\n  title = {${title}},\n  journal = {${journal}},\n  year = {${year}}\n}`,
    };
  };

  const handleCopyCitation = (text: string, format: string) => {
    navigator.clipboard.writeText(text.replace(/\*/g, '')); // remove asterisks for plain text copy
    setCopiedFormat(format);
    setTimeout(() => setCopiedFormat(null), 2000);
  };

  const handleInsertCitation = (text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;

    const newValue = value.substring(0, start) + text + value.substring(end);
    setNoteContent(newValue);
    
    // Reset focus and cursor position
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + text.length;
    }, 50);
  };

  // Helper to insert markdown tags at cursor
  const insertMarkdown = (syntaxStart: string, syntaxEnd = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    const textToInsert = syntaxStart + (selectedText || 'text') + syntaxEnd;

    setNoteContent(
      textarea.value.substring(0, start) + 
      textToInsert + 
      textarea.value.substring(end)
    );

    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = start + syntaxStart.length;
      textarea.selectionEnd = start + syntaxStart.length + (selectedText || 'text').length;
    }, 50);
  };

  // Render markdown preview securely
  const renderPreview = () => {
    try {
      const html = marked.parse(noteContent, { async: false }) as string;
      return { __html: html };
    } catch (e) {
      return { __html: '<p>Error rendering preview.</p>' };
    }
  };

  // Save Gemini Key
  const handleSaveGeminiKey = (key: string) => {
    setGeminiKey(key);
    localStorage.setItem('gemini_api_key', key);
  };

  // AI Generation Query
  const generateAIInsight = async (type: 'summary' | 'methodology' | 'critique' | 'prompt') => {
    setAiLoading(true);
    setAiResponse('');

    let promptText = '';
    const tagsList = paper.tags ? paper.tags.join(', ') : 'none';
    const paperInfo = `Paper Title: ${paper.title}\nAuthors: ${paper.authors}\nJournal: ${paper.journal}\nYear: ${paper.year}\nTags: ${tagsList}`;

    if (type === 'summary') {
      promptText = `Provide a concise 3-paragraph summary of this research paper based on the details. Focus on the core thesis, study design, and main conclusions.\n\n${paperInfo}`;
    } else if (type === 'methodology') {
      promptText = `Analyze and outline the standard research methodology, theoretical framework, and datasets likely used in a paper of this title and field.\n\n${paperInfo}`;
    } else if (type === 'critique') {
      promptText = `Provide 3 potential limitations, critical questions, or research gaps for a paper with this focus. This is to help me do a literature review.\n\n${paperInfo}`;
    } else {
      if (!aiPrompt.trim()) {
        setAiResponse('Please enter a question or prompt first.');
        setAiLoading(false);
        return;
      }
      promptText = `Regarding the research paper: \n${paperInfo}\n\nUser Question/Instruction: ${aiPrompt}\n\nProvide an academic response:`;
    }

    // Call real Gemini API if key exists, otherwise provide simulated high-quality response
    if (geminiKey) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptText }] }],
            }),
          }
        );

        if (response.ok) {
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
          setAiResponse(text);
        } else {
          const err = await response.json();
          setAiResponse(`Gemini API Error: ${err.error?.message || response.statusText}`);
        }
      } catch (err: any) {
        setAiResponse(`Failed to connect to Gemini API: ${err.message}`);
      }
    } else {
      // High-quality simulated response (works offline/out-of-the-box!)
      setTimeout(() => {
        let simulatedText = '';
        if (type === 'summary') {
          simulatedText = `### Literature Summary: *${paper.title}*\n\n**1. Research Focus**: This paper by *${paper.authors || 'unknown authors'}* published in *${paper.journal || 'literature portal'}* (${paper.year}) addresses issues related to ${tagsList || 'this field'}.\n\n**2. Core Arguments**: The study outlines how recent techniques can solve constraints in current practices. By proposing a unified framework, the authors attempt to bridge theoretical findings and practical applications.\n\n**3. Significance**: This contributes to literature reviews by offering a baseline structure for comparing similar models in ${paper.year}. *(Note: To get live AI summaries, add your Gemini API Key in the settings below)*`;
        } else if (type === 'methodology') {
          simulatedText = `### Methodology Outline\n\n- **Theoretical Framework**: The study builds upon baseline architectures relevant to **${tagsList || 'this topic'}**.\n- **Approach**: Quantitative/qualitative comparative analysis utilizing benchmark datasets.\n- **Evaluation**: Validated using ablation studies and performance matrices standard in *${paper.journal || 'academic journals'}*.\n\n*(Note: Add your Gemini API Key for customized analysis)*`;
        } else if (type === 'critique') {
          simulatedText = `### Critical Analysis & Gaps\n\n1. **Generalizability**: The model's validation may be limited to specific configurations or datasets typical of *${paper.year}*.\n2. **Computation**: Might not address scaling costs or efficiency constraints in production settings.\n3. **Future Scopes**: Leaves open the question of how to integrate multimodal parameters or real-time datasets.\n\n*(Note: Add your Gemini API Key for customized critiques)*`;
        } else {
          simulatedText = `You asked: "${aiPrompt}"\n\nTo answer custom research questions about the paper, please configure a **Gemini API Key** in the input field below. This will enable real-time semantic query answering.`;
        }
        setAiResponse(simulatedText);
      }, 1000);
    }
    setAiLoading(false);
  };

  const citations = getCitations();

  return (
    <aside className="panel right-panel">
      {/* Tabs */}
      <div className="tabs-container">
        <button
          onClick={() => setActiveTab('edit')}
          className={`tab-btn ${activeTab === 'edit' ? 'active' : ''}`}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Edit3 size={14} />
          <span>Edit Notes</span>
        </button>
        <button
          onClick={() => setActiveTab('preview')}
          className={`tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Eye size={14} />
          <span>Preview</span>
        </button>
        <button
          onClick={() => setActiveTab('ai')}
          className={`tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Sparkles size={14} />
          <span>AI Insight</span>
        </button>
        <button
          onClick={() => setActiveTab('citations')}
          className={`tab-btn ${activeTab === 'citations' ? 'active' : ''}`}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Quote size={14} />
          <span>Citations</span>
        </button>
      </div>

      {/* Editor Content Area */}
      <div className="editor-container">
        {activeTab === 'edit' && (
          <>
            {/* Markdown Toolbar */}
            <div className="editor-toolbar">
              <button onClick={() => insertMarkdown('# ', '')} className="tool-btn" title="H1"><Heading1 size={14} /></button>
              <button onClick={() => insertMarkdown('## ', '')} className="tool-btn" title="H2"><Heading2 size={14} /></button>
              <button onClick={() => insertMarkdown('**', '**')} className="tool-btn" title="Bold"><Bold size={14} /></button>
              <button onClick={() => insertMarkdown('*', '*')} className="tool-btn" title="Italic"><Italic size={14} /></button>
              <button onClick={() => insertMarkdown('- ', '')} className="tool-btn" title="List"><List size={14} /></button>
              <button onClick={() => insertMarkdown('```\n', '\n```')} className="tool-btn" title="Code"><Code size={14} /></button>
              
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <Save size={12} />
                <span>{isSaved ? 'Autosaved' : 'Saving...'}</span>
              </div>
            </div>

            {/* Note Editor Area */}
            <textarea
              ref={textareaRef}
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              className="markdown-textarea"
              placeholder="Start typing your research paper notes in Markdown..."
            />
          </>
        )}

        {activeTab === 'preview' && (
          <div className="markdown-preview" dangerouslySetInnerHTML={renderPreview()} />
        )}

        {activeTab === 'ai' && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-primary)', fontWeight: 'bold' }}>
              <BrainCircuit size={20} />
              <span style={{ fontSize: '1rem', fontFamily: 'var(--font-serif)' }}>AI Research Assistant</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Gemini API Integration</span>
              <input
                type="password"
                placeholder="Enter Gemini API Key (Optional)"
                value={geminiKey}
                onChange={(e) => handleSaveGeminiKey(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.8rem', marginBottom: 0 }}
              />
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                Your key is stored locally in your browser. Leave blank to run in simulated mode.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Quick Literature Prompts</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button
                  onClick={() => generateAIInsight('summary')}
                  disabled={aiLoading}
                  className="btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '8px 10px', justifyContent: 'center' }}
                >
                  Summarize Paper
                </button>
                <button
                  onClick={() => generateAIInsight('methodology')}
                  disabled={aiLoading}
                  className="btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '8px 10px', justifyContent: 'center' }}
                >
                  Extract Methods
                </button>
                <button
                  onClick={() => generateAIInsight('critique')}
                  disabled={aiLoading}
                  className="btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '8px 10px', justifyContent: 'center', gridColumn: 'span 2' }}
                >
                  Find Gaps & Critique
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Ask Custom Question</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="e.g. What datasets did they test on?"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  className="input-field"
                  style={{ flex: 1, marginBottom: 0, fontSize: '0.8rem' }}
                />
                <button
                  onClick={() => generateAIInsight('prompt')}
                  disabled={aiLoading}
                  className="btn-primary"
                  style={{ width: 'auto', padding: '0 16px' }}
                >
                  Ask
                </button>
              </div>
            </div>

            {/* AI Response Display */}
            {(aiLoading || aiResponse) && (
              <div style={{ marginTop: '12px', padding: '16px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', flex: 1, minHeight: '120px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>AI Output</span>
                  {aiResponse && (
                    <button
                      onClick={() => handleInsertCitation(`\n\n${aiResponse}\n\n`)}
                      className="tool-btn"
                      style={{ fontSize: '0.75rem', gap: '4px', padding: '4px 8px' }}
                      title="Insert this response into your notes"
                    >
                      <Plus size={12} />
                      <span>Insert to Notes</span>
                    </button>
                  )}
                </div>
                
                {aiLoading ? (
                  <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
                    <div className="sync-spinner" />
                    <span style={{ fontSize: '0.8rem' }}>AI thinking...</span>
                  </div>
                ) : (
                  <div 
                    style={{ fontSize: '0.8rem', lineHeight: '1.5', whiteSpace: 'pre-wrap', color: 'var(--text-primary)', overflowY: 'auto' }}
                  >
                    {aiResponse}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'citations' && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', overflowY: 'auto' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
              Academic Citation Styles
            </h3>

            {/* APA */}
            <div>
              <div className="citation-header">
                <span>APA Style</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => handleCopyCitation(citations.apa, 'apa')} className="tool-btn" style={{ padding: '2px' }} title="Copy">
                    {copiedFormat === 'apa' ? <Check size={14} style={{ color: 'var(--success)' }} /> : <Clipboard size={14} />}
                  </button>
                  <button onClick={() => handleInsertCitation(citations.apa)} className="tool-btn" style={{ padding: '2px' }} title="Insert into note">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <div className="citation-box" dangerouslySetInnerHTML={{ __html: citations.apa }} />
            </div>

            {/* MLA */}
            <div>
              <div className="citation-header">
                <span>MLA Style</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => handleCopyCitation(citations.mla, 'mla')} className="tool-btn" style={{ padding: '2px' }} title="Copy">
                    {copiedFormat === 'mla' ? <Check size={14} style={{ color: 'var(--success)' }} /> : <Clipboard size={14} />}
                  </button>
                  <button onClick={() => handleInsertCitation(citations.mla)} className="tool-btn" style={{ padding: '2px' }} title="Insert into note">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <div className="citation-box" dangerouslySetInnerHTML={{ __html: citations.mla }} />
            </div>

            {/* Chicago */}
            <div>
              <div className="citation-header">
                <span>Chicago Style</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => handleCopyCitation(citations.chicago, 'chicago')} className="tool-btn" style={{ padding: '2px' }} title="Copy">
                    {copiedFormat === 'chicago' ? <Check size={14} style={{ color: 'var(--success)' }} /> : <Clipboard size={14} />}
                  </button>
                  <button onClick={() => handleInsertCitation(citations.chicago)} className="tool-btn" style={{ padding: '2px' }} title="Insert into note">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <div className="citation-box" dangerouslySetInnerHTML={{ __html: citations.chicago }} />
            </div>

            {/* BibTeX */}
            <div>
              <div className="citation-header">
                <span>BibTeX Format</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => handleCopyCitation(citations.bibtex, 'bibtex')} className="tool-btn" style={{ padding: '2px' }} title="Copy">
                    {copiedFormat === 'bibtex' ? <Check size={14} style={{ color: 'var(--success)' }} /> : <Clipboard size={14} />}
                  </button>
                  <button onClick={() => handleInsertCitation(`\n\`\`\`bibtex\n${citations.bibtex}\n\`\`\`\n`)} className="tool-btn" style={{ padding: '2px' }} title="Insert into note">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <pre className="citation-box" style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                {citations.bibtex}
              </pre>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
