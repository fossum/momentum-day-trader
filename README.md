# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/ebb825e0-d58e-4b6d-b706-1ca47c3b3065

## Run Locally

**Prerequisites:** Node.js

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   - Copy `.env.example` to create a `.env` file:
     ```bash
     cp .env.example .env
     ```
   - Open `.env` and fill in the following variables:
     * **`GEMINI_API_KEY`**: Obtain a free API key from [Google AI Studio](https://aistudio.google.com/).
     * **`FMP_API_KEY`**: Obtain a free API key from [Financial Modeling Prep](https://site.financialmodelingprep.com/developer/docs).

3. **Run the app:**
   ```bash
   npm run dev
   ```

## Firestore Database Configuration

This application caches Gemini News Sentiment Analysis globally in Firestore. Make sure to apply the security rules configured in `firestore.rules` to your Firebase project.

Specifically, the rules allow authenticated users to read and write to the global `newsSentiment` collection:
```javascript
match /newsSentiment/{newsId} {
  allow read: if request.auth != null;
  allow create, update: if request.auth != null
    && newsId is string && newsId.size() <= 128 && newsId.matches('^[a-zA-Z0-9_\\-]+$')
    && request.resource.data.ticker is string
    && request.resource.data.headline is string
    && request.resource.data.isPositive is bool
    && request.resource.data.reason is string
    && (request.resource.data.timestamp == request.time || request.resource.data.timestamp == null);
}
```

