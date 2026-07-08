import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log("Using API Key:", apiKey ? "FOUND" : "NOT FOUND");
  if (!apiKey) {
    console.error("No GEMINI_API_KEY set.");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });
  const testHeadlines = [
    { ticker: "AAPL", headline: "FDA approves apple smartwatch blood pressure monitor with outstanding clinical trial results" },
    { ticker: "AAPL", headline: "Apple misses earnings expectations and guides lower for the rest of the year" },
  ];

  const models = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];

  for (const model of models) {
    console.log(`\n=== Probing model: ${model} ===`);
    for (const item of testHeadlines) {
      console.log(`Testing Ticker: ${item.ticker} | Headline: "${item.headline}"`);
      try {
        const response = await ai.models.generateContent({
          model: model,
          contents: `Analyze the sentiment of the following news headline/catalyst for the stock symbol "${item.ticker}". Determine if the news is positive (bullish) or negative (bearish/neutral) for the stock price.

Headline: "${item.headline}"`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                isPositive: {
                  type: "BOOLEAN",
                  description: "True if the news is positive/bullish for the company, false if negative or bearish/neutral."
                },
                reason: {
                  type: "STRING",
                  description: "A short, one-sentence explanation of the sentiment decision."
                }
              },
              required: ["isPositive", "reason"]
            }
          }
        });
        console.log("SUCCESS on model", model);
        console.log("Raw Response text:", response.text);
        if (response.text) {
          const parsed = JSON.parse(response.text);
          console.log("Parsed result:", parsed);
        }
      } catch (e: any) {
        console.error(`Failed on model ${model}:`, e.message);
      }
    }
  }
}

test();
