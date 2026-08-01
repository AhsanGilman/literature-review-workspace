import { PDFDocument } from 'pdf-lib';

// Decodes common HTML entities
export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

// Parses the actual title of the PDF document from metadata or first page text using pdf.js
export async function parsePdfTitle(file: File | Blob, fileName: string): Promise<string> {
  let arrayBuffer: ArrayBuffer | null = null;
  
  // Strategy 1: Attempt to read first page text using pdf.js to locate the largest font (usually the title)
  try {
    arrayBuffer = await file.arrayBuffer();
    
    const pdfjsUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs';
    const pdfjs: any = await import(/* @vite-ignore */ pdfjsUrl);
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs';

    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent();

    interface TextItem {
      str: string;
      fontSize: number;
      y: number;
      x: number;
    }

    const rawItems = (textContent.items || []) as any[];
    const items: TextItem[] = rawItems
      .map((item: any) => {
        const fontSize = Math.abs(item.transform[0] || item.transform[3] || 0);
        return {
          str: item.str || '',
          fontSize,
          y: item.transform[5] || 0,
          x: item.transform[4] || 0,
        };
      })
      .filter((item: TextItem) => item.str.trim().length > 0);

    if (items.length > 0) {
      const maxY = Math.max(...items.map((i: TextItem) => i.y));
      const minY = Math.min(...items.map((i: TextItem) => i.y));
      const height = maxY - minY;
      
      // Focus on upper 75% of the page where title resides
      const upperPageItems = items.filter((item: TextItem) => item.y > minY + height * 0.25);
      
      if (upperPageItems.length > 0) {
        // Group items by rounded font size (to the nearest integer)
        const groups: { [key: number]: TextItem[] } = {};
        upperPageItems.forEach((item) => {
          const roundedSize = Math.round(item.fontSize);
          // Only consider font sizes of 12px and above for the title
          if (roundedSize >= 12) {
            if (!groups[roundedSize]) {
              groups[roundedSize] = [];
            }
            groups[roundedSize].push(item);
          }
        });

        let bestTitle = '';
        let highestScore = -1;

        Object.keys(groups).forEach((sizeStr) => {
          const size = parseInt(sizeStr, 10);
          const groupItems = groups[size];

          // Sort items top-to-bottom, left-to-right
          groupItems.sort((a: TextItem, b: TextItem) => {
            if (Math.abs(a.y - b.y) < 5) {
              return a.x - b.x;
            }
            return b.y - a.y;
          });

          let text = groupItems.map(item => item.str.trim()).join(' ');
          text = text.replace(/\s+/g, ' ').trim();

          // Count words
          const words = text.split(/\s+/).filter(Boolean);
          const wordCount = words.length;

          // Calculate score: FontSize^2 * Math.min(10, WordCount)
          // Also penalize strings containing typical banner words
          const lowerText = text.toLowerCase();
          let penaltyMultiplier = 1.0;
          
          if (
            lowerText.includes('volume') ||
            lowerText.includes('issue') ||
            lowerText.includes('page') ||
            lowerText.includes('frontiersin.org') ||
            lowerText.includes('doi:') ||
            lowerText.includes('published') ||
            lowerText.includes('received')
          ) {
            penaltyMultiplier = 0.1;
          }

          const score = (size * size) * Math.min(10, wordCount) * penaltyMultiplier;

          if (score > highestScore && wordCount >= 3 && text.length >= 10 && text.length < 250) {
            highestScore = score;
            bestTitle = text;
          }
        });

        if (bestTitle) {
          return bestTitle;
        }
      }
    }
  } catch (error) {
    console.warn('Failed to parse title from text stream, falling back to metadata:', error);
  }

  // Strategy 2: Fallback to pdf-lib metadata
  try {
    if (!arrayBuffer) {
      arrayBuffer = await file.arrayBuffer();
    }
    const pdfDoc = await PDFDocument.load(arrayBuffer, { 
      updateMetadata: false, 
      ignoreEncryption: true 
    });
    const title = pdfDoc.getTitle();
    if (title && title.trim().length > 3 && !title.toLowerCase().includes('untitled')) {
      return title.trim();
    }
  } catch (error) {
    console.warn('pdf-lib failed to extract title, attempting regex fallback:', error);
  }

  // Strategy 3: Fallback to regex on first 1MB of plaintext
  try {
    const slice = file.slice(0, 1024 * 1024);
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve('');
      r.readAsText(slice, 'latin1');
    });

    const xmlMatch = text.match(/<dc:title[^>]*>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i);
    if (xmlMatch && xmlMatch[1]) {
      const clean = xmlMatch[1].trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
      if (clean && clean.length > 3 && !clean.toLowerCase().includes('untitled')) {
        return decodeHtmlEntities(clean);
      }
    }

    const literalMatch = text.match(/\/Title\s*\(([^)]+)\)/);
    if (literalMatch && literalMatch[1]) {
      const clean = literalMatch[1].trim();
      if (clean && clean.length > 3 && !clean.toLowerCase().includes('untitled')) {
        return clean;
      }
    }
  } catch (e) {
    console.error('Regex fallback failed:', e);
  }

  // Strategy 4: Fallback to filename without extension
  return fileName.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
}
