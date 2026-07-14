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
export const auth = getAuth(app);
// Use the specific databaseId for AI Studio
export const db = getFirestore(app, "ai-studio-ebb825e0-d58e-4b6d-b706-1ca47c3b3065");

async function computeHash(text: string): Promise<string> {
  const normalized = text.trim().toLowerCase();

  // If window.crypto and window.crypto.subtle are available (secure context), use SHA-256
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(normalized);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback: Pure JS implementation of FNV-1a (32-bit) hashing algorithm
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface SentimentResult {
  isPositive: boolean;
  reason: string;
}

// Fetch news sentiment from global Firestore cache
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

// Write news sentiment analysis results to global Firestore cache
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
