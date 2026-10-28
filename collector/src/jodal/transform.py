from __future__ import annotations

from datetime import date, datetime
from typing import Any, Iterable

from .contracts import ItemRecord, make_row_hash, utc_now

HEADER_MAP = {
    "입력일자": "input_date",
    "상품모델명": "product_model_name",
    "물품분류번호": "classification_code",
    "품명": "item_name",
    "물품식별번호": "item_id",
    "품목": "item_specification",
    "세부물품분류번호": "detail_classification_code",
    "세부품명": "detail_item_name",
    "제조업체명": "manufacturer_name",
}


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    result = " ".join(str(value).split())
    return result or None


def _keyword_form(value: str) -> str:
    return "".join(value.split()).casefold()


def _parse_input_date(value: Any):
    value = _clean(value)
    if not value:
        return None
    for pattern in ("%Y%m%d", "%Y-%m-%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(value, pattern).date()
        except ValueError:
            continue
    raise ValueError(f"unsupported 입력일자: {value}")


def normalize_row(
    raw: dict[str, Any], *, matched_keywords: tuple[str, ...] = (), collected_at: str | None = None
) -> ItemRecord:
    values = {target: _clean(raw.get(source)) for source, target in HEADER_MAP.items()}
    input_date = _parse_input_date(values.pop("input_date"))
    hash_values = {**values, "input_date": input_date.isoformat() if input_date else None}
    row_hash = make_row_hash(hash_values if hash_values["item_id"] else raw)
    return ItemRecord(
        input_date=input_date,
        product_model_name=values["product_model_name"],
        classification_code=values["classification_code"],
        item_name=values["item_name"],
        item_id=values["item_id"],
        item_specification=values["item_specification"],
        detail_classification_code=values["detail_classification_code"],
        detail_item_name=values["detail_item_name"],
        manufacturer_name=values["manufacturer_name"],
        matched_keywords=matched_keywords,
        raw_fields=dict(raw),
        source_row_hash=row_hash,
        collected_at=collected_at or utc_now(),
    )


def filter_and_deduplicate(
    rows: Iterable[dict[str, Any]], classification_code: str, keywords: tuple[str, ...] = ()
) -> list[ItemRecord]:
    seen: set[str] = set()
    records: list[ItemRecord] = []
    for raw in rows:
        item_text = _keyword_form(_clean(raw.get("품목")) or _clean(raw.get("품목명")) or "")
        matched = tuple(keyword for keyword in keywords if _keyword_form(keyword) in item_text)
        record = normalize_row(raw, matched_keywords=matched)
        if (
            record.classification_code != classification_code
            or (keywords and not matched)
            or record.source_row_hash in seen
        ):
            continue
        seen.add(record.source_row_hash)
        records.append(record)
    return records


_NEEDS_REVIEW = "수기 확인 필요"


def classify_by_product(
    records: list[ItemRecord],
    products: list,  # list[ProductClassifier] – duck-typed to avoid circular import
    *,
    damo_competitors: list[str] | None = None,
) -> tuple[dict[str, list[ItemRecord]], dict[tuple[str, str], str]]:
    """제품(WAPPLES/D.AMO/iSIGN) 분류: 물품분류번호 매칭(1차) AND (키워드 매칭 OR D.AMO 경쟁사명 매칭, 2차).

    iSIGN/WAPPLES의 과거 레퍼런스 검증 데이터는 이 함수가 아니라 별도의 백필로 품목 데이터에
    직접 삽입되며(레퍼런스 파일 값 그대로), 이 함수는 레퍼런스에 없는 신규 항목(예: 9월 이후)을
    분류코드+키워드 시스템으로 탐색하는 역할만 한다.

    - D.AMO: 경쟁사명은 회사명 매칭만으로는 근거가 약하므로(예: "펜타시큐리티"는 자사 WAPPLES에도
      해당) 물품분류번호 매칭을 함께 요구한다.
    - 어느 것도 해당 없으면 "기타" 버킷.

    반환: (제품별 레코드 버킷, (물품식별번호, 제품명) -> 세부분류)
    """
    damo_competitors = damo_competitors or []

    buckets: dict[str, list[ItemRecord]] = {p.name: [] for p in products}
    buckets["기타"] = []
    detail_by_key: dict[tuple[str, str], str] = {}

    for record in records:
        matched_any = False
        text = _keyword_form(record.item_specification or "")
        mfr = record.manufacturer_name or ""
        item_id = record.item_id or ""
        for product in products:
            code_match = bool(record.classification_code and record.classification_code in set(product.codes))
            if not code_match:
                continue

            company_ref_match = product.name == "D.AMO" and any(c in mfr for c in damo_competitors)
            matched_keywords = [kw for kw in product.keywords if _keyword_form(kw) in text]
            if not company_ref_match and not matched_keywords:
                continue

            buckets[product.name].append(record)
            matched_any = True
            if product.name == "iSIGN":  # iSIGN은 정해진 8개 세부분류 중 하나로 (키워드 나열 X)
                from .reference import isign_category_for

                detail_by_key[(item_id, product.name)] = isign_category_for(
                    item_id, matched_keywords, record.item_specification or ""
                )
            else:
                detail_by_key[(item_id, product.name)] = ", ".join(matched_keywords)
        if not matched_any:
            buckets["기타"].append(record)

    return buckets, detail_by_key


def filter_by_classification_names(
    rows: Iterable[dict[str, Any]],
    names: tuple[str, ...],
    *,
    codes: tuple[str, ...] = (),
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[ItemRecord]:
    """품명(물품분류명) 또는 물품분류번호 일치 + 선택적 날짜 범위 필터 후 중복 제거."""
    target_names = set(names)
    target_codes = set(codes)
    seen: set[str] = set()
    records: list[ItemRecord] = []
    for raw in rows:
        record = normalize_row(raw)
        name_match = record.item_name in target_names
        code_match = bool(target_codes and record.classification_code in target_codes)
        if not (name_match or code_match):
            continue
        if date_from is not None and (record.input_date is None or record.input_date < date_from):
            continue
        if date_to is not None and (record.input_date is None or record.input_date > date_to):
            continue
        if record.source_row_hash in seen:
            continue
        seen.add(record.source_row_hash)
        records.append(record)
    return records
