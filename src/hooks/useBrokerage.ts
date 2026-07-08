import { useState, useEffect, useRef } from 'react';
import { UserPreferences } from '../types';
import { auth } from '../lib/firebase';

export function useBrokerage(
  preferences: UserPreferences,
  retryTrigger: number = 0,
  addLogMessage?: (text: string, type: 'info' | 'scan' | 'found' | 'exec' | 'success' | 'fail' | 'warn' | 'error', ticker?: string) => void
) {
  const [balance, setBalance] = useState<number>(0);
  const [pnl, setPnl] = useState<number>(0);
  const [pnlPercent, setPnlPercent] = useState<number>(0);
  const [connectionStatus, setConnectionStatus] = useState<'success' | 'failed' | 'none'>('none');
  const connectionStatusRef = useRef<'success' | 'failed' | 'none'>('none');
  
  const [isRhValidating, setIsRhValidating] = useState(false);
  const [rhMessage, setRhMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const getBrokerageLabel = (brokerage?: string) => {
    if (brokerage === 'robinhood') return 'Robinhood';
    if (brokerage === 'interactivebrokers') return 'IBKR';
    if (brokerage === 'lightspeed') return 'Lightspeed';
    return 'Simulation';
  };

  const addLog = (text: string, type: 'info' | 'warn' | 'error' | 'success', ticker?: string) => {
    if (addLogMessage) {
      addLogMessage(text, type, ticker);
    }
  };

  // Fetch account balance
  useEffect(() => {
    if (retryTrigger > 0) {
      connectionStatusRef.current = 'none';
      setConnectionStatus('none');
      addLog('[SYSTEM] Retrying broker connection...', 'info');
    }

    if (!preferences.brokerage || preferences.brokerage === 'none') {
      setBalance(prev => (prev === 0 ? 10000 : prev)); // Default simulated balance
      setPnl(0);
      setPnlPercent(0);
      if (connectionStatusRef.current !== 'none') {
        addLog('[SYSTEM] Switched to Simulated Mode.', 'info');
      }
      connectionStatusRef.current = 'none';
      setConnectionStatus('none');
      return;
    }

    const fetchBalance = async () => {
      if (preferences.brokerage === 'robinhood' && !preferences.robinhoodToken) {
        const msg = 'Robinhood token missing. Please configure it in Settings.';
        console.warn(msg);
        if (connectionStatusRef.current !== 'failed') {
          addLog(`[SYSTEM ERROR] ${msg}`, 'error');
        }
        setBalance(0);
        setPnl(0);
        setPnlPercent(0);
        connectionStatusRef.current = 'failed';
        setConnectionStatus('failed');
        return;
      }
      if (preferences.brokerage === 'interactivebrokers' && !preferences.ibkrUrl) {
        const msg = 'IBKR Gateway URL missing. Please configure it in Settings.';
        console.warn(msg);
        if (connectionStatusRef.current !== 'failed') {
          addLog(`[SYSTEM ERROR] ${msg}`, 'error');
        }
        setBalance(0);
        setPnl(0);
        setPnlPercent(0);
        connectionStatusRef.current = 'failed';
        setConnectionStatus('failed');
        return;
      }
      if (preferences.brokerage === 'lightspeed' && !preferences.lightspeedKey) {
        const msg = 'Lightspeed key missing. Please configure it in Settings.';
        console.warn(msg);
        if (connectionStatusRef.current !== 'failed') {
          addLog(`[SYSTEM ERROR] ${msg}`, 'error');
        }
        setBalance(0);
        setPnl(0);
        setPnlPercent(0);
        connectionStatusRef.current = 'failed';
        setConnectionStatus('failed');
        return;
      }

      try {
        const res = await fetch(`/api/broker/balance?brokerage=${preferences.brokerage}`, {
          headers: {
            'x-robinhood-token': preferences.robinhoodToken || '',
            'x-lightspeed-key': preferences.lightspeedKey || '',
            'x-ibkr-url': preferences.ibkrUrl || ''
          }
        });
        if (res.ok) {
          const data = await res.json();
          setBalance(data.balance || 0);
          setPnl(data.pnl || 0);
          setPnlPercent(data.pnlPercent || 0);
          if (connectionStatusRef.current !== 'success') {
            addLog(
              `[SYSTEM] Connected successfully to ${getBrokerageLabel(preferences.brokerage)}. Real Balance: $${(data.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              'info'
            );
          }
          connectionStatusRef.current = 'success';
          setConnectionStatus('success');
        } else {
          let errMsg = `HTTP ${res.status}`;
          try {
            const errData = await res.json();
            if (errData.error) errMsg = errData.error;
          } catch {}

          if (connectionStatusRef.current !== 'failed') {
            addLog(`[SYSTEM ERROR] Connection to ${getBrokerageLabel(preferences.brokerage)} failed: ${errMsg}`, 'error');
          }
          setBalance(0);
          setPnl(0);
          setPnlPercent(0);
          connectionStatusRef.current = 'failed';
          setConnectionStatus('failed');
        }
      } catch (err: any) {
        console.warn('Balance fetch error:', err.message);
        if (connectionStatusRef.current !== 'failed') {
          addLog(`[SYSTEM ERROR] Connection to ${getBrokerageLabel(preferences.brokerage)} failed: ${err.message}`, 'error');
        }
        setBalance(0);
        setPnl(0);
        setPnlPercent(0);
        connectionStatusRef.current = 'failed';
        setConnectionStatus('failed');
      }
    };

    fetchBalance();

    const interval = setInterval(fetchBalance, 30000); // refresh every 30s
    return () => {
      clearInterval(interval);
    };
  }, [preferences, retryTrigger]);

  const executeTrade = async (
    ticker: string, 
    shares: number, 
    price: number, 
    side: 'buy' | 'sell',
    target?: number,
    stop?: number
  ) => {
    if (!preferences.brokerage || preferences.brokerage === 'none') {
      return { success: true, simulated: true };
    }

    const res = await fetch('/api/broker/trade', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-robinhood-token': preferences.robinhoodToken || '',
        'x-lightspeed-key': preferences.lightspeedKey || '',
        'x-ibkr-url': preferences.ibkrUrl || '',
        'x-approved-ibkr-warnings': (preferences.approvedIbkrWarnings || []).join(','),
        'x-user-id': auth.currentUser?.uid || ''
      },
      body: JSON.stringify({
        brokerage: preferences.brokerage,
        ticker: ticker.toUpperCase(),
        shares,
        price,
        side,
        target,
        stop
      })
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || res.statusText);
    }

    return await res.json();
  };

  const replyToIbkrPrompt = async (promptId: string, confirmed: boolean) => {
    const res = await fetch('/api/broker/ibkr/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ibkr-url': preferences.ibkrUrl || '',
        'x-approved-ibkr-warnings': (preferences.approvedIbkrWarnings || []).join(','),
        'x-user-id': auth.currentUser?.uid || ''
      },
      body: JSON.stringify({
        promptId,
        confirmed
      })
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || res.statusText);
    }

    return await res.json();
  };

  const validateRobinhood = async (username: string, password: string): Promise<string | null> => {
    if (!username || !password) {
      setRhMessage({ type: 'error', text: 'Username and password are required' });
      return null;
    }
    setIsRhValidating(true);
    setRhMessage(null);
    try {
      const res = await fetch('/api/broker/robinhood/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setRhMessage({ type: 'success', text: 'Credentials validated! Token acquired.' });
        return data.token;
      } else {
        setRhMessage({ type: 'error', text: data.error || 'Authentication failed' });
        return null;
      }
    } catch (err: any) {
      setRhMessage({ type: 'error', text: err.message || 'Connection error' });
      return null;
    } finally {
      setIsRhValidating(false);
    }
  };

  // Let me replace this mockup validateRobinhood with the correct code in writing.
  return {
    balance,
    setBalance,
    pnl,
    setPnl,
    pnlPercent,
    setPnlPercent,
    connectionStatus,
    isRhValidating,
    rhMessage,
    setRhMessage,
    executeTrade,
    replyToIbkrPrompt,
    validateRobinhood
  };
}
