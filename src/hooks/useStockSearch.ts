import { useState } from 'react';
import { FmpQuote, FmpNews } from '../types';

export function useStockSearch() {
  const [quote, setQuote] = useState<FmpQuote | null>(null);
  const [news, setNews] = useState<FmpNews[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [searchTicker, setSearchTicker] = useState('');

  const performSearch = async (symbol: string) => {
    if (!symbol) return;
    const cleanSymbol = symbol.toUpperCase();
    setSearchTicker(cleanSymbol);
    setLoadingSearch(true);
    try {
      const [quoteRes, newsRes] = await Promise.all([
        fetch(`/api/stock/${cleanSymbol}/quote`),
        fetch(`/api/stock/${cleanSymbol}/news`)
      ]);
      
      const quoteData = await quoteRes.json();
      const newsData = await newsRes.json();
      
      if (quoteData && quoteData.length > 0) {
        setQuote(quoteData[0]);
      } else {
        setQuote(null);
      }
      
      setNews(newsData || []);
    } catch (err) {
      console.warn('Failed to perform stock search:', err);
    } finally {
      setLoadingSearch(false);
    }
  };

  return {
    quote,
    setQuote,
    news,
    setNews,
    loadingSearch,
    searchTicker,
    setSearchTicker,
    performSearch
  };
}
