import React, { useEffect, useState } from 'react';
import { db, type Paper } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Loader2 } from 'lucide-react';
import { parsePdfTitle } from '../pdfParser';

interface PDFReaderProps {
  paperId: string;
}

export const PDFReader: React.FC<PDFReaderProps> = ({ paperId }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load the selected paper and cast it to prevent PromiseExtended type issues
  const paper = useLiveQuery(
    () => (paperId ? db.papers.get(paperId) : Promise.resolve(undefined)),
    [paperId]
  ) as Paper | undefined;

  useEffect(() => {
    if (!paperId) {
      setBlobUrl(null);
      return;
    }

    setLoading(true);
    let url = '';
    let isCancelled = false;

    db.papers.get(paperId).then((paperData) => {
      if (!paperData) {
        if (!isCancelled) setLoading(false);
        return;
      }
      if (isCancelled) return;

      try {
        let fileBlob: Blob;
        if (typeof paperData.fileData === 'string') {
          // Decode base64 to Blob for old uploads
          const base64Data = (paperData.fileData as string).includes(',')
            ? (paperData.fileData as string).split(',')[1]
            : (paperData.fileData as string);
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          fileBlob = new Blob([byteArray], { type: 'application/pdf' });
        } else {
          fileBlob = paperData.fileData;
        }
        
        const generatedUrl = URL.createObjectURL(fileBlob);
        if (isCancelled) {
          URL.revokeObjectURL(generatedUrl);
          return;
        }
        url = generatedUrl;
        setBlobUrl(url);
      } catch (error) {
        console.error('Error generating PDF Blob URL:', error);
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    });

    return () => {
      isCancelled = true;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [paperId]);

  // Self-healing title update: If the paper has a generic title (ends in .pdf, matches fileName, or is a short number), re-parse it
  useEffect(() => {
    if (!paper) return;

    const currentTitle = (paper.title || '').trim();
    const isGeneric = 
      currentTitle === paper.fileName || 
      currentTitle.toLowerCase().endsWith('.pdf') ||
      /^\d+$/.test(currentTitle) ||
      currentTitle.length <= 15 ||
      currentTitle.toLowerCase().includes('frontiers') ||
      currentTitle.toLowerCase().includes('microbiology') ||
      currentTitle.toLowerCase().includes('journal') ||
      currentTitle.toLowerCase().includes('untitled');

    if (isGeneric) {
      const healTitle = async () => {
        try {
          let fileBlob: Blob;
          if (typeof paper.fileData === 'string') {
            const base64Data = (paper.fileData as string).includes(',')
              ? (paper.fileData as string).split(',')[1]
              : (paper.fileData as string);
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            fileBlob = new Blob([byteArray], { type: 'application/pdf' });
          } else {
            fileBlob = paper.fileData;
          }

          const detectedTitle = await parsePdfTitle(fileBlob, paper.fileName || 'document.pdf');
          if (detectedTitle && detectedTitle.trim() !== currentTitle) {
            console.log(`Self-healed paper title from "${currentTitle}" to "${detectedTitle}"`);
            await db.papers.update(paper.id, { 
              title: detectedTitle.trim(),
              updatedAt: Date.now()
            });
            await db.projects.update(paper.projectId, { updatedAt: Date.now() });
          }
        } catch (e) {
          console.warn('Self-healing title extraction failed:', e);
        }
      };
      healTitle();
    }
  }, [paper]);

  if (!paperId) {
    return (
      <div className="panel middle-panel" style={{ justifyContent: 'center' }}>
        <div className="no-pdf-placeholder">
          <div className="no-pdf-icon">📖</div>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem', fontWeight: 600 }}>No Paper Selected</h2>
          <p style={{ maxWidth: '320px', fontSize: '0.9rem' }}>
            Choose a research paper from the left panel or upload a new one to begin reading and taking notes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel middle-panel">
      {/* Viewer Header */}
      <div className="viewer-header">
        <div style={{ minWidth: 0, flex: 1, paddingRight: '16px' }}>
          <h3
            style={{
              fontSize: '0.95rem',
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {paper ? paper.title : 'Loading paper...'}
          </h3>
        </div>
      </div>

      {/* PDF View Container */}
      <div className="pdf-viewer-container">
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <Loader2 className="sync-spinner" size={32} style={{ borderColor: 'var(--text-muted)', borderTopColor: 'var(--accent-primary)' }} />
            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Preparing PDF reader...</span>
          </div>
        ) : blobUrl ? (
          <iframe
            src={`${blobUrl}#toolbar=1`}
            className="pdf-iframe"
            title={paper?.title || 'PDF Document'}
          />
        ) : (
          <div style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>
            Failed to render PDF document. Please try re-uploading.
          </div>
        )}
      </div>
    </div>
  );
};
