const fs = require('fs');
let code = fs.readFileSync('src/components/ExecutionEngine.tsx', 'utf8');

const target1 = `          case 0: // Scan & find setup
            {
              const currentPrefs = preferencesRef.current;
              const filteredTickers = LOW_FLOAT_TICKERS.filter(item => {
                const marketMatch = currentPrefs.markets.includes(item.market);
                const rhMatch = !currentPrefs.robinhoodOnly || item.onRobinhood;
                return marketMatch && rhMatch;
              });

              let selectedItem;
              if (filteredTickers.length > 0) {
                selectedItem = filteredTickers[Math.floor(Math.random() * filteredTickers.length)];
              } else {
                addLog('[SYSTEM WARNING] No stocks match filter settings! Using NASDAQ defaults.', 'warn');
                const standardTickers = LOW_FLOAT_TICKERS.filter(t => t.market === 'NASDAQ');
                selectedItem = standardTickers[Math.floor(Math.random() * standardTickers.length)];
              }`;

const replacement1 = `          case 0: // Scan & find setup
            {
              const currentPrefs = preferencesRef.current;
              let selectedItem;

              if (currentPrefs.trackedTickers && currentPrefs.trackedTickers.length > 0) {
                const randomTicker = currentPrefs.trackedTickers[Math.floor(Math.random() * currentPrefs.trackedTickers.length)];
                const existing = LOW_FLOAT_TICKERS.find(t => t.ticker === randomTicker);
                if (existing) {
                  selectedItem = existing;
                } else {
                  selectedItem = {
                    ticker: randomTicker,
                    float: 'N/A',
                    market: 'NASDAQ',
                    onRobinhood: true,
                    companyName: 'Custom Tracked Asset'
                  };
                }
              } else {
                const filteredTickers = LOW_FLOAT_TICKERS.filter(item => {
                  const marketMatch = currentPrefs.markets.includes(item.market);
                  const rhMatch = !currentPrefs.robinhoodOnly || item.onRobinhood;
                  return marketMatch && rhMatch;
                });

                if (filteredTickers.length > 0) {
                  selectedItem = filteredTickers[Math.floor(Math.random() * filteredTickers.length)];
                } else {
                  addLog('[SYSTEM WARNING] No stocks match filter settings! Using NASDAQ defaults.', 'warn');
                  const standardTickers = LOW_FLOAT_TICKERS.filter(t => t.market === 'NASDAQ');
                  selectedItem = standardTickers[Math.floor(Math.random() * standardTickers.length)];
                }
              }`;

const target2 = `            {/* Platform restrictions */}
            <div className="border-t border-zinc-800 pt-3">
              <span className="block text-xs font-bold text-zinc-300 mb-2">Platform Compatibility Filter:</span>`;

const replacement2 = `            {/* Tracked Tickers */}
            <div className="border-t border-zinc-800 pt-3 mb-3">
              <span className="block text-xs font-bold text-zinc-300 mb-2">Allowed Tickers (Leave empty for all):</span>
              <input
                type="text"
                value={(preferences.trackedTickers || []).join(', ')}
                onChange={(e) => {
                  const val = e.target.value;
                  const newPrefs = {
                    ...preferences,
                    trackedTickers: val.split(',').map(s => s.trim().toUpperCase()).filter(s => s)
                  };
                  setPreferences(newPrefs);
                }}
                onBlur={() => savePreferences(preferences)}
                placeholder="AAPL, TSLA, NVDA"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-emerald-500 font-mono text-xs"
              />
              <p className="text-[10px] text-zinc-500 mt-1">If provided, the engine will only trade these exact stocks.</p>
            </div>

            {/* Platform restrictions */}
            <div className="border-t border-zinc-800 pt-3">
              <span className="block text-xs font-bold text-zinc-300 mb-2">Platform Compatibility Filter:</span>`;

if(code.includes(target1) && code.includes(target2)){
  code = code.replace(target1, replacement1).replace(target2, replacement2);
  fs.writeFileSync('src/components/ExecutionEngine.tsx', code);
  console.log("Replaced patch2");
} else {
  console.log("Not found patch2");
}
