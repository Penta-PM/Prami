"""
data.g2b.go.kr 포털에서 나라장터쇼핑몰 납품요구 물품 내역을 스크래핑.

Playwright + MicroStrategy 리포트 페이지네이션을 사용.
반환 행 dict 의 주요 키(공공데이터포털 납품요구 API 와 같은 이름):
  prdctIdntNo, prdctIdntNoNm, prdctUprc, prdctAmt, prdctQty,
  prdctClsfcNoNm, dlvrReqRcptDate, dlvrReqNo, dminsttNm
"""

from __future__ import annotations

import re
import time
from datetime import date
from typing import Any

# 42-컬럼 innerText 에서 각 필드의 인덱스 (0-based)
_COL = {
    "dlvrReqNo": 0,  # 납품요구번호
    "dlvrReqChgOdr": 1,  # 납품요구변경차수
    "dlvrReqTotAmt": 3,  # 납품요구총금액
    "dminsttNm": 4,  # 수요기관
    "dlvrReqRcptDate": 5,  # 납품요구일자
    "bsnNm": 6,  # 사업명
    "corpNm": 8,  # 납품업체명
    "prdctClsfcNo": 9,  # 물품분류코드
    "prdctClsfcNoNm": 10,  # 물품분류명
    "prdctIdntNo": 13,  # 물품식별번호
    "prdctIdntNoNm": 14,  # 물품식별명
    "dlvrDdlnDate": 15,  # 납품기한일자
    "cntrctKndNm": 16,  # 계약종류
    "cntrctNo": 17,  # 계약번호
    "dminsttKndNm": 25,  # 수요기관유형
    "corpKndNm": 27,  # 납품업체구분
    "corpAddrNm": 28,  # 납품업체소재지
    "chrgPrcrNm": 32,  # 담당조달청
    "prdctUprc": 33,  # 계약단가
    "unt": 35,  # 단위
    "prdctQty": 36,  # 납품수량
    "prdctAmt": 37,  # 납품금액
}

# MicroStrategy 리포트 ID 및 프롬프트 ID
_REPORT_ID = "18B16A834409C3C3927C48B2A66847D6"
_PID_START = "C0EA23874004DE146EFAEFAC2E6B4D34"
_PID_END = "47AD0DEF43502A2B720022AE6F2351A7"
_PID_AGENCY = "47508A154F9B68EDA94764817F67240C"
_PID_CLASS = "4023109B4458D31E87F9AFB4B632563A"
_ATTR_CLASS = "B25D326D4B717987137C4DB603804AB9"

# WAPPLES/D.AMO/ISIGN 물품분류 코드 (OR 조건으로 사용)
_DEFAULT_CLASS_CODES = [
    "43222501",  # 방화벽장치 (WAPPLES)
    "43172715",  # 방화벽장치 (WAPPLES)
    "43233205",  # 트랜잭션보안및바이러스보호소프트웨어 (WAPPLES/D.AMO)
    "43162503",  # 파일및데이터보안용소프트웨어 (WAPPLES/D.AMO)
    "43233201",  # 인증서버소프트웨어 (WAPPLES/ISIGN)
    "43231512",  # 인증관리소프트웨어 (WAPPLES/ISIGN)
    "43172799",  # 인증관리시스템 (WAPPLES/ISIGN)
    "81112203",  # 소프트웨어유지및지원서비스 (D.AMO/ISIGN)
    "81112299",  # 소프트웨어유지및지원서비스 (D.AMO/ISIGN)
]

_EXTRACT_XML_JS = """
async (answerReq) => {
    try {
        const resp = await fetch('/portal/app/getAnswerXML.json', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest'},
            body: JSON.stringify(answerReq),
            credentials: 'same-origin',
        });
        const txt = await resp.text();
        if (txt.startsWith('{')) {
            return JSON.parse(txt).xml || '';
        }
        const doc = new DOMParser().parseFromString(txt, 'text/xml');
        return doc.querySelector('xml')?.textContent || '';
    } catch(e) {
        return 'ERROR:' + e.message;
    }
}
"""

