"""Compliant, single-page browser inspection for the G2B report."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

REPORT_URL = "https://data.g2b.go.kr/link/AISC001_01/?reptNm=UI-ADOSAA-002R"


@dataclass(frozen=True)
class InspectionResult:
    final_url: str
    title: str
    response_urls: tuple[str, ...]


def inspect_report(*, output_dir: Path, headed: bool = True) -> InspectionResult:
    """Open once and save safe response metadata; no search or pagination occurs."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError("browser inspection requires playwright; install project dependencies first") from error
    output_dir.mkdir(parents=True, exist_ok=True)
    response_urls: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not headed)
        page = browser.new_page()

        def observe(response):
            parsed = urlparse(response.url)
            response_urls.append(f"{parsed.scheme}://{parsed.netloc}{parsed.path} [{response.status}]")

        page.on("response", observe)
        page.goto(REPORT_URL, wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_timeout(2_000)
        result = InspectionResult(page.url, page.title(), tuple(dict.fromkeys(response_urls)))
        (output_dir / "inspection.txt").write_text(
            "\n".join([f"final_url={result.final_url}", f"title={result.title}", *result.response_urls]) + "\n",
            encoding="utf-8",
        )
        browser.close()
    return result
