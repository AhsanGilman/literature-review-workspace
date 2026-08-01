import Dexie, { type Table } from 'dexie';

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface Paper {
  id: string;
  projectId: string;
  title: string;
  authors: string;
  journal: string;
  year: string;
  tags: string[];
  fileData: string; // Base64 encoded PDF string
  fileName: string;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  paperId: string;
  projectId: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export class LitReviewDatabase extends Dexie {
  projects!: Table<Project>;
  papers!: Table<Paper>;
  notes!: Table<Note>;

  constructor() {
    super('LitReviewDatabase');
    this.version(1).stores({
      projects: 'id, name, createdAt',
      papers: 'id, projectId, title, createdAt, *tags',
      notes: 'id, paperId, projectId, createdAt'
    });
  }
}

export const db = new LitReviewDatabase();

// Initial database seed
export async function seedInitialData() {
  const projectCount = await db.projects.count();
  if (projectCount === 0) {
    const defaultProjectId = 'default-project';
    await db.projects.add({
      id: defaultProjectId,
      name: 'My First Literature Review',
      description: 'Default project to collect and review papers.',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    // We can add a sample paper if needed, or leave it empty for a clean state
  }
}
seedInitialData().catch(console.error);
