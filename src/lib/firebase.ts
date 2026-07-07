import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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