_SUBMIT_MSTR_JS = (
    """
(xml) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/portal/servlet/mstrWeb';
    form.target = 'mstrFrame';
    const params = {
        server: 'ANOLAP', port: '24952', project: 'DATAHUB',
        hiddenSections: 'path,header,footer,dockLeft,dockTop',
        promptAnswerMode: '2', reportID: '%s',
        evt: '4001', src: 'mstrWeb.4001',
        promptsAnswerXML: xml,
    };
    for (const [k, v] of Object.entries(params)) {
        const inp = document.createElement('input');
        inp.type = 'hidden'; inp.name = k; inp.value = v;
        form.appendChild(inp);
    }
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
    return 'submitted';
}
"""
    % _REPORT_ID
)


def _get_mstr_frame(popup: Any) -> Any | None:
    for frame in popup.frames:
        if "mstrWeb" in frame.url and "iframeIdle" not in frame.url:
            return frame
    return None


def _get_row_range(frame: Any) -> tuple[int, int, int]:
    """(row_from, row_to, total) 반환. 영어/한국어 둘 다 지원."""
    try:
        txt = frame.evaluate("() => document.body.innerText.slice(0, 400)")
        m = re.search(r"Data rows:\s*([\d,]+)\s*-\s*([\d,]+)\s*of\s*([\d,]+)", txt)
        if not m:
            m = re.search(r"데이터 행:\s*([\d,]+)\s*-\s*([\d,]+)[/ ]\s*([\d,]+)", txt)
        if m:
            return (
                int(m.group(1).replace(",", "")),
                int(m.group(2).replace(",", "")),
                int(m.group(3).replace(",", "")),
            )
    except Exception:
        pass
    return 0, 0, 0


def _get_total_pages(frame: Any) -> int:
    try:
        txt = frame.evaluate("() => document.body.innerText.slice(0, 400)")
        m = re.search(r"of\s*(\d+)\s*pages", txt)
        if m:
            return int(m.group(1))
    except Exception:
        pass
    return 0


def _get_total_and_pages(frame: Any) -> tuple[int, int]:
    """(total_rows, total_pages) 반환. 페이지 수는 50행 기준으로 추산."""
    _, _, total = _get_row_range(frame)
    pages = _get_total_pages(frame)
    if pages == 0 and total > 0:
        pages = (total + 49) // 50
    return total, pages


def _parse_page(frame: Any, our_ids: set[str] | None) -> tuple[list[dict], int]:
    """현재 페이지에서 행 추출. our_ids=None이면 전체 반환, 아니면 해당 물품식별번호만."""
    try:
        txt = frame.evaluate("() => document.body.innerText")
    except Exception:
        return [], 0

    matched: list[dict] = []
    counted = 0

    for line in txt.split("\n"):
        line = line.strip()
        parts = line.split("\t")
        # 데이터 행 판별:
        # - 납품요구번호: 8-20자 알파숫자 (숫자만 또는 R25TB00413852 형태)
        # - 납품요구변경차수(col1): 2자리 숫자
        # - 납품요구일자(col5): 20XXXXXX 형태 8자리
        if (
            len(parts) >= 38
            and re.match(r"^[A-Za-z0-9]{8,20}$", parts[0])
            and re.match(r"^\d{2}$", parts[1])
            and re.match(r"^20\d{6}$", parts[5])
        ):
            counted += 1
            item_id = parts[_COL["prdctIdntNo"]].strip()
            if our_ids is None or item_id in our_ids:

                def _get(key: str) -> str:
                    v = parts[_COL[key]].strip()
                    return "" if v == "\xa0" else v

                matched.append(
                    {
                        "dlvrReqNo": _get("dlvrReqNo"),
                        "dlvrReqChgOdr": _get("dlvrReqChgOdr"),
                        "dlvrReqTotAmt": _get("dlvrReqTotAmt"),
                        "dminsttNm": _get("dminsttNm"),
                        "dlvrReqRcptDate": _get("dlvrReqRcptDate"),
                        "bsnNm": _get("bsnNm"),
                        "corpNm": _get("corpNm"),
                        "prdctClsfcNo": _get("prdctClsfcNo"),
                        "prdctClsfcNoNm": _get("prdctClsfcNoNm"),
                        "prdctIdntNo": item_id,
                        "prdctIdntNoNm": _get("prdctIdntNoNm"),
                        "dlvrDdlnDate": _get("dlvrDdlnDate"),
                        "cntrctKndNm": _get("cntrctKndNm"),
                        "cntrctNo": _get("cntrctNo"),
                        "dminsttKndNm": _get("dminsttKndNm"),
                        "corpKndNm": _get("corpKndNm"),
                        "corpAddrNm": _get("corpAddrNm"),
                        "chrgPrcrNm": _get("chrgPrcrNm"),
                        "prdctUprc": _get("prdctUprc"),
                        "unt": _get("unt"),
                        "prdctQty": _get("prdctQty"),
                        "prdctAmt": _get("prdctAmt"),
                    }
                )
    return matched, counted


