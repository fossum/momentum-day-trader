import { spawn } from 'child_process';

export function runRobinhoodScript(payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const py = spawn('python3', ['robinhood_trader.py']);
    let stdout = '';
    let stderr = '';
    
    py.stdout.on('data', data => stdout += data.toString());
    py.stderr.on('data', data => stderr += data.toString());
    
    py.on('close', code => {
      try {
        const matches = stdout.match(/\{.*\}/s);
        if (!matches) {
          throw new Error("No JSON found in stdout");
        }
        const result = JSON.parse(matches[0]);
        if (result.error) reject(new Error(result.error));
        else resolve(result);
      } catch (e) {
        reject(new Error(`Failed to parse python output: ${stdout}\nStderr: ${stderr}`));
      }
    });
    
    py.stdin.write(JSON.stringify(payload));
    py.stdin.end();
  });
}
