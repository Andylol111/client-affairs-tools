"""When Apify runs after an HTML crawl. From backend/: python3 tests/test_discovery_policy.py"""
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.discovery_policy import should_run_linkedin  # noqa: E402


def test_user_url_always() -> None:
    assert should_run_linkedin(user_url="https://linkedin.com/company/acme", has_token=True, domain_hits=40)
    assert should_run_linkedin(user_url="https://linkedin.com/company/acme", has_token=False, domain_hits=40)


def test_no_token_no_guess() -> None:
    assert not should_run_linkedin(user_url="", has_token=False, domain_hits=0)


def test_guess_only_when_thin() -> None:
    assert should_run_linkedin(user_url="", has_token=True, domain_hits=2)
    assert not should_run_linkedin(user_url="", has_token=True, domain_hits=8)
    assert not should_run_linkedin(user_url="", has_token=True, domain_hits=20)


if __name__ == "__main__":
    test_user_url_always()
    test_no_token_no_guess()
    test_guess_only_when_thin()
    print("ok")
