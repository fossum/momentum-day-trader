import { useState } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { LogIn } from 'lucide-react';

export function Auth() {
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center shadow-2xl">
        <h1 className="mb-2 text-2xl font-bold text-white tracking-tight">Momentum Tracker</h1>
        <p className="mb-8 text-sm text-zinc-400">Ross Cameron strategy day trading log</p>
        
        <button
          onClick={handleSignIn}
          className="flex w-full items-center justify-center gap-3 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-zinc-900"
        >
          <LogIn className="h-5 w-5" />
          Sign in with Google
        </button>
        
        {error && (
          <p className="mt-4 text-sm text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}
