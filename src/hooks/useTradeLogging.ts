import { useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, writeBatch, doc } from 'firebase/firestore';
import { Trade, UserPreferences } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';

export function useTradeLogging(preferences: UserPreferences) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!auth.currentUser) return;
    
    let unsubscribe: () => void = () => {};

    const loadTrades = async () => {
      // Try to load from broker if not "none"
      if (preferences.brokerage && preferences.brokerage !== 'none') {
        if (preferences.brokerage === 'robinhood' && !preferences.robinhoodToken) {
          console.warn('Robinhood token missing, skipping broker trade fetch');
        } else {
          try {
            const res = await fetch(`/api/broker/trades?brokerage=${preferences.brokerage}`, {
              headers: {
                'x-robinhood-token': preferences.robinhoodToken || '',
                'x-lightspeed-key': preferences.lightspeedKey || '',
                'x-ibkr-url': preferences.ibkrUrl || ''
              }
            });
            if (res.ok) {
              const data = await res.json();
              setTrades(data);
              setDbError(null);
              return; // Successfully loaded from broker
            } else {
              console.warn('Failed to fetch trades from broker, falling back to database');
            }
          } catch (err) {
            console.warn('Failed to fetch trades from broker, falling back to database', err);
          }
        }
      }

      // Fallback to database
      const q = query(
        collection(db, `users/${auth.currentUser!.uid}/trades`),
        orderBy('timestamp', 'desc')
      );

      unsubscribe = onSnapshot(q, (snapshot) => {
        const tradesData: Trade[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          tradesData.push({
            id: doc.id,
            ...data,
            // Handle Firestore timestamp
            timestamp: data.timestamp?.toMillis() || Date.now()
          } as Trade);
        });
        setTrades(tradesData);
        setDbError(null);
      }, (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, `users/${auth.currentUser?.uid}/trades`);
        } catch (e: any) {
          let msg = 'Database connection error.';
          try {
            const parsed = JSON.parse(e.message);
            msg = parsed.error || msg;
          } catch {
            msg = e.message;
          }
          setDbError(msg);
        }
      });
    };
    
    loadTrades();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [preferences.brokerage, preferences.robinhoodToken, preferences.lightspeedKey, preferences.ibkrUrl]);

  const logTrade = async (ticker: string, entryPrice: number, exitPrice: number, shares: number, strategy: string, notes: string) => {
    if (!auth.currentUser || !ticker || !entryPrice || !exitPrice || !shares) return;
    
    setIsSubmitting(true);
    const pnl = (exitPrice - entryPrice) * shares;

    try {
      if (preferences.brokerage && preferences.brokerage !== 'none') {
        // Post trade to actual broker via API
        const res = await fetch('/api/broker/trade', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-robinhood-token': preferences.robinhoodToken || '',
            'x-lightspeed-key': preferences.lightspeedKey || '',
            'x-ibkr-url': preferences.ibkrUrl || ''
          },
          body: JSON.stringify({
            brokerage: preferences.brokerage,
            ticker: ticker.toUpperCase(),
            shares,
            price: exitPrice, // closing trade at exit price
            side: 'sell'
          })
        });
        
        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(`Brokerage error: ${errorData.error || res.statusText}`);
        }
      }

      // Also log it into Firestore history
      await addDoc(collection(db, `users/${auth.currentUser.uid}/trades`), {
        userId: auth.currentUser.uid,
        ticker: ticker.toUpperCase(),
        entryPrice,
        exitPrice,
        shares,
        strategy,
        notes,
        pnl,
        timestamp: serverTimestamp()
      });
      
    } catch (err: any) {
      try {
        handleFirestoreError(err, OperationType.CREATE, `users/${auth.currentUser.uid}/trades`);
      } catch (handledErr: any) {
        let msg = 'Database connection error.';
        try {
          const parsed = JSON.parse(handledErr.message);
          msg = parsed.error || msg;
        } catch {
          msg = handledErr.message;
        }
        setDbError(msg);
        throw new Error(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearHistory = async () => {
    if (!auth.currentUser || trades.length === 0) return;
    
    if (!confirmClear) {
      setConfirmClear(true);
      // Auto-reset confirmation after 3 seconds
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }

    try {
      const batch = writeBatch(db);
      trades.forEach((trade) => {
        const tradeRef = doc(db, `users/${auth.currentUser!.uid}/trades`, trade.id);
        batch.delete(tradeRef);
      });
      await batch.commit();
      setConfirmClear(false);
    } catch (err: any) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `users/${auth.currentUser.uid}/trades`);
      } catch (handledErr: any) {
        let msg = 'Database connection error.';
        try {
          const parsed = JSON.parse(handledErr.message);
          msg = parsed.error || msg;
        } catch {
          msg = handledErr.message;
        }
        setDbError(msg);
      }
    }
  };

  return {
    trades,
    dbError,
    setDbError,
    isSubmitting,
    confirmClear,
    setConfirmClear,
    logTrade,
    clearHistory
  };
}
