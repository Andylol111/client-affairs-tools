"""When to spend Apify after an HTML crawl. Unit-tested; used by Scraper and YUCG Find."""


def should_run_linkedin(*, user_url: str, has_token: bool, domain_hits: int, min_keep: int = 8) -> bool:
    if (user_url or "").strip():
        return True
    if not has_token:
        return False
    return domain_hits < min_keep
