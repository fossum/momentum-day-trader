import { GoogleGenAI } from "@google/genai";

export interface SentimentResult {
  isPositive: boolean;
  reason: string;
}

/**
 * Analyzes a news headline/catalyst for a stock using Gemini to determine if it represents
 * a positive fundamental catalyst.
 */
export async function analyzeNewsSentiment(ticker: string, headline: string): Promise<SentimentResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Analyze the following news headline/catalyst for the stock symbol "${ticker}". Determine if the news represents a significant, positive (bullish) fundamental catalyst for the stock price (e.g. strong earnings beats, clinical trial progress, product/drug approvals, strategic acquisitions, major contract wins, new patents, mergers, positive revenue/guidance increases, or other high-impact news).

If the news represents a positive/bullish fundamental catalyst, return true for "isPositive". 
If the news is negative, neutral, minor, or non-impactful (technical breakout only with no news catalyst), return false for "isPositive".

Headline: "${headline}"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          isPositive: {
            type: "BOOLEAN",
            description: "True if the news is a positive/bullish fundamental catalyst for the company, false if negative, neutral, or non-impactful."
          },
          reason: {
            type: "STRING",
            description: "A short, one-sentence explanation of the catalyst decision."
          }
        },
        required: ["isPositive", "reason"]
      }
    }
  });

  if (!response.text) {
    throw new Error("No text response received from Gemini API");
  }

  const parsed = JSON.parse(response.text);
  return {
    isPositive: parsed.isPositive === true,
    reason: parsed.reason || "No reason provided."
  };
}
