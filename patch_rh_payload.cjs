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
          ref_id: crypto.randomUUID()
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
          order_form_version: 4
        };`;

if(code.includes(target)){
  code = code.replace(target, replacement);
  fs.writeFileSync('server.ts', code);
  console.log("Replaced payload");
} else {
  console.log("Not found payload");
}
