import time
import uuid
import logging
from typing import Dict
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from apps.api.core.logger import setup_logger

logger = setup_logger(__name__)

class RateLimiter:
    """In-memory Token Bucket rate limiter per IP/Client."""
    def __init__(self, rate: int, capacity: int):
        self.rate = rate          # Tokens added per second
        self.capacity = capacity  # Max burst tokens
        self.clients: Dict[str, dict] = {}

    def allow_request(self, client_id: str) -> bool:
        now = time.time()
        if client_id not in self.clients:
            self.clients[client_id] = {"tokens": self.capacity, "last_updated": now}
            
        client = self.clients[client_id]
        time_passed = now - client["last_updated"]
        
        # Add tokens based on time passed
        client["tokens"] = min(self.capacity, client["tokens"] + time_passed * self.rate)
        client["last_updated"] = now
        
        if client["tokens"] >= 1:
            client["tokens"] -= 1
            return True
        return False

# Global instance: 10 requests per second, burst 50.
limiter = RateLimiter(rate=10, capacity=50)

class StructuralMiddleware(BaseHTTPMiddleware):
    """Enforces X-Request-ID tracking and Lightweight Rate Limiting."""
    async def dispatch(self, request: Request, call_next):
        # 1. Request ID tracking
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request.state.request_id = request_id

        # 2. Rate Limiting (Throttle by IP + Route specific overrides)
        client_ip = request.client.host if request.client else "127.0.0.1"
        path = request.url.path

        # Inject strict limits on computationally heavy endpoints preventing DOS bypasses
        if "corporate/dcf" in path or "corporate/diagnostic" in path:
            # Recreate specific tight limit per client per heavy route (Burst 5)
            strict_id = f"{client_ip}_{path}"
            if not getattr(limiter, f'strict_{strict_id}', None):
                setattr(limiter, f'strict_{strict_id}', RateLimiter(rate=2, capacity=5))
            specific_limiter = getattr(limiter, f'strict_{strict_id}')
            if not specific_limiter.allow_request(client_ip):
                logger.warning(f"Heavy endpoint rate limit exceeded for {client_ip} on {path}")
                return Response("Too Many Requests - Heavy Compute Throttle", status_code=429)
        else:
            if not limiter.allow_request(client_ip):
                logger.warning(f"Global rate limit exceeded for {client_ip}")
                return Response("Too Many Requests", status_code=429)

        # 3. Execution mapping
        start_time = time.time()
        try:
            response = await call_next(request)
        except Exception:
            process_time = time.time() - start_time
            logger.exception(
                "request.failed method=%s path=%s duration_ms=%.1f client_ip=%s",
                request.method,
                request.url.path,
                process_time * 1000,
                client_ip,
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": 500,
                    "duration_ms": round(process_time * 1000, 1),
                    "client_ip": client_ip,
                },
            )
            raise

        process_time = time.time() - start_time
        duration_ms = round(process_time * 1000, 1)

        log_level = logging.WARNING if process_time > 1.0 else logging.INFO
        logger.log(
            log_level,
            "request.completed method=%s path=%s status=%s duration_ms=%.1f client_ip=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            client_ip,
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
                "client_ip": client_ip,
            },
        )

        response.headers["X-Request-ID"] = request_id
        return response
