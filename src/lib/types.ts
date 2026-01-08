// src/lib/types.ts
export interface Manga {
  id: string;
  title: string;
  image: string;
  releaseDate?: string | number;
  rating?: number;
}

export type MangaProvider = 'mangadex' | 'mangahere' | 'mangakakalot' | 'mangapark';

export interface Chapter {
  id: string;
  chapter: string;
  title: string;
  publishAt: string;
  isExternal?: boolean;
  externalUrl?: string | null;
}

export interface MangaDetail extends Manga {
  description: string;
  author: string;
  status: string;
  genres: string[];
  chapters: Chapter[];
}