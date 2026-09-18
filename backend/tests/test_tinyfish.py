"""TinyFish adapter and the TinyFish-first, Firecrawl-fallback waterfall.

TinyFish (https://www.tinyfish.ai) is layered ahead of self-hosted Firecrawl
because its own pricing page advertises residential proxies and anti-bot
handling "at the infrastructure layer" - exactly the failure mode Firecrawl
hit in production (see test_web_fetch.py's docstring and
docs/FIRECRAWL-SEARCH-EXPANSION-PLAN.md section 1.6). These tests use
httpx.MockTransport, matching the convention in test_web_fetch.py, and
never touch a network.
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('JWT_SECRET', 'tinyfish-adapter-secret-xxxxxxxxxxxxxxxx')


def tests() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        os.environ['DATABASE_URL'] = f'sqlite:///{Path(tmp) / "t.db"}'
        for mod in [m for m in list(sys.modules) if m.startswith('app.')]:
            del sys.modules[mod]

        from app.database import get_db, init_db
        from app.services import web_fetch
        from fastapi import HTTPException

        asyncio.run(init_db())

        async def seed() -> None:
            db = await get_db()
            try:
                await db.execute(
                    "INSERT INTO users (id, email, name) VALUES (1, 'a@yale.edu', 'A'), (2, 'b@yale.edu', 'B')"
                )
                await db.commit()
            finally:
                await db.close()

        asyncio.run(seed())

        real_client = httpx.AsyncClient

        def client_for(handler):
            return lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs)

        # --- Unconfigured: never raises, never calls the network ---
        os.environ.pop('TINYFISH_API_KEY', None)
        os.environ.pop('FIRECRAWL_URL', None)
        assert not web_fetch.tinyfish_configured()
        assert not web_fetch.web_search_configured()
        assert asyncio.run(web_fetch.fetch_page('https://acme.com', user_id=1)) is None
        assert asyncio.run(web_fetch.web_search('Acme CEO', user_id=1)) == []

        # web_search_configured() is true with either backend alone.
        os.environ['TINYFISH_API_KEY'] = 'tf-test-key'
        assert web_fetch.tinyfish_configured()
        assert web_fetch.web_search_configured()
        os.environ.pop('TINYFISH_API_KEY')
        os.environ['FIRECRAWL_URL'] = 'http://100.84.7.57:3002'
        assert web_fetch.web_search_configured()
        os.environ.pop('FIRECRAWL_URL')
        os.environ['TINYFISH_API_KEY'] = 'tf-test-key'

        # --- TinyFish fetch: success shape mapping ---
        def fetch_handler(request: httpx.Request) -> httpx.Response:
            assert request.headers['X-API-Key'] == 'tf-test-key'
            return httpx.Response(200, json={
                "results": [{"url": "https://acme.com", "title": "Acme", "text": "# Acme\nWe make things."}],
                "errors": [],
            })

        with patch('app.services.web_fetch.httpx.AsyncClient', client_for(fetch_handler)):
            page = asyncio.run(web_fetch.fetch_page('https://acme.com', user_id=1))
            assert page is not None
            assert page.content == '# Acme\nWe make things.'
            assert page.links == []

        # --- TinyFish fetch: no results / errors degrades to None ---
        def fetch_empty_handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"results": [], "errors": [{"url": "https://acme.com", "error": "timeout"}]})

        with patch('app.services.web_fetch.httpx.AsyncClient', client_for(fetch_empty_handler)):
            assert asyncio.run(web_fetch.fetch_page('https://acme.com', user_id=1)) is None

        # --- TinyFish search: success shape mapping (snippet -> content) ---
        def search_handler(request: httpx.Request) -> httpx.Response:
            assert request.headers['X-API-Key'] == 'tf-test-key'
            return httpx.Response(200, json={
                "query": "Acme CEO",
                "results": [
                    {"position": 1, "title": "Acme - Wikipedia", "url": "https://en.wikipedia.org/wiki/Acme", "snippet": "Acme is a company."},
                ],
                "total_results": 1,
            })

        with patch('app.services.web_fetch.httpx.AsyncClient', client_for(search_handler)):
            results = asyncio.run(web_fetch.web_search('Acme CEO', user_id=1))
            assert results == [{"title": "Acme - Wikipedia", "url": "https://en.wikipedia.org/wiki/Acme", "content": "Acme is a company."}]

        # --- A genuine empty TinyFish search result is trusted, not treated
        # as a failure - it must NOT fall through to Firecrawl. ---
        os.environ['FIRECRAWL_URL'] = 'http://100.84.7.57:3002'
        firecrawl_called = False

        def search_empty_handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"query": "hello world", "results": [], "total_results": 0})

        def firecrawl_should_not_be_called(request: httpx.Request) -> httpx.Response:
            nonlocal firecrawl_called
            firecrawl_called = True
            return httpx.Response(200, json={"data": [{"title": "should not happen", "url": "x", "description": "x"}]})

        def dispatch(request: httpx.Request) -> httpx.Response:
            if 'tinyfish' in str(request.url):
                return search_empty_handler(request)
            return firecrawl_should_not_be_called(request)

        with patch('app.services.web_fetch.httpx.AsyncClient', client_for(dispatch)):
            results = asyncio.run(web_fetch.web_search('hello world', user_id=1))
            assert results == []
            assert not firecrawl_called, 'A real empty TinyFish result must not fall through to Firecrawl'

        # --- TinyFish failure DOES fall through to Firecrawl ---
        def dispatch_fallback(request: httpx.Request) -> httpx.Response:
            if 'tinyfish' in str(request.url):
                return httpx.Response(500, json={"error": {"code": "INTERNAL_ERROR"}})
            return httpx.Response(200, json={"data": [{"title": "Firecrawl result", "url": "https://acme.com", "description": "from firecrawl"}]})

        with patch('app.services.web_fetch.httpx.AsyncClient', client_for(dispatch_fallback)):
            results = asyncio.run(web_fetch.web_search('Acme CEO', user_id=1))
            assert results == [{"title": "Firecrawl result", "url": "https://acme.com", "content": "from firecrawl"}]

        # Same fallback behavior for fetch_page.
        def dispatch_fetch_fallback(request: httpx.Request) -> httpx.Response:
            if 'tinyfish' in str(request.url):
                return httpx.Response(429, json={"error": {"code": "RATE_LIMIT_EXCEEDED"}})
            return httpx.Response(200, json={"data": {"markdown": "# from firecrawl", "links": []}})

        with patch('app.services.web_fetch.httpx.AsyncClient', client_for(dispatch_fetch_fallback)):
            page = asyncio.run(web_fetch.fetch_page('https://acme.com', user_id=1))
            assert page is not None
            assert page.content == '# from firecrawl'

        os.environ.pop('FIRECRAWL_URL')

        # --- Quota: same 15/hr/member, 120/hr club shape, mirroring
        # reserve_firecrawl_call, with TinyFish's own higher numbers as the
        # informed default. ---
        os.environ['TINYFISH_CALLS_PER_MEMBER_PER_HOUR'] = '2'
        os.environ['TINYFISH_CALLS_PER_CLUB_PER_HOUR'] = '100'

        def ok_search_handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"results": []})

        with patch('app.services.web_fetch.httpx.AsyncClient', client_for(ok_search_handler)):
            for _ in range(2):
                asyncio.run(web_fetch.web_search('q', user_id=2))
            try:
                asyncio.run(web_fetch.web_search('q', user_id=2))
                raise AssertionError('Per-member TinyFish quota did not stop the third call')
            except HTTPException as exc:
                assert exc.status_code == 429

        del os.environ['TINYFISH_CALLS_PER_MEMBER_PER_HOUR']
        del os.environ['TINYFISH_CALLS_PER_CLUB_PER_HOUR']


if __name__ == '__main__':
    tests()
    print('tinyfish adapter: ok')
