"""납품요구 행 모양과 점유율 계산 — DB 수집 경로(db.py)가 쓰는 공용 헬퍼.

납품요구 한 건을 한국어 열 이름의 행으로 만들고(deliveries.raw 와 같은 모양), 그 행들로 자사 점유율·순위를 계산한다.
"""

from __future__ import annotations

from datetime import date

_DLVR_HEADERS = [
    "납품요구일자",
    "납품요구번호",
    "납품요구변경차수",
    "수요기관",
    "수요기관유형",
    "사업명",
    "계약번호",
    "계약종류",
    "납품업체명",
    "납품업체구분",
    "납품업체소재지",
    "담당조달청",
    "물품분류코드",
    "물품분류명",
    "물품식별번호",
    "물품식별명",
    "납품기한일자",
    "계약단가",
    "단위",
    "납품수량",
    "납품금액",
    "조회일자",
    "납품요구총금액",
]


def _delivery_row(dr: dict, date_str: str) -> list:
    """납품요구 레코드(dict) + 조회일자 -> _DLVR_HEADERS 순서의 행 배열."""
    field_values = {
        "조회일자": date_str,
        "납품요구번호": dr.get("dlvrReqNo", ""),
        "납품요구변경차수": dr.get("dlvrReqChgOdr", ""),
        "납품요구일자": dr.get("dlvrReqRcptDate", ""),
        "수요기관": dr.get("dminsttNm", ""),
        "수요기관유형": dr.get("dminsttKndNm", ""),
        "사업명": dr.get("bsnNm", ""),
        "계약번호": dr.get("cntrctNo", ""),
        "계약종류": dr.get("cntrctKndNm", ""),
        "납품업체명": dr.get("corpNm", ""),
        "납품업체구분": dr.get("corpKndNm", ""),
        "납품업체소재지": dr.get("corpAddrNm", ""),
        "담당조달청": dr.get("chrgPrcrNm", ""),
        "물품분류코드": dr.get("prdctClsfcNo", ""),
        "물품분류명": dr.get("prdctClsfcNoNm", ""),
        "물품식별번호": dr.get("prdctIdntNo", ""),
        "물품식별명": dr.get("prdctIdntNoNm", ""),
        "납품기한일자": dr.get("dlvrDdlnDate", ""),
        "계약단가": dr.get("prdctUprc", ""),
        "단위": dr.get("unt", ""),
        "납품수량": dr.get("prdctQty", ""),
        "납품금액": dr.get("prdctAmt", ""),
        "납품요구총금액": dr.get("dlvrReqTotAmt", ""),
    }
    return [field_values[h] for h in _DLVR_HEADERS]


_OUR_COMPANY_MARK = "펜타시큐리티"


def _share_stats_from_delivery_rows(
    drows: list[list[str]], mfr_map: dict[str, str], as_of: date | None = None
) -> dict | None:
    """납품요구 행들을 제조사별로 합산해 자사 점유율/순위를 계산한다.
    db.market_share_stats 의 제품별 계산과 iSIGN 세부그룹 계산이 공유하는 로직.
    점유율/순위/누적매출은 "올해 1/1~as_of" 구간으로 범위를 한정한다 (경쟁사 포함 전체).
    같은 패스에서 자사 매출의 전년동기대비(YoY)도 함께 집계한다 (올해 1/1~as_of 대 작년 동일 구간)."""
    dheader = drows[0]
    try:
        did_col = dheader.index("물품식별번호")
        damt_col = dheader.index("납품금액")
        corp_col = dheader.index("납품업체명")
    except ValueError:
        return None
    ddate_col = dheader.index("납품요구일자") if "납품요구일자" in dheader else -1

    as_of = as_of or date.today()
    this_year, prev_year = as_of.year, as_of.year - 1
    cutoff = (as_of.month, as_of.day)
    year_start = date(this_year, 1, 1)

    by_company: dict[str, int] = {}
    this_year_our = 0
    prev_year_our = 0
    for row in drows[1:]:
        if len(row) <= max(did_col, damt_col, corp_col):
            continue
        pid = row[did_col].strip()
        name = mfr_map.get(pid) or row[corp_col].strip() or "미상"
        try:
            amt = int(str(row[damt_col]).replace(",", "").strip() or "0")
        except ValueError:
            amt = 0

        d = None
        if ddate_col >= 0 and len(row) > ddate_col:
            date_raw = row[ddate_col].strip()
            if len(date_raw) == 8 and date_raw.isdigit():
                try:
                    d = date(int(date_raw[:4]), int(date_raw[4:6]), int(date_raw[6:8]))
                except ValueError:
                    d = None

        # 점유율 집계는 "올해 1/1~as_of" 범위 내 거래만 포함 (날짜 불명 행은 제외)
        if d and year_start <= d <= as_of:
            by_company[name] = by_company.get(name, 0) + amt

        if d and _OUR_COMPANY_MARK in name and (d.month, d.day) <= cutoff:
            if d.year == this_year:
                this_year_our += amt
            elif d.year == prev_year:
                prev_year_our += amt

    if not any(_OUR_COMPANY_MARK in n for n in by_company):
        # 자사 실적이 0건이어도 비교 기준선으로 항상 포함
        our_name = next((n for n in mfr_map.values() if _OUR_COMPANY_MARK in n), "펜타시큐리티 (주)")
        by_company.setdefault(our_name, 0)

    total_market = sum(by_company.values())
    ranked = sorted(by_company.items(), key=lambda kv: kv[1], reverse=True)
    our_entry = next((entry for entry in ranked if _OUR_COMPANY_MARK in entry[0]), None)
    our_amount = our_entry[1] if our_entry else 0
    our_rank = (ranked.index(our_entry) + 1) if our_entry else None
    our_share = (our_amount / total_market * 100) if total_market > 0 else 0.0

    # 선두와의 격차: 우리가 1위면 2위와의 격차(양수), 아니면 1위와의 격차(음수) + 1위 업체명
    leader_gap = None
    leader_name = None
    if our_rank and total_market > 0:
        if our_rank == 1 and len(ranked) > 1:
            leader_gap = (our_amount - ranked[1][1]) / total_market * 100
        elif our_rank != 1:
            leader_name = ranked[0][0]
            leader_gap = (our_amount - ranked[0][1]) / total_market * 100

    yoy = None
    if prev_year_our > 0:
        yoy = (this_year_our - prev_year_our) / prev_year_our * 100

    return {
        "total_market": total_market,
        "our_amount": our_amount,
        "our_share": our_share,
        "our_rank": our_rank,
        "competitor_count": len(ranked),
        "ranked": ranked[:5],
        "leader_gap": leader_gap,
        "leader_name": leader_name,
        "yoy": yoy,
        "this_year_amount": this_year_our,
        "prev_year_amount": prev_year_our,
    }
