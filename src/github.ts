import { db, type Project, type Paper } from './db';

export const DEFAULT_TOKEN = (import.meta as any).env.VITE_GITHUB_PAT || '';
export const DEFAULT_REPO = (import.meta as any).env.VITE_GITHUB_REPO || 'AhsanGilman/literature-review-workspace';

export function isSyncConfigured(): boolean {
  return !!DEFAULT_TOKEN && !!DEFAULT_REPO;
}

interface GitHubFile {
  path: string;
  sha: string;
  type: string;
}

// Helper to convert Blob to Base64 (used during sync to GitHub)
function blobToBase64(blob: Blob | string): Promise<string> {
  if (typeof blob === 'string') {
    const base64 = blob.includes(',')
      ? blob.split(',')[1]
      : blob;
    return Promise.resolve(base64);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const base64 = reader.result.includes(',')
          ? reader.result.split(',')[1]
          : reader.result;
        resolve(base64);
      } else {
        reject(new Error('Failed to read blob as Base64 string'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Helper to convert Base64 string to Blob (used during sync from GitHub)
function base64ToBlob(base64: string, type = 'application/pdf'): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type });
}

export async function testGitHubToken(token: string): Promise<{ valid: boolean; username: string }> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (res.ok) {
      const data = await res.json();
      return { valid: true, username: data.login };
    }
    return { valid: false, username: '' };
  } catch (error) {
    console.error('Error validating token:', error);
    return { valid: false, username: '' };
  }
}

export async function ensureRepoExists(token: string, repoFullName: string): Promise<string> {
  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  const [owner, repoName] = repoFullName.split('/');
  if (!owner || !repoName) {
    throw new Error('Repository name must be in the format: owner/repo-name');
  }

  // Check if repo exists
  const checkRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, { headers });
  if (checkRes.ok) {
    const repoData = await checkRes.json();
    return repoData.default_branch || 'main';
  }

  // If 404, we try to create it
  if (checkRes.status === 404) {
    console.log(`Repository ${repoFullName} not found. Creating it...`);
    const createRes = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: repoName,
        private: true,
        description: 'Sync repository for Litsy Literature Review Workspace',
        auto_init: true, // Crucial to initialize with a README so we have a commit history/branch
      }),
    });

    if (createRes.ok) {
      const createData = await createRes.json();
      // Wait a moment for GitHub to initialize the repo
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return createData.default_branch || 'main';
    } else {
      const err = await createRes.json();
      throw new Error(`Failed to create repository: ${err.message}`);
    }
  }

  throw new Error(`Repository check failed: Status ${checkRes.status}`);
}

async function getRepoTree(
  token: string,
  repo: string,
  branch: string
): Promise<Record<string, GitHubFile>> {
  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
  };

  try {
    // 1. Get the latest commit of the branch
    const refRes = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/${branch}`, {
      headers,
    });
    if (!refRes.ok) return {};
    const refData = await refRes.json();
    const commitSha = refData.object.sha;

    // 2. Get the tree recursively
    const treeRes = await fetch(
      `https://api.github.com/repos/${repo}/git/trees/${commitSha}?recursive=true`,
      { headers }
    );
    if (!treeRes.ok) return {};
    const treeData = await treeRes.json();

    const filesMap: Record<string, GitHubFile> = {};
    if (Array.isArray(treeData.tree)) {
      for (const item of treeData.tree) {
        if (item.type === 'blob') {
          filesMap[item.path] = item;
        }
      }
    }
    return filesMap;
  } catch (e) {
    console.error('Error fetching repo tree:', e);
    return {};
  }
}

