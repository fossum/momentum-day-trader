---
name: ibkr_bracket_warning
description: "Guides agents on how to construct IBKR bracket orders, handle warning prompt auto-replies, and validate Client Portal Gateway status responses."
---

# Interactive Brokers (IBKR) Client Portal Integration Guide

When working with Interactive Brokers Client Portal API integration in this codebase, follow these rules and conventions.

## 1. Bracket Orders (OCO) Construction
To place a 3-leg bracket order (Parent BUY with two child legs for profit taker and stop loss) via the Client Portal Gateway `/v1/api/iserver/account/orders` endpoint, structure the payload array exactly as follows:

1. **Parent Leg (Buy/Entry):**
   * `side`: `"BUY"`
   * `orderType`: `"LMT"` (Limit)
   * `price`: Entry Limit Price
   * `transmit`: `false` (Prevents immediate routing until child brackets are attached)

2. **Profit Taker Leg (Sell Child):**
   * `side`: `"SELL"`
   * `orderType`: `"LMT"` (Limit)
   * `price`: Target Price
   * `parentId`: Parent's `coid`
   * `transmit`: `false`

3. **Stop Loss Leg (Sell Child):**
   * `side`: `"SELL"`
   * `orderType`: `"STP"` (Stop)
   * `price`: Stop Loss Trigger Price
   * **CRITICAL:** Use `price` for the stop trigger price instead of `auxPrice`. Using `auxPrice` will result in a Gateway validation rejection: `"Invalid order price fields"`.
   * `parentId`: Parent's `coid`
   * `transmit`: `true` (Triggers transmission of the entire bracket bundle to the exchange)

## 2. Order Warning Dialogs & Auto-Replies
The IBKR Client Portal API does not reject warnings. Instead, it returns a `200 OK` status with a confirmation payload if a constraint (e.g., price exceeds percentage threshold) is violated:

```json
[
  {
    "id": "prompt-id-uuid",
    "message": ["Price exceeds constraints..."],
    "messageIds": ["o163"],
    "messageOptions": ["Yes", "No"]
  }
]
```

* **Auto-Reply Logic:** Check the array elements. If the warning's `messageIds` are all present in the user's `approvedIbkrWarnings` preference list, the backend should automatically resolve it by POSTing `{ confirmed: true }` to `/v1/api/iserver/reply/{promptId}` in a loop.
* **Manual Confirmation Flow:** If any warning `messageId` is not whitelisted, stop automatic execution, pause the trading engine state machine, return the prompt back to the client, and show a confirmation overlay modal to let the user approve or reject.

## 3. Server-Side Response Validation
Even if the Gateway responds with a `200 OK` status, individual legs in the orders response array may have failed validation.
* Check the response array elements for any item containing `"order_status": "Failed"`.
* If found, extract the error text and throw an HTTP `500` error immediately to prevent silent failures on the client side.