def _click_page(mstr: Any, target: int) -> bool:
    try:
        clicked = mstr.evaluate(
            """(t) => {
                for (const a of document.querySelectorAll('a')) {
                    if ((a.innerText || a.textContent || '').trim() === String(t)) {
                        a.click(); return true;
                    }
                }
                return false;
            }""",
            target,
        )
        return bool(clicked)
    except Exception:
        pass
    return False


def _click_next_group(mstr: Any) -> bool:
    try:
        clicked = mstr.evaluate(
            """() => {
                const NEXT = ['>', '>>', '›', '»', 'Next'];
                for (const a of document.querySelectorAll('a')) {
                    const t = (a.innerText || a.textContent || '').trim();
                    if (NEXT.includes(t)) { a.click(); return true; }
                }
                return false;
            }"""
        )
        return bool(clicked)
    except Exception:
        pass
    return False


def _get_visible_pages(mstr: Any) -> list[int]:
    try:
        return mstr.evaluate("""
            () => {
                const as = Array.from(document.querySelectorAll('a'));
                const nums = [...new Set(
                    as.map(a => (a.innerText||'').trim())
                    .filter(t => /^\\d+$/.test(t))
                    .map(Number)
                )].sort((a, b) => a - b);
                return nums;
            }
        """)
    except Exception:
        return []


def _build_answer_req(
    start_yyyymmdd: str,
    end_yyyymmdd: str,
    class_codes: list[str],
) -> dict:
    """getAnswerXML.json에 보낼 promptVal 딕셔너리 구성."""
    pv: dict[str, list[str]] = {
        _PID_START: [start_yyyymmdd],
        _PID_END: [end_yyyymmdd],
        f"filter{_PID_AGENCY}": [_PID_AGENCY],
    }
    if class_codes:
        pv[f"filter{_PID_CLASS}"] = [_PID_CLASS]
        pv[_PID_CLASS] = [f"{_ATTR_CLASS}:{c}" for c in class_codes]
    else:
        pv[f"filter{_PID_CLASS}"] = [_PID_CLASS]
    return {"objectId": _REPORT_ID, "type": 3, "promptVal": pv}


