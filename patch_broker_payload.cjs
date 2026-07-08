const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const target = `        const orderPayload = {
          account: account.url,
          instrument: instrument.url,
          symbol: ticker,
          price: priceStr,
          quantity: shares.toString(),
          side: side || "buy",
          time_in_force: "gfd",
          trigger: "immediate",
          type: price ? "limit" : "market",
          ref_id: crypto.randomUUID(),
          extended_hours: false,
          market_hours: "regular_hours",
          order_form_version: 4
        };`;

const replacement = `        const orderPayload = {
          account: account.url,
          instrument: instrument.url,
          symbol: ticker,
          price: priceStr,
          quantity: shares.toString(),
          side: side || "buy",
          time_in_force: "gfd",
          trigger: "immediate",
          type: price ? "limit" : "market",
          ref_id: crypto.randomUUID(),
          extended_hours: false,
          market_hours: "regular_hours",
          order_form_version: 4,
          ask_price: priceStr || "1.00",
          bid_price: priceStr || "1.00",
          bid_ask_timestamp: new Date().toISOString()
        };`;

if(code.includes(target)){
  code = code.replace(target, replacement);
  fs.writeFileSync('server.ts', code);
  console.log("Replaced");
} else {
  console.log("Not found target");
}
