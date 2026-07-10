import { useState, useEffect, useCallback } from 'react';
import { MarketGainer } from '../types';

export function isMarketScannerActive(): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    const formatted = formatter.format(new Date());
    
    const weekdayMatch = formatted.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/i);
    const timeMatch = formatted.match(/(\d{1,2}):(\d{2})/);
    
    if (!weekdayMatch || !timeMatch) return true;
    
    const weekday = weekdayMatch[1];
    if (weekday === 'Sat' || weekday === 'Sun') {
      return false;
    }
    
    const hour = parseInt(timeMatch[1], 10);
    const minute = parseInt(timeMatch[2], 10);
    
    const isPM = /PM/i.test(formatted);
    const isAM = /AM/i.test(formatted);
    let hour24 = hour;
    if (isPM && hour < 12) hour24 += 12;
    if (isAM && hour === 12) hour24 = 0;
    
    const totalMinutes = hour24 * 60 + minute;
    // US Market is open from 9:30 AM to 4:00 PM Eastern Time
    const startMinutes = 9 * 60 + 30; // 9:30 AM
    const endMinutes = 16 * 60; // 4:00 PM
    
    return totalMinutes >= startMinutes && totalMinutes <= endMinutes;
  } catch (error) {
    console.warn('Timezone formatter error:', error);
    return true; // fail-safe
  }
}

export function useMarketScanner() {
  const [gainers, setGainers] = useState<MarketGainer[]>([]);
  const [loadingGainers, setLoadingGainers] = useState(false);
  const [isScannerHours, setIsScannerHours] = useState(isMarketScannerActive());

  const fetchGainers = useCallback(async () => {
    const active = isMarketScannerActive();
    setIsScannerHours(active);
    
    if (!active) {
      setLoadingGainers(false);
      return;
    }

    setLoadingGainers(true);
    try {
      const res = await fetch('/api/market/gainers');
      if (res.ok) {
        const data = await res.json();
        setGainers(Array.isArray(data) ? data.slice(0, 15) : []);
      }
    } catch (err) {
      console.warn('Failed to fetch gainers:', err);
    } finally {
      setLoadingGainers(false);
    }
  }, []);

  useEffect(() => {
    fetchGainers();
    // Poll every 30 seconds for new top gainers
    const interval = setInterval(fetchGainers, 30000);
    return () => clearInterval(interval);
  }, [fetchGainers]);

  return {
    gainers,
    loadingGainers,
    isScannerHours,
    refreshGainers: fetchGainers
  };
}
