const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const target1 = `        const orderRes = await fetch("https://api.robinhood.com/orders/", {
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
        }`;

const replacement1 = `        console.log("Submitting order to Robinhood:", JSON.stringify(orderPayload, null, 2));
        const orderRes = await fetch("https://api.robinhood.com/orders/", {
          method: "POST",
          headers: {
            "Authorization": \`Bearer \${token}\`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          body: JSON.stringify(orderPayload)
        });

        const respText = await orderRes.text();
        console.log("Robinhood Order Response Status:", orderRes.status);
        console.log("Robinhood Order Response Body:", respText);

        if (!orderRes.ok) {
          throw new Error(\`Robinhood trade failed: \${respText}\`);
        }
        
        // Mock parsing since we already consumed .text()
        const orderData = JSON.parse(respText);`;

if(code.includes(target1)){
  code = code.replace(target1, replacement1);
  fs.writeFileSync('server.ts', code);
  console.log("Patched server.ts");
} else {
  console.log("Could not find target to patch in server.ts");
}
