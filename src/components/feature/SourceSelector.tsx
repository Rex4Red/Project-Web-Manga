// src/components/feature/SourceSelector.tsx
"use client";

import { useSettings } from '@/context/SettingsContext';
import { MangaProvider } from '@/lib/types';

const PROVIDERS: { value: MangaProvider; label: string }[] = [
  { value: 'mangadex', label: 'MangaDex (Best)' },
  { value: 'mangahere', label: 'MangaHere' },
  { value: 'mangakakalot', label: 'MangaKakalot (Fast)' },
  { value: 'mangapark', label: 'MangaPark' },
];

export default function SourceSelector() {
  const { provider, setProvider } = useSettings();

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="provider-select" className="text-sm font-medium text-gray-400">
        Source:
      </label>
      <select
        id="provider-select"
        value={provider}
        onChange={(e) => setProvider(e.target.value as MangaProvider)}
        className="bg-gray-800 text-white border border-gray-700 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
      >
        {PROVIDERS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}