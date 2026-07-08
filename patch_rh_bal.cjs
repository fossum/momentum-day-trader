const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const target = `      if (brokerage === "robinhood") {
        const token = req.headers["x-robinhood-token"];
        if (!token || typeof token !== 'string') throw new Error("Robinhood token missing. Please configure it in Settings.");
        
        const accountsRes = await fetch("https://api.robinhood.com/accounts/", {
          headers: { "Authorization": \`Bearer \${token}\` }
        });`;

const replacement = `      if (brokerage === "robinhood") {
        let token = req.headers["x-robinhood-token"];
        if (!token || typeof token !== 'string') throw new Error("Robinhood token missing. Please configure it in Settings.");
        if (token.startsWith('Bearer ')) token = token.slice(7);
        
        const accountsRes = await fetch("https://api.robinhood.com/accounts/", {
          headers: { "Authorization": \`Bearer \${token}\` }
        });`;

if(code.includes(target)){
  code = code.replace(target, replacement);
  fs.writeFileSync('server.ts', code);
  console.log("Replaced bal");
} else {
  console.log("Not found bal");
}
