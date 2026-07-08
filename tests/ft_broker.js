/**
 * Functional Test (FT) for Broker Connection and Balance/PL Endpoint.
 * 
 * Instructions:
 * 1. Ensure the server is running (e.g. `npm run dev` on port 3000).
 * 2. To test live connections, set the following environment variables:
 *    - ROBINHOOD_TOKEN (for Robinhood test)
 *    - IBKR_GATEWAY_URL (for IBKR test)
 * 3. Run: `node test_broker_ft.js`
 */

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runTests() {
  console.log('==================================================');
  console.log('RUNNING BROKER CONNECTION FUNCTIONAL TESTS');
  console.log('==================================================');

  // Test 1: Simulated Mode (No Brokerage)
  try {
    console.log('\n[TEST] 1. Fetching simulated balance...');
    const res = await fetch(`${BASE_URL}/api/broker/balance?brokerage=none`);
    
    if (!res.ok) {
      throw new Error(`Endpoint returned status ${res.status}`);
    }

    const data = await res.json();
    console.log('Response:', data);

    if (data.balance === undefined || data.pnl === undefined || data.pnlPercent === undefined) {
      throw new Error('Response is missing required keys: balance, pnl, or pnlPercent');
    }

    console.log('✅ Simulated Mode test passed successfully!');
  } catch (error) {
    console.error('❌ Simulated Mode test failed:', error.message);
    process.exitCode = 1;
  }

  // Test 2: Robinhood Integration
  const rhToken = process.env.ROBINHOOD_TOKEN;
  if (rhToken) {
    try {
      console.log('\n[TEST] 2. Fetching live Robinhood balance...');
      const res = await fetch(`${BASE_URL}/api/broker/balance?brokerage=robinhood`, {
        headers: {
          'x-robinhood-token': rhToken
        }
      });

      if (!res.ok) {
        throw new Error(`Endpoint returned status ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      console.log('Response:', data);

      if (typeof data.balance !== 'number' || typeof data.pnl !== 'number' || typeof data.pnlPercent !== 'number') {
        throw new Error('Response has invalid types for balance, pnl, or pnlPercent');
      }

      console.log('✅ Robinhood live test passed successfully!');
    } catch (error) {
      console.error('❌ Robinhood live test failed:', error.message);
      process.exitCode = 1;
    }
  } else {
    console.log('\n[SKIP] 2. Robinhood live test (ROBINHOOD_TOKEN env variable not set)');
  }

  // Test 3: Interactive Brokers Integration
  const ibkrUrl = process.env.IBKR_GATEWAY_URL;
  if (ibkrUrl) {
    try {
      console.log('\n[TEST] 3. Fetching live IBKR balance...');
      const res = await fetch(`${BASE_URL}/api/broker/balance?brokerage=interactivebrokers`, {
        headers: {
          'x-ibkr-url': ibkrUrl
        }
      });

      if (!res.ok) {
        throw new Error(`Endpoint returned status ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      console.log('Response:', data);

      if (typeof data.balance !== 'number' || typeof data.pnl !== 'number' || typeof data.pnlPercent !== 'number') {
        throw new Error('Response has invalid types for balance, pnl, or pnlPercent');
      }

      console.log('✅ IBKR live test passed successfully!');
    } catch (error) {
      console.error('❌ IBKR live test failed:', error.message);
      process.exitCode = 1;
    }
  } else {
    console.log('\n[SKIP] 3. IBKR live test (IBKR_GATEWAY_URL env variable not set)');
  }

  console.log('\n==================================================');
  if (process.exitCode === 1) {
    console.log('FAILED: Some tests failed.');
  } else {
    console.log('SUCCESS: All tests completed successfully!');
  }
  console.log('==================================================');
}

runTests();