def fetch_delivery_portal(
    *,
    item_ids: set[str] | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    class_codes: list[str] | None = None,
    headed: bool = False,
    log: bool = True,
) -> list[dict[str, Any]]:
    """
    data.g2b.go.kr 포털을 Playwright로 스크래핑.
    item_ids=None이면 분류코드 필터에 매칭되는 전체 납품요구 반환.
    item_ids가 주어지면 해당 물품식별번호와 매칭되는 행만 반환.

    class_codes 가 주어지면 MicroStrategy getAnswerXML API로 분류 필터를 적용해
    결과 건수를 줄인 뒤 스캔. 기본값은 _DEFAULT_CLASS_CODES (Pentasecurity 제품군).
    class_codes=[] 이면 필터 없이 전체 스캔 (매우 느림).

    Args:
        item_ids: 필터링할 물품식별번호 집합. None이면 전체 반환.
        start_date: 조회 시작일 (기본: 당월 1일)
        end_date: 조회 종료일 (기본: 당일)
        class_codes: 물품분류 코드 목록. None이면 _DEFAULT_CLASS_CODES 사용.
        headed: True면 브라우저 UI를 보여줌 (디버깅용)
        log: True면 진행 상황을 print로 출력

    Returns:
        납품요구 행 dict 목록
    """
    from playwright.sync_api import sync_playwright

    def _log(msg: str) -> None:
        if log:
            print(msg, flush=True)

    today = date.today()
    s_date = start_date or today.replace(day=1)
    e_date = end_date or today
    codes = _DEFAULT_CLASS_CODES if class_codes is None else class_codes

    start_str = s_date.strftime("%Y%m%d")
    end_str = e_date.strftime("%Y%m%d")

    _log(f"[g2b_dlvr] 조회 기간: {start_str} ~ {end_str}, 분류코드: {codes or '(전체)'}")

    all_matched: list[dict] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not headed)
        ctx = browser.new_context(accept_downloads=True)

        page_obj = ctx.new_page()
        page_obj.goto("https://data.g2b.go.kr/", wait_until="networkidle", timeout=60_000)
        page_obj.wait_for_timeout(2_000)

        new_pages: list[Any] = []
        ctx.on("page", lambda p: new_pages.append(p))
        page_obj.locator("text=나라장터쇼핑몰 납품요구 물품 내역").first.dispatch_event("click")
        page_obj.wait_for_timeout(6_000)

        popup = new_pages[-1] if new_pages else page_obj
        try:
            popup.wait_for_load_state("networkidle", timeout=20_000)
        except Exception:
            pass
        popup.wait_for_timeout(3_000)
        popup.keyboard.press("Escape")
        popup.wait_for_timeout(500)

        if codes is not None:
            # ── API 방식: getAnswerXML.json → mstrFrame form submit ──────
            _log("[g2b_dlvr] getAnswerXML.json API로 분류 필터 적용 중...")
            answer_req = _build_answer_req(start_str, end_str, codes)
            xml = popup.evaluate(_EXTRACT_XML_JS, answer_req)

            if not xml or str(xml).startswith("ERROR"):
                _log(f"[g2b_dlvr] XML 획득 실패: {xml}. 분류 없이 재시도...")
                answer_req2 = _build_answer_req(start_str, end_str, [])
                xml = popup.evaluate(_EXTRACT_XML_JS, answer_req2)

            if not xml or str(xml).startswith("ERROR"):
                _log("[g2b_dlvr] ERROR: XML 획득 실패 — 중단")
                browser.close()
                return []

            _log("[g2b_dlvr] mstrFrame form submit...")
            popup.evaluate(_SUBMIT_MSTR_JS, xml)

            # 결과 대기 (최대 120초)
            deadline = time.time() + 120
            mstr = None
            while time.time() < deadline:
                popup.wait_for_timeout(3_000)
                for frame in popup.frames:
                    if "mstrWeb" not in frame.url:
                        continue
                    try:
                        txt = frame.evaluate("() => document.body.innerText.slice(0, 400)")
                        _, _, t = _get_row_range_from_text(txt)
                        if t > 0:
                            mstr = frame
                            break
                        if "검색된 데이터가 없" in txt or "No data" in txt:
                            _log("[g2b_dlvr] 0건 — 분류 필터 결과 없음")
                            browser.close()
                            return []
                    except Exception:
                        pass
                if mstr:
                    break
        else:
            # ── UI 방식: 날짜 입력 후 검색 버튼 ──────────────────────────
            _log("[g2b_dlvr] UI 방식으로 검색 (분류 필터 없음)...")
            _set_date_field(popup, "wq_uuid_157_ibxStrDay", s_date.strftime("%Y/%m/%d"))
            _set_date_field(popup, "wq_uuid_157_ibxEndDay", e_date.strftime("%Y/%m/%d"))

            popup.evaluate(
                "() => { const b=document.getElementById('mf_popupCnts_btnS0001'); "
                "if(b) b.classList.remove('btn-hide'); }"
            )
            try:
                popup.locator("#mf_popupCnts_btnS0001").click(timeout=5_000, force=True)
            except Exception:
                popup.locator("#mf_popupCnts_btnS0001").dispatch_event("click")
            popup.wait_for_timeout(2_000)
            for _ in range(3):
                try:
                    btn = popup.locator("button:has-text('확인'), input[value='확인']").first
                    if btn.is_visible(timeout=1_000):
                        btn.dispatch_event("click")
                        popup.wait_for_timeout(300)
                except Exception:
                    pass
            popup.wait_for_timeout(30_000)
            mstr = _get_mstr_frame(popup)

        if not mstr:
            _log("[g2b_dlvr] ERROR: MicroStrategy 프레임 없음")
            browser.close()
            return []

        total, total_pages = _get_total_and_pages(mstr)
        _log(f"[g2b_dlvr] 전체 {total:,}행 / {total_pages}페이지")

        if total == 0 or total_pages == 0:
            _log("[g2b_dlvr] 결과 없음")
            browser.close()
            return []

        t_start = time.time()
        current_page = 1

        while current_page <= total_pages:
            matched, cnt = _parse_page(mstr, item_ids)
            all_matched.extend(matched)

            if log and (current_page % 20 == 0 or matched):
                rf, rt, _ = _get_row_range(mstr)
                elapsed = time.time() - t_start
                _log(
                    f"[g2b_dlvr] 페이지 {current_page}/{total_pages} "
                    f"(rows {rf}-{rt}, {elapsed:.0f}s) 파싱={cnt} 매칭={len(matched)}"
                )

            if current_page >= total_pages:
                break

            next_page = current_page + 1
            visible = _get_visible_pages(mstr)

            if next_page in visible:
                ok = _click_page(mstr, next_page)
                if not ok:
                    _log(f"[g2b_dlvr] 페이지 {next_page} 클릭 실패. 중단.")
                    break
                popup.wait_for_timeout(2_000)
            else:
                ok = _click_next_group(mstr)
                if not ok:
                    _log("[g2b_dlvr] 그룹 이동 실패. 중단.")
                    break
                popup.wait_for_timeout(2_000)
                visible2 = _get_visible_pages(mstr)
                if next_page in visible2:
                    ok2 = _click_page(mstr, next_page)
                    if not ok2:
                        _log(f"[g2b_dlvr] 페이지 {next_page} 클릭 실패. 중단.")
                        break
                    popup.wait_for_timeout(2_000)
                else:
                    _log(f"[g2b_dlvr] 페이지 {next_page} 접근 불가 (visible: {visible2}). 중단.")
                    break

            current_page = next_page

        elapsed = time.time() - t_start
        _log(f"[g2b_dlvr] 완료: {current_page}페이지 스캔, {len(all_matched)}건 매칭 ({elapsed:.0f}초)")

        browser.close()

    # 납품요구번호 + 물품식별번호 조합으로 중복 제거 (변경차수로 인한 중복 행)
    seen: set[tuple[str, str]] = set()
    deduped: list[dict] = []
    for r in all_matched:
        key = (r["dlvrReqNo"], r["prdctIdntNo"])
        if key not in seen:
            seen.add(key)
            deduped.append(r)
    return deduped


def _get_row_range_from_text(txt: str) -> tuple[int, int, int]:
    m = re.search(r"Data rows:\s*([\d,]+)\s*-\s*([\d,]+)\s*of\s*([\d,]+)", txt)
    if not m:
        m = re.search(r"데이터 행:\s*([\d,]+)\s*-\s*([\d,]+)[/ ]\s*([\d,]+)", txt)
    if m:
        return (
            int(m.group(1).replace(",", "")),
            int(m.group(2).replace(",", "")),
            int(m.group(3).replace(",", "")),
        )
    return 0, 0, 0


def _set_date_field(popup: Any, field_id: str, value: str) -> None:
    """날짜 입력 필드에 값 설정 (YYYY/MM/DD 형식)."""
    try:
        loc = popup.locator(f"#{field_id}")
        loc.click()
        loc.select_text()
        loc.type(value, delay=50)
        popup.keyboard.press("Tab")
        popup.wait_for_timeout(200)
    except Exception:
        pass
