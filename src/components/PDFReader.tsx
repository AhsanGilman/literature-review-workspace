import React, { useEffect, useState } from 'react';
import { db, type Paper } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Loader2 } from 'lucide-react';

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
    if (!paper) {
      setBlobUrl(null);
      return;
    }

    setLoading(true);
    let active = true;

    const convertBase64ToBlobUrl = async () => {
      try {
        const base64Data = paper.fileData.includes(',')
          ? paper.fileData.split(',')[1]
          : paper.fileData;

        // Convert base64 to raw binary data held in a string
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        if (active) {
          setBlobUrl(url);
          setLoading(false);
        }
      } catch (error) {
        console.error('Error generating PDF Blob URL:', error);
        if (active) setLoading(false);
      }
    };

    convertBase64ToBlobUrl();

    return () => {
      active = false;
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
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
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {paper?.authors ? `${paper.authors.split(',')[0]} et al.` : ''}
            {paper?.year ? ` (${paper.year})` : ''}
            {paper?.journal ? ` · ${paper.journal}` : ''}
          </span>
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
