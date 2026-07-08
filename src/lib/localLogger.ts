import { auth } from './firebase';

export async function logLocalDecision(message: string, level: string = 'INFO') {
  const userId = auth.currentUser?.uid;
  if (!userId) return;

  try {
    await fetch('/api/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId,
        message,
        level
      })
    });
  } catch (err) {
    console.warn('Failed to send log to local logger:', err);
  }
}
