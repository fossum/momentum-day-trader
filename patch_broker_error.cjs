const fs = require('fs');
let code = fs.readFileSync('src/components/ExecutionEngine.tsx', 'utf8');

const target1 = `                  }).then(async (res) => {
                  if (res.ok) {
                    addLog(\`[BROKER] LIVE BUY ORDER SUBMITTED (\${preferencesRef.current.brokerage})\`, 'success', activeTrade.ticker);
                  } else {
                    const err = await res.json();
                    addLog(\`[BROKER ERROR] BUY FAILED: \${err.error}\`, 'error', activeTrade.ticker);
                  }
                }).catch(err => {
                  addLog(\`[BROKER ERROR] Connection failed\`, 'error', activeTrade.ticker);
                });`;

const replacement1 = `                  }).then(async (res) => {
                  if (res.ok) {
                    addLog(\`[BROKER] LIVE BUY ORDER SUBMITTED (\${preferencesRef.current.brokerage})\`, 'success', activeTrade.ticker);
                  } else {
                    const err = await res.json();
                    addLog(\`[BROKER ERROR] BUY FAILED: \${err.error}\`, 'error', activeTrade.ticker);
                    setIsActive(false);
                    updateCurrentTrade(null);
                    setStep(0);
                  }
                }).catch(err => {
                  addLog(\`[BROKER ERROR] Connection failed\`, 'error', activeTrade.ticker);
                  setIsActive(false);
                  updateCurrentTrade(null);
                  setStep(0);
                });`;

const target2 = `                  }).then(async (res) => {
                    if (res.ok) {
                      addLog(\`[BROKER] LIVE SELL ORDER SUBMITTED (\${preferencesRef.current.brokerage})\`, 'success', resolvedTrade.ticker);
                    } else {
                      const err = await res.json();
                      addLog(\`[BROKER ERROR] SELL FAILED: \${err.error}\`, 'error', resolvedTrade.ticker);
                    }
                  }).catch(err => {
                    addLog(\`[BROKER ERROR] Connection failed\`, 'error', resolvedTrade.ticker);
                  });`;

const replacement2 = `                  }).then(async (res) => {
                    if (res.ok) {
                      addLog(\`[BROKER] LIVE SELL ORDER SUBMITTED (\${preferencesRef.current.brokerage})\`, 'success', resolvedTrade.ticker);
                    } else {
                      const err = await res.json();
                      addLog(\`[BROKER ERROR] SELL FAILED: \${err.error}\`, 'error', resolvedTrade.ticker);
                      setIsActive(false);
                    }
                  }).catch(err => {
                    addLog(\`[BROKER ERROR] Connection failed\`, 'error', resolvedTrade.ticker);
                    setIsActive(false);
                  });`;


if(code.includes(target1) && code.includes(target2)){
  code = code.replace(target1, replacement1).replace(target2, replacement2);
  fs.writeFileSync('src/components/ExecutionEngine.tsx', code);
  console.log("Replaced");
} else {
  console.log("Not found target1:", code.includes(target1));
  console.log("Not found target2:", code.includes(target2));
}