async function uploadFileToGitHub(
  token: string,
  repo: string,
  path: string,
  contentBase64: string,
  message: string,
  sha?: string
): Promise<string> {
  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  const body = {
    message,
    content: contentBase64,
    sha,
  };

  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Failed to upload file ${path}: ${err.message}`);
  }

  const data = await res.json();
  return data.content.sha;
}

export async function syncToGitHub(
  userEmail: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const token = DEFAULT_TOKEN;
  const repo = DEFAULT_REPO;
  if (!token || !repo) {
    console.warn('GitHub Sync skipped: VITE_GITHUB_PAT or VITE_GITHUB_REPO environment variable not set.');
    return;
  }

  onProgress?.('Initializing sync to GitHub...');
  const branch = await ensureRepoExists(token, repo);
  onProgress?.(`Found repository branch: ${branch}`);

  const prefix = `users/${userEmail.replace(/[^a-zA-Z0-9._-]/g, '_')}/`;

  // Fetch all local data
  const localProjects = await db.projects.toArray();
  const localPapers = await db.papers.toArray();
  const localNotes = await db.notes.toArray();

  // Get current GitHub files and their SHAs
  onProgress?.('Fetching remote repository tree...');
  const remoteTree = await getRepoTree(token, repo, branch);

  // Helper to convert UTF-8 string to Base64 (safely handling Unicode)
  const toBase64 = (str: string) => {
    const bytes = new TextEncoder().encode(str);
    let binString = '';
    bytes.forEach((b) => {
      binString += String.fromCharCode(b);
    });
    return btoa(binString);
  };

  // 1. Sync metadata: projects.json and papers_metadata.json (without PDF base64 contents)
  onProgress?.('Uploading project and paper metadata...');
  const projectsData = JSON.stringify(localProjects, null, 2);
  const papersMetadata = localPapers.map(({ fileData, ...meta }) => meta);
  const papersMetadataData = JSON.stringify(papersMetadata, null, 2);

  await uploadFileToGitHub(
    token,
    repo,
    `${prefix}projects.json`,
    toBase64(projectsData),
    'Sync projects metadata',
    remoteTree[`${prefix}projects.json`]?.sha
  );

  await uploadFileToGitHub(
    token,
    repo,
    `${prefix}papers_metadata.json`,
    toBase64(papersMetadataData),
    'Sync papers metadata',
    remoteTree[`${prefix}papers_metadata.json`]?.sha
  );

  // 2. Sync papers PDFs
  for (const paper of localPapers) {
    const pdfPath = `${prefix}papers/${paper.id}.pdf`;
    const remoteFile = remoteTree[pdfPath];

    // If PDF does not exist in repo, upload it.
    if (!remoteFile) {
      onProgress?.(`Uploading PDF: ${paper.title.slice(0, 30)}...`);
      const base64Content = await blobToBase64(paper.fileData);

      await uploadFileToGitHub(
        token,
        repo,
        pdfPath,
        base64Content,
        `Upload PDF for paper: ${paper.title.slice(0, 50)}`
      );
    }
  }

  // 3. Sync notes as separate Markdown files
  for (const note of localNotes) {
    const paper = localPapers.find((p) => p.id === note.paperId);
    const paperTitle = paper ? paper.title : note.paperId;
    const notePath = `${prefix}notes/${note.paperId}.md`;
    const remoteFile = remoteTree[notePath];

    // Write markdown content with yaml header for readability
    const mdContent = `---
title: "${paperTitle.replace(/"/g, '\\"')}"
paperId: "${note.paperId}"
projectId: "${note.projectId}"
updatedAt: ${note.updatedAt}
---

