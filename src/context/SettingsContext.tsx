// src/context/SettingsContext.tsx
"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { MangaProvider } from '@/lib/types';

interface SettingsContextType {
  provider: MangaProvider;
  setProvider: (provider: MangaProvider) => void;
}

// Default value context (supaya tidak error saat inisialisasi)
const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  // Default state awal
  const [provider, setProviderState] = useState<MangaProvider>('mangadex');

  // Load dari LocalStorage (hanya berjalan di sisi Client)
  useEffect(() => {
    const saved = localStorage.getItem('manga-provider') as MangaProvider;
    if (saved) {
      setProviderState(saved);
    }
  }, []);

  const setProvider = (newProvider: MangaProvider) => {
    setProviderState(newProvider);
    localStorage.setItem('manga-provider', newProvider);
  };

  // PERBAIKAN: Selalu render Provider, jangan pernah me-return children tanpa Provider!
  return (
    <SettingsContext.Provider value={{ provider, setProvider }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
};