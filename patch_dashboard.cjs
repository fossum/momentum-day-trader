const fs = require('fs');
let code = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

code = code.replace(
  /<div className="pl-7 pt-2 flex flex-col gap-2">[\s\S]*?<\/div>/,
  `<div className="pl-7 pt-2 flex flex-col gap-1">
                        <input
                          type="password"
                          placeholder="Robinhood Bearer Token"
                          value={preferences.robinhoodToken || ''}
                          onChange={(e) => setPreferences({ ...preferences, robinhoodToken: e.target.value })}
                          className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <span className="text-xs text-zinc-400">
                          To find this: Log into Robinhood on web, open Developer Tools (F12) then Network. Look for any API request (e.g., to api.robinhood.com) and copy the Authorization header value (everything after 'Bearer ').
                        </span>
                      </div>`
);

fs.writeFileSync('src/components/Dashboard.tsx', code);