${note.content}`;

    const localBase64 = toBase64(mdContent);

    // Fetch the remote file first to compare or check if upload is needed.
    onProgress?.(`Syncing note: ${paperTitle.slice(0, 30)}...`);
    await uploadFileToGitHub(
      token,
      repo,
      notePath,
      localBase64,
      `Update note for paper: ${paperTitle.slice(0, 50)}`,
      remoteFile?.sha
    );
  }

  onProgress?.('Sync to GitHub completed successfully!');
}

export async function syncFromGitHub(
  userEmail: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const token = DEFAULT_TOKEN;
  const repo = DEFAULT_REPO;
  if (!token || !repo) {
    console.warn('GitHub Sync skipped: VITE_GITHUB_PAT or VITE_GITHUB_REPO environment variable not set.');
    return;
  }

  onProgress?.('Initializing sync from GitHub...');
  const branch = await ensureRepoExists(token, repo);

  onProgress?.('Fetching remote repository tree...');
  const remoteTree = await getRepoTree(token, repo, branch);

  const prefix = `users/${userEmail.replace(/[^a-zA-Z0-9._-]/g, '_')}/`;

  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
  };

  // Helper to fetch file content and decode from base64
  const fetchFileTextContent = async (path: string): Promise<string> => {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers });
    if (!res.ok) throw new Error(`Failed to fetch file: ${path}`);
    const data = await res.json();
    // Decode base64 utf-8
    const binString = atob(data.content.replace(/\s/g, ''));
    const bytes = Uint8Array.from(binString, (m) => m.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };

  // Helper to fetch raw base64 content (for PDFs)
  const fetchFileBase64Content = async (path: string): Promise<string> => {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers });
    if (!res.ok) throw new Error(`Failed to fetch file: ${path}`);
    const data = await res.json();
    return data.content.replace(/\s/g, ''); // return clean base64 string
  };

  // 1. Pull projects
  const projectsPath = `${prefix}projects.json`;
  if (remoteTree[projectsPath]) {
    onProgress?.('Syncing projects metadata...');
    const projectsText = await fetchFileTextContent(projectsPath);
    const projects: Project[] = JSON.parse(projectsText);
    for (const project of projects) {
      const existing = await db.projects.get(project.id);
      if (!existing || existing.updatedAt < project.updatedAt) {
        await db.projects.put(project);
      }
    }
  }

  // 2. Pull papers metadata and PDFs
  const papersMetaPath = `${prefix}papers_metadata.json`;
  if (remoteTree[papersMetaPath]) {
    onProgress?.('Syncing papers metadata...');
    const papersMetaText = await fetchFileTextContent(papersMetaPath);
    const remotePapersMeta: Omit<Paper, 'fileData'>[] = JSON.parse(papersMetaText);

    for (const paperMeta of remotePapersMeta) {
      const pdfPath = `${prefix}papers/${paperMeta.id}.pdf`;
      const existingPaper = await db.papers.get(paperMeta.id);

      // Check if we need to insert or update the paper
      if (!existingPaper || existingPaper.updatedAt < paperMeta.updatedAt) {
        onProgress?.(`Fetching PDF for: ${paperMeta.title.slice(0, 30)}...`);
        let fileBlob = new Blob([], { type: 'application/pdf' });
        if (remoteTree[pdfPath]) {
          const base64 = await fetchFileBase64Content(pdfPath);
          fileBlob = base64ToBlob(base64);
        }

        const fullPaper: Paper = {
          ...paperMeta,
          fileData: fileBlob,
        };
        await db.papers.put(fullPaper);
      }
    }
  }

  // 3. Pull notes
  onProgress?.('Syncing notes...');
  const notePaths = Object.keys(remoteTree).filter((path) => path.startsWith(`${prefix}notes/`) && path.endsWith('.md'));
  
  for (const path of notePaths) {
    const paperId = path.replace(`${prefix}notes/`, '').replace('.md', '');
    try {
      const mdContent = await fetchFileTextContent(path);
      
      // Parse yaml header and markdown
      const lines = mdContent.split('\n');
      let content = mdContent;
      let projectId = 'default-project';
      let updatedAt = Date.now();

      if (mdContent.startsWith('---')) {
        let yamlEndIndex = -1;
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trim() === '---') {
            yamlEndIndex = i;
            break;
          }
        }

        if (yamlEndIndex !== -1) {
          const yamlLines = lines.slice(1, yamlEndIndex);
          content = lines.slice(yamlEndIndex + 1).join('\n').trim();
          
          for (const line of yamlLines) {
            const separator = line.indexOf(':');
            if (separator !== -1) {
              const key = line.slice(0, separator).trim();
              const value = line.slice(separator + 1).trim().replace(/"/g, '');
              if (key === 'projectId') projectId = value;
              if (key === 'updatedAt') updatedAt = parseInt(value, 10) || Date.now();
            }
          }
        }
      }

      const existingNote = await db.notes.get(paperId); // note id is paperId (1-to-1)
      if (!existingNote || existingNote.updatedAt < updatedAt) {
        await db.notes.put({
          id: paperId,
          paperId,
          projectId,
          content,
          createdAt: existingNote?.createdAt || Date.now(),
          updatedAt,
        });
      }
    } catch (err) {
      console.error(`Failed to sync note ${path}:`, err);
    }
  }

  onProgress?.('Sync from GitHub completed successfully!');
}
