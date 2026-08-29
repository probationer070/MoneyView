from fastapi import APIRouter
from fastapi.responses import JSONResponse

from apps.api.models.schemas import APIResponse, StockPriceLookup
from apps.api.services.market_data import MarketDataService

router = APIRouter()
_mkt = MarketDataService()


@router.get("/{ticker}/price", response_model=APIResponse[StockPriceLookup])
def get_stock_price(ticker: str):
    lookup = _mkt.get_stock_price_lookup(ticker)
    payload = APIResponse(data=lookup)
    if lookup.status == "fetching":
        return JSONResponse(status_code=202, content=payload.model_dump())
    if lookup.status == "not_found":
        return JSONResponse(status_code=404, content=payload.model_dump())
    return payload
