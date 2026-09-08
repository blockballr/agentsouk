"use client";

// client-side store for the compare tray
// persists to localStorage so the selection survives navigation

export interface CompareAgent {
  key: string;
  chainId: number;
  tokenId: string;
  name: string;
  image: string | null;
  category?: string;
}

const KEY = "agent-souk.compare.v1";

export function readCompare(): CompareAgent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CompareAgent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeCompare(list: CompareAgent[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 6)));
  } catch {
    // storage unavailable
  }
}

export function compareKey(chainId: number, tokenId: string): string {
  return `${chainId}:${tokenId}`;
}