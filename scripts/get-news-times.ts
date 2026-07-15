import dotenv from 'dotenv';
dotenv.config();

const FMP_API_KEY = process.env.FMP_API_KEY;
if (!FMP_API_KEY) {
  console.error("Error: FMP_API_KEY is required in .env");
  process.exit(1);
}

const ticker = 'JZXN';

async function fetchNews() {
  const url = `https://financialmodelingprep.com/stable/news/stock?symbols=${ticker}&limit=20&apikey=${FMP_API_KEY}`;
  console.log(`Querying FMP news for $${ticker}...`);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const articles = await res.json();
    if (!Array.isArray(articles)) {
      console.log("No array returned:", articles);
      return;
    }
    console.log(`\nFound ${articles.length} news articles for $${ticker}:\n`);
    articles.forEach((a, index) => {
      console.log(`[${index + 1}] Title: ${a.title}`);
      console.log(`    Published Date (EST): ${a.publishedDate}`);
      console.log(`    Site: ${a.site}`);
      console.log(`    URL: ${a.url}`);
      console.log(`    Text snippet: ${a.text}`);
      console.log('-'.repeat(80));
    });
  } catch (err: any) {
    console.error("Fetch error:", err.message);
  }
}

fetchNews();
