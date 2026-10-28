"""jodal bids (DB 경로) — 포털 조회 대신 합성 공고로 bid_notices·app_state 기록만 검사한다."""

from __future__ import annotations

from datetime import datetime, timedelta

from jodal.db import load_bid_rules, sync_bids

NOTICE = {
    "공고번호": "E2E-B-0001-000",
    "관련 제품": "WAPPLES",
    "키워드": "가상키워드",
    "공고명": "E2E 가상 장비 구매",
    "업무구분": "물품",
    "공고기관": "가상공고기관",
    "수요기관": "가상수요기관",
    "공고일시": "2026-10-20 10:00",
    "입찰마감일시": "2026-11-30 10:00",
    "배정예산": "150000000",
    "추정가격": "",
    "공고상태": "일반",
    "상세URL": "https://example.invalid/bid/E2E-B-0001",
}


def test_sync_bids_is_idempotent_and_records_state(db):
    assert sync_bids([dict(NOTICE)]) == (1, 0)
    assert sync_bids([dict(NOTICE)]) == (0, 0)
    db.rollback()
    row = db.execute("select bid_no, bid_ord, products, fit_grade from bid_notices").fetchall()
    assert row == [("E2E-B-0001", "000", ["WAPPLES"], "상")]
    runs = db.execute("select job, status from job_runs order by id").fetchall()
    assert runs == [("bids", "ok"), ("bids", "ok")]


def test_bids_app_state_matches_prami_format(db):
    sync_bids([])
    db.rollback()
    (value,) = db.execute("select value from app_state where key = 'bids'").fetchone()
    assert set(value) == {"last_checked"}
    # Prami collection.ts stateDate: new Date(raw) — 시간대 포함 ISO, 한국 시각(+09:00)
    checked = datetime.fromisoformat(value["last_checked"])
    assert checked.utcoffset() == timedelta(hours=9)
    assert value["last_checked"].endswith("+09:00")


def test_load_bid_rules_sees_new_keywords(db):
    db.execute("insert into bid_keywords (product, keyword, created_by) values ('WAPPLES', '가상키워드', 'e2e')")
    db.commit()
    rules, has_new = load_bid_rules()
    assert rules.classify("E2E 가상키워드 구매") == (["WAPPLES"], ["가상키워드"])
    assert has_new is False  # 아직 확인 기록이 없으면 새 키워드로 보지 않는다 (원본과 같음)
    sync_bids([])
    db.execute("insert into bid_keywords (product, keyword, created_by) values ('iSIGN', '가상인증', 'e2e')")
    db.commit()
    assert load_bid_rules()[1] is True
