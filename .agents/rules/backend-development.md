---
title: Backend Development Guidelines
activation: Always On
---

# Workspace Rules & Guidelines

These rules apply to all AI agents working on this `ai-studio-trader` project. Read them carefully before taking action.

## 1. Backend Server Execution & Hot-Reloading
- **The Quirk:** The backend (`server.ts`) is executed via `npm run dev` (which triggers `tsx server.ts`). **It does NOT hot-reload on save.**
- **The Action:** Whenever you modify `server.ts` or any backend-related code, the dev server must be restarted for the changes to take effect. If you need to run tests against your changes, you must either kill the existing server on port 3000 (e.g., `fuser -k 3000/tcp`) and start a temporary one, or explicitly ask the user to restart `npm run dev`.
- **Symptom:** If you modify `server.ts` (e.g., adding a new endpoint) and immediately try to hit it with `fetch` or `curl`, Vite will intercept the request, fail to find a route on the old cached backend, and serve the frontend `index.html` instead, causing JSON parse errors (like `Unexpected token '<'`).

## 2. False-Positive Lint Errors
- **The Quirk:** Because the project uses `tsx` and `vite` concurrently, the IDE linter may report `Cannot find module 'express'` or `Cannot find module 'vite'` inside `server.ts`. 
- **The Action:** These are known module resolution quirks due to `tsconfig.json` scoping. **Do not attempt to fix these specific import lint errors**; they resolve correctly at runtime.

## 3. Functional Testing
- **The Quirk:** We use standalone node scripts for functional tests (e.g., `tests/ft_pattern_detector.js`).
- **The Action:** When writing new features, write a pure JS/TS functional test in the `tests/` directory and execute it directly via `node tests/your_test.js`. Do not use heavy testing frameworks like Jest unless explicitly requested by the user.

## 4. Float vs. Shares Outstanding
- **The Quirk:** The FMP "Biggest Gainers" API does not return a stock's float.
- **The Action:** When filtering for low-float stocks, use the `sharesOutstanding` field from the FMP `/quote` endpoint as a conservative proxy for float.
