from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .browser import REPORT_URL

SEOUL = ZoneInfo("Asia/Seoul")


def weekly_date_range(today: date | None = None) -> tuple[date, date]:
    """Return a 9-day window ending on today (D-8 to D-0) to avoid missing items
    registered 1-2 days before the nominal 7-day boundary."""
    if today is None:
        from datetime import datetime

        today = datetime.now(SEOUL).date()
    return today - timedelta(days=8), today


def daily_date(today: date | None = None) -> date:
    """보고서 기준 전일(D-1) — 당일 입력 건은 보고서에 반영되지 않는다."""
    if today is None:
        from datetime import datetime

        today = datetime.now(SEOUL).date()
    return today - timedelta(days=1)


def download_report_xlsx(*, destination: Path, start_date: date, end_date: date, headed: bool = False) -> Path:
    """Download the public report once after setting its visible date range.

    No login, server-side item filter, pagination, raw-response extraction, or retry
    loop is used. The public report's own Excel export remains the source of truth.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError("collection requires playwright; install project dependencies first") from error

    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"opening report index: {REPORT_URL}", flush=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not headed)
        # 서버(리눅스)에서도 한국 PC와 같은 화면이 나오도록 언어·시간대를 맞춘다
        index = browser.new_page(locale="ko-KR", timezone_id="Asia/Seoul")
        index.goto(REPORT_URL, wait_until="networkidle", timeout=90_000)
        print("opening report detail", flush=True)
        index.locator("#mf_wfm_container_btnS0001").click()
        report_link = index.locator("#mf_wfm_container_reptLst_0_reptNm")
        report_link.wait_for(state="visible", timeout=30_000)
        with index.expect_popup(timeout=30_000) as popup_info:
            report_link.click()
        report = popup_info.value
        report.wait_for_load_state("domcontentloaded", timeout=60_000)
        print(f"setting date range: {start_date} to {end_date}", flush=True)
        date_inputs = report.locator("#mf_popupCnts_genTd1 input[type=text]")
        date_inputs.nth(0).fill(start_date.strftime("%Y/%m/%d"))
        date_inputs.nth(0).press("Tab")
        date_inputs.nth(1).fill(end_date.strftime("%Y/%m/%d"))
        date_inputs.nth(1).press("Tab")
        print("submitting report search", flush=True)
        # MicroStrategy/WebSquare may close this popup and open a new result popup
        # after search. Register a page listener before clicking to capture it.
        ctx = report.context
        new_pages: list = []
        ctx.on("page", lambda p: new_pages.append(p))
        # WebSquare keeps an internal request pending during this action. Dispatch
        # the same DOM click event, then wait on the export control below instead.
        report.locator("#mf_popupCnts_btnS0001").dispatch_event("click")
        # Allow time for a result popup to open (if the framework opens one)
        report.wait_for_timeout(4_000)
        if new_pages:
            result_page = new_pages[-1]
            print(f"result opened in new popup: {result_page.url}", flush=True)
            result_page.wait_for_load_state("domcontentloaded", timeout=60_000)
        else:
            result_page = report
        print("waiting for Excel export button", flush=True)
        # Wait for hide class to be removed (report data loaded)
        result_page.wait_for_selector("#mf_popupCnts_btnExcelDown:not(.hide)", timeout=120_000)
        # Press Escape to close any open calendar popup before clicking Excel
        result_page.keyboard.press("Escape")
        result_page.wait_for_timeout(500)

        # MicroStrategy returns the Excel file as a navigation to /portal/servlet/mstrWeb.
        # Playwright treats this as a page load, not a download event.
        # Intercept the route at context level (before any click) to capture the body.
        mstrweb_captures: list[bytes] = []

        def _capture_mstrweb(route, request) -> None:
            try:
                resp = route.fetch()
                body = resp.body()
                ct = resp.headers.get("content-type", "").lower()
                cd = resp.headers.get("content-disposition", "").lower()
                print(f"  mstrWeb: {len(body):,} bytes  ct={ct[:60]}", flush=True)
                # XLSX is a ZIP file; its magic bytes are b"PK". Use this to detect
                # the actual Excel export and skip the HTML report-result page.
                is_excel = (
                    (body[:2] == b"PK" and len(body) > 1_000)
                    or any(k in ct for k in ("sheet", "excel", "xlsx"))
                    or "attachment" in cd
                )
                if is_excel:
                    print("  → captured as Excel", flush=True)
                    mstrweb_captures.append(body)
                route.fulfill(response=resp)
            except Exception as exc:
                print(f"  mstrWeb intercept error: {exc}", flush=True)
                route.continue_()

        ctx.route("**/portal/servlet/mstrWeb**", _capture_mstrweb)

        # Also catch normal Playwright download events (belt-and-suspenders)
        captured_dl: list = []
        mstr_pages: list = []

        def _on_new_page_dl(pg) -> None:
            pg.on("download", lambda d: captured_dl.append(d))
            mstr_pages.append(pg)
            print(f"  new page: {pg.url[:80]}", flush=True)

        ctx.on("page", _on_new_page_dl)
        result_page.on("download", lambda d: captured_dl.append(d))

        print("downloading Excel export", flush=True)
        excel_button = result_page.locator("#mf_popupCnts_btnExcelDown")
        # Try a real pointer click first; fall back to dispatch_event if modal blocks it
        try:
            excel_button.click(timeout=3_000)
        except Exception:
            excel_button.dispatch_event("click")

        # Wait for MicroStrategy result page to load, then interact with it
        result_page.wait_for_timeout(6_000)

        # Find the mstrWeb page among opened pages
        mstr_pg = next(
            (p for p in ctx.pages if "mstrWeb" in p.url or "portal" in p.url),
            None,
        )
        if mstr_pg:
            try:
                mstr_pg.wait_for_load_state("domcontentloaded", timeout=30_000)
            except Exception:
                pass
            # The mstrWeb page is MicroStrategy's export options dialog.
            # Select "포맷된 Excel" (Formatted Excel) then submit the form.
            print("  selecting 포맷된 Excel format", flush=True)
            mstr_pg.locator("#exportFormatGrids_excelFormattingGridsIServer").check()

            # Find the OK/확인 submit button; fall back to form.submit()
            # Add response listener on mstrWeb page to catch the Excel download
            def _mstr_pg_response(resp) -> None:
                ct = resp.headers.get("content-type", "").lower()
                cd = resp.headers.get("content-disposition", "").lower()
                try:
                    body = resp.body()
                except Exception:
                    return
                print(f"  mstrPg resp: {resp.url[-50:]}  {len(body):,}B  ct={ct[:40]}", flush=True)
                is_excel = (
                    (body[:2] == b"PK" and len(body) > 1_000)
                    or any(k in ct for k in ("sheet", "excel", "xlsx"))
                    or "attachment" in cd
                )
                if is_excel:
                    print("  → captured Excel from mstrPg response", flush=True)
                    mstrweb_captures.append(body)

            mstr_pg.on("response", _mstr_pg_response)
            # Check for new pages opened by the export (window.open)
            mstr_pg.on(
                "popup",
                lambda p: (
                    p.on("response", _mstr_pg_response),
                    p.on("download", lambda d: captured_dl.append(d)),
                ),
            )

            # Log ALL requests from this page to understand what happens after clicking
            export_posts: list = []

            def _mstr_req(req) -> None:
                if req.method == "POST" and "mstrWeb" in req.url:
                    export_posts.append(req.url)
                if req.resource_type in ("document", "xhr", "fetch", "other"):
                    print(f"  mstrPg req: {req.method} {req.url[-70:]}", flush=True)

            mstr_pg.on("request", _mstr_req)

            # Step 1: Dismiss the MicroStrategy message box overlay (id='ok' button).
            # This unblocks the export form underneath.
            msg_ok = mstr_pg.locator("#ok")
            if msg_ok.count() and msg_ok.is_visible():
                print("  dismissing mstrWeb message box", flush=True)
                msg_ok.click(force=True)
                mstr_pg.wait_for_timeout(500)

            # Step 2: Select 포맷된 Excel (Formatted Excel) format
            print("  selecting 포맷된 Excel format", flush=True)
            mstr_pg.locator("#exportFormatGrids_excelFormattingGridsIServer").check()

            # Step 3: Click '내보내기' (id='3131') — this submits the export form via
            # disableButtonAndSubmit('3131', 'PreferenceForm') onclick handler.
            print("  clicking 내보내기 button", flush=True)
            export_btn = mstr_pg.locator("#\\33 131")  # CSS escaping for numeric id
            if export_btn.count() == 0:
                # Fallback: find by value text
                export_btn = mstr_pg.locator("input[value='내보내기']")
            if export_btn.count():
                export_btn.click(force=True)
                # 클릭이 폼 제출로 이어지지 않는 환경이 있어, 잠시 뒤에도 요청이 없으면 제출 함수를 직접 부른다
                mstr_pg.wait_for_timeout(8_000)
                if not export_posts and not mstrweb_captures and not captured_dl:
                    print("  export click did not submit, calling disableButtonAndSubmit", flush=True)
                    mstr_pg.evaluate("""
                        () => {
                            if (typeof disableButtonAndSubmit === 'function') disableButtonAndSubmit('3131', 'PreferenceForm');
                            else { const f = document.forms['PreferenceForm']; if (f) f.submit(); }
                        }
                    """)
            else:
                # Last resort: call the onclick handler directly
                mstr_pg.evaluate("""
                    () => {
                        const btn = document.getElementById('3131');
                        if (btn) btn.click();
                        else if (typeof disableButtonAndSubmit === 'function')
                            disableButtonAndSubmit('3131', 'PreferenceForm');
                    }
                """)

        # Poll for the actual Excel file (PK magic bytes) for up to 90 s
        for tick in range(90):
            if mstrweb_captures or captured_dl:
                break
            if tick % 15 == 14:
                print(f"  waiting for Excel file… tick={tick + 1}", flush=True)
            result_page.wait_for_timeout(1_000)

        if captured_dl:
            captured_dl[0].save_as(destination)
        elif mstrweb_captures:
            destination.write_bytes(max(mstrweb_captures, key=len))
        else:
            # 원인 확인용으로 열린 화면들을 남긴다
            for i, pg in enumerate(ctx.pages):
                try:
                    pg.screenshot(path=str(destination.parent / f"export_fail_{i}.png"), full_page=True)
                except Exception:
                    pass
            raise RuntimeError("Excel export did not complete within 90 seconds")
        browser.close()
    return destination
