const fs = require('fs');

let serverCode = fs.readFileSync('server.ts', 'utf8');

serverCode = serverCode.replace(
  /if \(brokerage === "robinhood"\) \{[\s\S]*?return res\.json\(result\);\n      \}/,
  `if (brokerage === "robinhood") {
        const token = req.headers["x-robinhood-token"];
        if (!token || typeof token !== 'string') throw new Error("Robinhood token missing. Please configure it in Settings.");
        
        // 1. Get Account
        const accountsRes = await fetch("https://api.robinhood.com/accounts/", {
          headers: { "Authorization": \`Bearer \${token}\` }
        });
        if (!accountsRes.ok) throw new Error("Failed to fetch Robinhood accounts. Check your bearer token.");
        
        const accountsData = await accountsRes.json();
        const account = accountsData.results?.[0];
        if (!account) throw new Error("No Robinhood account found");
        
        // 2. Get Instrument
        const instrumentRes = await fetch(\`https://api.robinhood.com/instruments/?symbol=\${ticker}\`, {
          headers: { "Authorization": \`Bearer \${token}\` }
        });
        if (!instrumentRes.ok) throw new Error("Failed to fetch instrument.");
        const instrumentData = await instrumentRes.json();
        const instrument = instrumentData.results?.[0];
        if (!instrument) throw new Error("Instrument not found.");
        
        // 3. Place Order
        const orderPayload = {
          account: account.url,
          instrument: instrument.url,
          symbol: ticker,
          price: price ? price : undefined,
          quantity: shares,
          side: side || "buy",
          time_in_force: "gfd",
          trigger: "immediate",
          type: price ? "limit" : "market"
        };
        
        const orderRes = await fetch("https://api.robinhood.com/orders/", {
          method: "POST",
          headers: {
            "Authorization": \`Bearer \${token}\`,
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify(orderPayload)
        });
        
        if (!orderRes.ok) {
          const err = await orderRes.text();
          throw new Error(\`Robinhood trade failed: \${err}\`);
        }
        
        const orderData = await orderRes.json();
        return res.json({ success: true, order: { id: orderData.id, status: orderData.state } });
      }`
);


serverCode = serverCode.replace(
  /if \(brokerage === "robinhood"\) \{[\s\S]*?return res\.json\(\{ balance: result\.balance \}\);\n      \}/,
  `if (brokerage === "robinhood") {
        const token = req.headers["x-robinhood-token"];
        if (!token || typeof token !== 'string') throw new Error("Robinhood token missing. Please configure it in Settings.");
        
        const accountsRes = await fetch("https://api.robinhood.com/accounts/", {
          headers: { "Authorization": \`Bearer \${token}\` }
        });
        if (!accountsRes.ok) throw new Error("Failed to fetch Robinhood accounts. Check your bearer token.");
        
        const accountsData = await accountsRes.json();
        const account = accountsData.results?.[0];
        if (!account) throw new Error("No Robinhood account found");
        
        const buyingPower = account.margin_balances?.unallocated_margin_cash 
          || account.cash_balances?.buying_power 
          || account.buying_power
          || "0";

        return res.json({ balance: parseFloat(buyingPower) });
      }`
);

fs.writeFileSync('server.ts', serverCode);
