import sys
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Dict, Optional

# Mocking the missing interfaces for the standalone script
class TradingMode(StrEnum):
    LIVE = "live"
    SIMULATION = "simulation"
    DRY_RUN = "dry_run"

class Settings:
    mode = TradingMode.LIVE
    robinhood_username = None
    robinhood_password = None

settings = Settings()

class OrderStatus(StrEnum):
    PENDING = "pending"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"

class OrderType(StrEnum):
    BUY = "buy"
    SELL = "sell"

@dataclass
class Order:
    id: str
    symbol: str
    order_type: OrderType
    quantity: float
    price: float
    status: OrderStatus
    timestamp: datetime
    platform: str

@dataclass
class Portfolio:
    cash_balance: float
    positions: Dict[str, int]
    timestamp: datetime

class TradingPlatform:
    pass

import robin_stocks.robinhood as robinhood

class TokenType(StrEnum):
    BEARER = "Bearer"

class Scope(StrEnum):
    INTERNAL = "internal"

@dataclass
class AuthenticatedResponse:
    access_token: str
    expires_in: int
    token_type: str
    scope: str
    refresh_token: str
    backup_code: Optional[str] = None
    detail: Optional[str] = None
    mfa_code: Optional[str] = None
    user_uuid: Optional[str] = None
    expires: datetime = field(init=False)
    token: TokenType = field(init=False)
    scope_obj: Scope = field(init=False)

    def __post_init__(self) -> None:
        self.expires = datetime.now() + timedelta(seconds=self.expires_in)
        self.token = TokenType(self.token_type)
        self.scope_obj = Scope(self.scope)

class RobinhoodPlatform(TradingPlatform):
    def __init__(
        self,
        username: Optional[str] = None,
        password: Optional[str] = None,
    ) -> None:
        self.username = username or settings.robinhood_username
        self.password = password or settings.robinhood_password
        self._authenticated = None
        self.logger = logging.getLogger(__name__)

        self._sim_cash_balance = 10000.0
        self._sim_positions = {}
        self._sim_orders = {}

    def authenticate(self) -> bool:
        if self._authenticated:
            return True
        if not self.username or not self.password:
            self.logger.error("Robinhood credentials not provided")
            return False

        obj = robinhood.authentication.login(self.username, self.password)
        if isinstance(obj, dict):
            self._authenticated = AuthenticatedResponse(**obj)
            self.logger.info("Authenticated with Robinhood API")
        else:
            self.logger.error(f"Robinhood authentication failed: no access token (obj: {obj})")
        return self._authenticated is not None

    def get_portfolio(self) -> Portfolio:
        if settings.mode in (TradingMode.SIMULATION,):
            return Portfolio(
                cash_balance=self._sim_cash_balance,
                positions=self._sim_positions.copy(),
                timestamp=datetime.now(),
            )
        if not self._authenticated:
            raise Exception("Not authenticated with Robinhood")

        account = robinhood.profiles.load_account_profile()
        cash_balance = float(account["buying_power"])
        positions_data = robinhood.account.build_holdings()
        positions = {}
        for symbol, info in positions_data.items():
            qty = int(float(info.get("quantity", 0)))
            positions[symbol] = qty
        return Portfolio(
            cash_balance=cash_balance,
            positions=positions,
            timestamp=datetime.now(),
        )

    def place_order(
        self,
        symbol: str,
        order_type: OrderType,
        quantity: int,
        price: float,
        meta = None,
    ) -> Order:
        if settings.mode in (TradingMode.DRY_RUN, TradingMode.SIMULATION):
            raise RuntimeError("place_order should not be called in DRY_RUN/SIMULATION mode")
        if not self._authenticated:
            raise Exception("Not authenticated with Robinhood")
        order_id = str(uuid.uuid4())
        try:
            if order_type == OrderType.BUY:
                if price > 0:
                    order_raw = robinhood.orders.order_buy_limit(symbol, quantity, price)
                else:
                    order_raw = robinhood.orders.order_buy_market(symbol, quantity)
            else:
                if price > 0:
                    order_raw = robinhood.orders.order_sell_limit(symbol, quantity, price)
                else:
                    order_raw = robinhood.orders.order_sell_market(symbol, quantity)
        except Exception as exc:
            self.logger.error(
                f"Failed to place {order_type.value} order for {symbol}: {exc}"
            )
            raise
            
        if "detail" in order_raw:
            raise Exception(order_raw["detail"])
            
        order = Order(
            id=order_raw.get("id", order_id),
            symbol=symbol,
            order_type=order_type,
            quantity=float(order_raw.get("quantity", quantity)),
            price=float(order_raw.get("price", price or 0.0)),
            status=RobinhoodPlatform._convert_state_to_status(order_raw.get("state", "unconfirmed")),
            timestamp=datetime.now(),
            platform="robinhood",
        )
        self._sim_orders[order_id] = order
        return order

    def cancel_order(self, order_id: str) -> bool:
        if settings.mode in (TradingMode.DRY_RUN, TradingMode.SIMULATION):
            order = self._sim_orders.get(order_id)
            if not order:
                self.logger.error(f"Sim order {order_id} not found")
                return False
            if order.status in (OrderStatus.FILLED, OrderStatus.CANCELLED):
                return False
            order.status = OrderStatus.CANCELLED
            return True
        if not self._authenticated:
            raise RuntimeError("Not authenticated with Robinhood")
        self.logger.warning(
            "Cancel order remote operation not yet implemented; returning False"
        )
        return False

    def get_order_status(self, order_id: str) -> Order:
        if settings.mode in (TradingMode.DRY_RUN, TradingMode.SIMULATION):
            order = self._sim_orders.get(order_id)
            if order:
                return order
            raise Exception(f"Simulated order {order_id} not found")
        if not self._authenticated:
            raise Exception("Not authenticated with Robinhood")
        order = robinhood.orders.get_stock_order_info(order_id)
        return Order(
            id=order["id"],
            symbol="????",
            order_type=OrderType(order["side"]),
            quantity=float(order["quantity"]),
            price=float(order["price"]),
            status=RobinhoodPlatform._convert_state_to_status(order["state"]),
            timestamp=datetime.now(),
            platform="robinhood",
        )

    @staticmethod
    def _convert_state_to_status(state: str) -> OrderStatus:
        mapping = {
            "unconfirmed": OrderStatus.PENDING,
        }
        return mapping.get(state, OrderStatus.PENDING)

def main():
    try:
        input_data = sys.stdin.read()
        if not input_data:
            return
        req = json.loads(input_data)
        
        action = req.get("action")
        username = req.get("username")
        password = req.get("password")
        
        if not username or not password:
            print(json.dumps({"error": "Username and password required"}))
            return
            
        platform = RobinhoodPlatform(username=username, password=password)
        if not platform.authenticate():
            print(json.dumps({"error": "Authentication failed"}))
            return
            
        if action == "balance":
            portfolio = platform.get_portfolio()
            print(json.dumps({"success": True, "balance": portfolio.cash_balance}))
            
        elif action == "trade":
            symbol = req.get("symbol")
            quantity = int(req.get("quantity"))
            price = req.get("price")
            side = req.get("side")
            
            order_type = OrderType.BUY if side == "buy" else OrderType.SELL
            
            order = platform.place_order(symbol=symbol, order_type=order_type, quantity=quantity, price=float(price) if price else 0.0)
            print(json.dumps({"success": True, "order": {"id": order.id, "status": order.status.value}}))
            
        else:
            print(json.dumps({"error": f"Unknown action: {action}"}))
            
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
