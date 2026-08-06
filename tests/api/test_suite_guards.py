"""The suite's hermeticity guards, tested rather than assumed.

`tests/conftest.py` installs autouse guards that fail any test reaching the
network or the real database. Those guards are load-bearing: the statements
design states the invariant "metric computation never performs acquisition"
and names a green suite as its proof. A proof that rests on a guard nobody
tested is not a proof -- on 2026-07-29 the socket patches were found blind to
curl_cffi, which is the transport yfinance actually uses, so a test reached
the live Yahoo API while all three patches were active and reported nothing.
"""
import socket

import pytest


def test_a_socket_connection_to_a_public_host_is_refused():
    with pytest.raises(AssertionError, match="network"):
        socket.socket().connect(("example.com", 80))


def test_dns_resolution_of_a_public_host_is_refused():
    with pytest.raises(AssertionError, match="network"):
        socket.getaddrinfo("example.com", 80)


def test_a_curl_cffi_request_is_refused():
    """The hole found on 2026-07-29. curl_cffi drives libcurl through cffi and
    never touches Python's socket module, so the socket patches cannot see it.
    yfinance 1.2 uses it as its HTTP transport, which makes this the exact path
    a stray statement fetch would take."""
    curl_cffi_requests = pytest.importorskip("curl_cffi.requests")

    with pytest.raises(AssertionError, match="curl_cffi"):
        curl_cffi_requests.get("https://example.com")


def test_an_async_curl_cffi_request_is_refused():
    """The second half of the same hole, found on 2026-07-31. Curl.perform is called
    only by the sync Session; AsyncSession dispatches through AsyncCurl.add_handle and
    never calls perform, so patching perform alone still let async traffic through --
    while both the fixture comment and the ERROR-LOG entry claimed it covered "sync or
    async". Nothing in the project uses AsyncSession today; this pins the guard so that
    stays a fact about the code rather than an assumption about the library."""
    curl_cffi_requests = pytest.importorskip("curl_cffi.requests")
    asyncio = pytest.importorskip("asyncio")

    async def fetch():
        async with curl_cffi_requests.AsyncSession() as session:
            await session.get("https://example.com")

    # curl_cffi needs a selector loop; Windows defaults to the proactor one and warns.
    loop = asyncio.SelectorEventLoop()
    try:
        with pytest.raises(AssertionError, match="curl_cffi"):
            loop.run_until_complete(fetch())
    finally:
        loop.close()


def test_loopback_is_still_allowed():
    """find_available_port in apps/api/main.py probes 127.0.0.1 and must keep
    working, so the guard must not be a blanket ban."""
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    try:
        client = socket.socket()
        client.connect(listener.getsockname())
        client.close()
    finally:
        listener.close()
