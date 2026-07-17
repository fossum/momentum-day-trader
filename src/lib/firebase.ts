/**
 * @file firebase.ts
 * @description Initializes the client-side Firebase SDK and provides helper functions
 * for accessing Firestore and computing content hashes.
 */

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
  projectId: "gen-lang-client-0781581072",
  appId: "1:27771883797:web:62150d6535534d9813991c",
  apiKey: "AIzaSyDbEM2atH0-qZlS2pheNE6ov2q7XFp57DU",
  authDomain: "gen-lang-client-0781581072.firebaseapp.com",
  storageBucket: "gen-lang-client-0781581072.firebasestorage.app",
  messagingSenderId: "27771883797",
};

const app = initializeApp(firebaseConfig);

/**
 * The initialized client-side Firebase Auth service.
 */
export const auth = getAuth(app);

// Use the specific databaseId for AI Studio, loaded from environment variables if available.
const databaseId = (typeof process !== 'undefined' && process.env?.FIREBASE_DATABASE_ID) ||
  (import.meta as any).env?.VITE_FIREBASE_DATABASE_ID ||
  "missing-db-id";

/**
 * The initialized client-side Firestore database instance.
 */
export const db = getFirestore(app, databaseId);

/**
 * The default user ID fallback.
 */
export const DEFAULT_USER_ID = 'testuser';

/**
 * Computes the FNV-1a (32-bit) hash for a given text as a fallback.
 *
 * @param text - The input text to hash.
 * @returns The FNV-1a hash hex string.
 */
export function computeFnv1aHash(text: string): string {
  const normalized = text.trim().toLowerCase();
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Computes a hash (using SHA-256 in secure context, falling back to FNV-1a) for a given text.
 *
 * @param text - The input text to hash.
 * @returns A promise that resolves to the hexadecimal hash string.
 */
export async function computeHash(text: string): Promise<string> {
  const normalized = text.trim().toLowerCase();
  const cryptoObj = (typeof window !== 'undefined' && window.crypto) || (typeof globalThis !== 'undefined' && globalThis.crypto);

  // If crypto and crypto.subtle are available (secure browser context or Node.js 19+), use SHA-256
  if (cryptoObj && cryptoObj.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(normalized);
    const hashBuffer = await cryptoObj.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback: Pure JS implementation of FNV-1a (32-bit) hashing algorithm
  return computeFnv1aHash(text);
}


export interface SentimentResult {
  isPositive: boolean;
  reason: string;
}

/**
 * Fetches the cached news sentiment analysis from the global Firestore cache database.
 *
 * @param ticker - The stock ticker symbol related to the news.
 * @param headline - The news headline text used to locate the cache document.
 * @returns A promise that resolves to the SentimentResult if found in the cache, or null if not found.
 */
export async function getCachedSentiment(ticker: string, headline: string): Promise<SentimentResult | null> {
  try {
    if (!headline) return null;
    const headlineHash = await computeHash(headline);
    const docRef = doc(db, 'newsSentiment', headlineHash);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        isPositive: data.isPositive,
        reason: data.reason
      };
    }
  } catch (err) {
    console.warn('Failed to fetch cached sentiment:', err);
  }
  return null;
}

/**
 * Writes the news sentiment analysis result to the global Firestore cache database.
 *
 * @param ticker - The stock ticker symbol related to the news.
 * @param headline - The news headline text.
 * @param result - The sentiment analysis result to be cached.
 * @returns A promise that resolves when the cache write is complete.
 */
export async function cacheSentiment(ticker: string, headline: string, result: SentimentResult): Promise<void> {
  try {
    if (!headline) return;
    const headlineHash = await computeHash(headline);
    const docRef = doc(db, 'newsSentiment', headlineHash);
    await setDoc(docRef, {
      ticker,
      headline,
      isPositive: result.isPositive,
      reason: result.reason,
      timestamp: serverTimestamp()
    });
  } catch (err) {
    console.warn('Failed to cache sentiment:', err);
  }
}
