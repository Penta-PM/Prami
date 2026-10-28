"""jodal daily (DB 경로) — 수집·포털 부분은 합성 행으로 바꿔 끼우고 DB 기록·메일 결과만 검사한다."""

from __future__ import annotations

import json
import re
import smtplib
from datetime import date
from pathlib import Path

import pytest
from conftest import END_DATE, PRODUCTS_MD_WITH_BETA

import jodal.cli
import jodal.collector
import jodal.g2b_dlvr
from jodal.cli import _read_rows, main
from jodal.db import run_daily

SENDER = "e2e-sender@example.invalid"
RECIPIENTS = ["e2e-a@example.invalid", "e2e-b@example.invalid", "e2e-c@example.invalid"]


def _item_row(item_id: str, spec: str, day: date = END_DATE) -> dict[str, str]:
    """등록물품 리포트 엑셀 한 줄 (합성)."""
    return {
        "입력일자": day.strftime("%Y%m%d"),
        "상품모델명": f"E2E-모델-{item_id}",
        "물품분류번호": "99999999",
        "품명": "가상분류명",
        "물품식별번호": item_id,
        "품목": spec,
        "세부물품분류번호": "9999999901",
        "세부품명": "가상세부품명",
        "제조업체명": "가상제조사",
    }


ITEM_ROWS = [_item_row("E2E-0001", "가상 알파 장비"), _item_row("E2E-0002", "가상 베타 장비")]
DELIVERIES = [
    {
        "dlvrReqNo": "E2E-D-0001",
        "dlvrReqChgOdr": "00",
        "dlvrReqRcptDate": "20261020",
        "dminsttNm": "가상수요기관",
        "corpNm": "가상납품업체",
        "prdctIdntNo": "E2E-0001",
        "prdctIdntNoNm": "가상 알파 장비",
        "prdctUprc": "1,000",
        "prdctQty": "2",
        "prdctAmt": "2,000",
    }
]


class FakeSMTP:
    """smtplib.SMTP 대역 — 보낸 메시지를 모은다 (네트워크 없음)."""

    sent: list[dict] = []
    fail: Exception | None = None

    def __init__(self, host, port):
        self.host, self.port = host, port

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def ehlo(self):
        pass

    def starttls(self, context=None):
        pass

    def login(self, user, password):
        pass

    def send_message(self, msg, from_addr=None, to_addrs=None):
        if FakeSMTP.fail:
            raise FakeSMTP.fail
        FakeSMTP.sent.append({"msg": msg, "from": from_addr, "to": list(to_addrs or [])})


@pytest.fixture
def fake_portal(monkeypatch):
    """브라우저 다운로드·포털 스크래핑 대신 합성 행. 호출 횟수를 센다."""
    calls = {"download": 0, "deliveries": 0}

    def download(*, destination: Path, **_):
        calls["download"] += 1
        return destination

    def fetch(**_):
        calls["deliveries"] += 1
        return [dict(d) for d in DELIVERIES]

    monkeypatch.setattr(jodal.collector, "download_report_xlsx", download)
    monkeypatch.setattr(jodal.g2b_dlvr, "fetch_delivery_portal", fetch)
    return calls


@pytest.fixture
def fake_smtp(monkeypatch):
    FakeSMTP.sent = []
    FakeSMTP.fail = None
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    return FakeSMTP


def _smtp_env(monkeypatch):
    monkeypatch.setenv("JODAL_SMTP_USER", SENDER)
    monkeypatch.setenv("JODAL_SMTP_PASSWORD", "e2e-not-a-secret")


def _run(config_dirs, tmp_path, *, no_email=False, rows=ITEM_ROWS):
    run_daily(
        end_date=END_DATE,
        headed=False,
        no_email=no_email,
        filter_file=config_dirs["config"] / "filter.md",
        products_file=config_dirs["config"] / "products.md",
        read_rows=lambda _path: [dict(r) for r in rows],
        output_dir=tmp_path / "data",
    )


def _count(db, table: str) -> int:
    return db.execute(f"select count(*) from {table}").fetchone()[0]


def _last_summary(db) -> tuple[str, dict]:
    return db.execute("select status, summary from job_runs order by id desc limit 1").fetchone()


def _add_recipients(db, emails):
    for email in emails:
        db.execute("insert into mail_recipients (email, created_by) values (%s, 'e2e')", (email,))
    db.commit()


def test_new_items_and_deliveries_insert_is_idempotent(db, config_dirs, fake_portal, tmp_path):
    _run(config_dirs, tmp_path, no_email=True)
    first = (_count(db, "items"), _count(db, "deliveries"))
    rows = db.execute("select item_id, product, status, reviewed from items order by item_id").fetchall()
    assert rows == [("E2E-0001", "가상제품A", "active", False), ("E2E-0002", "기타", "pending", False)]
    assert first == (2, 1)

    _run(config_dirs, tmp_path, no_email=True)
    db.rollback()
    assert (_count(db, "items"), _count(db, "deliveries")) == first
    status, summary = _last_summary(db)
    assert status == "ok"
    assert summary["new_items"] == {}
    assert summary["new_deliveries"] == {}
    # 신규 INSERT 에는 이력 행이 없다
    assert _count(db, "item_changes") == 0


def test_etc_promotion_writes_one_system_history_row(db, config_dirs, fake_portal, tmp_path):
    _run(config_dirs, tmp_path, no_email=True)
    (pk,) = db.execute("select id from items where item_id = 'E2E-0002'").fetchone()
    db.rollback()

    # 다음 실행에서 키워드가 늘어 '기타' 였던 물품이 제품으로 분류된다
    (config_dirs["config"] / "products.md").write_text(PRODUCTS_MD_WITH_BETA, encoding="utf-8")
    _run(config_dirs, tmp_path, no_email=True)
    db.rollback()

    item = db.execute("select id, product, status, detail_category from items where item_id = 'E2E-0002'").fetchall()
    assert item == [(pk, "가상제품A", "active", "베타")]
    changes = db.execute("select item_pk, action, before, after, changed_by from item_changes").fetchall()
    assert changes == [
        (
            pk,
            "edit",
            {"product": "기타", "detail_category": None, "status": "pending"},
            {"product": "가상제품A", "detail_category": "베타", "status": "active"},
            "system",
        )
    ]


def test_no_recipients_does_not_send(db, config_dirs, fake_portal, fake_smtp, tmp_path, monkeypatch):
    _smtp_env(monkeypatch)
    _run(config_dirs, tmp_path)
    db.rollback()
    assert fake_smtp.sent == []
    status, summary = _last_summary(db)
    assert status == "ok"
    assert summary["mail"] == "skipped_no_recipients"
    assert summary["mail_recipient_count"] == 0


def test_smtp_unset_does_not_send(db, config_dirs, fake_portal, fake_smtp, tmp_path):
    _add_recipients(db, RECIPIENTS[:1])
    _run(config_dirs, tmp_path)
    db.rollback()
    assert fake_smtp.sent == []
    status, summary = _last_summary(db)
    assert status == "ok"
    assert summary["mail"] == "skipped_no_smtp"
    assert summary["mail_recipient_count"] == 1


def test_sends_one_message_with_all_recipients_in_bcc(db, config_dirs, fake_portal, fake_smtp, tmp_path, monkeypatch):
    _add_recipients(db, RECIPIENTS)
    _smtp_env(monkeypatch)
    _run(config_dirs, tmp_path)
    db.rollback()

    assert len(fake_smtp.sent) == 1
    sent = fake_smtp.sent[0]
    msg = sent["msg"]
    assert msg["Subject"].startswith("[Prami] ")
    assert msg["To"] == SENDER
    assert msg["From"] == SENDER
    assert [a.strip() for a in msg["Bcc"].split(",")] == RECIPIENTS
    assert sent["from"] == SENDER
    assert sent["to"] == RECIPIENTS

    status, summary = _last_summary(db)
    assert status == "ok"
    assert summary["mail"] == "sent"
    assert summary["mail_recipient_count"] == 3
    # 주소·본문은 기록하지 않는다
    assert "@" not in json.dumps(summary, ensure_ascii=False)


def test_send_failure_marks_failed_and_keeps_report_date(
    db, config_dirs, fake_portal, fake_smtp, tmp_path, monkeypatch
):
    _add_recipients(db, RECIPIENTS[:2])
    _smtp_env(monkeypatch)
    fake_smtp.fail = smtplib.SMTPRecipientsRefused({RECIPIENTS[0]: (550, b"e2e")})
    with pytest.raises(RuntimeError, match="메일 발송 실패"):
        _run(config_dirs, tmp_path)
    db.rollback()
    status, summary = _last_summary(db)
    assert status == "failed"
    assert summary["mail"] == "failed"
    assert summary["mail_recipient_count"] == 2
    assert "@" not in json.dumps(summary, ensure_ascii=False)
    # 보고 기준일은 발송 뒤에만 저장 — 실패하면 다음 실행이 빠진 기간까지 다시 보낸다
    assert db.execute("select value from app_state where key = 'daily'").fetchone() is None


def test_no_email_records_no_mail_outcome(db, config_dirs, fake_portal, fake_smtp, tmp_path, monkeypatch):
    _add_recipients(db, RECIPIENTS)
    _smtp_env(monkeypatch)
    _run(config_dirs, tmp_path, no_email=True)
    db.rollback()
    assert fake_smtp.sent == []
    status, summary = _last_summary(db)
    assert status == "ok"
    assert "mail" not in summary
    assert "mail_recipient_count" not in summary


def test_daily_app_state_matches_prami_format(db, config_dirs, fake_portal, tmp_path):
    _run(config_dirs, tmp_path, no_email=True)
    db.rollback()
    (value,) = db.execute("select value from app_state where key = 'daily'").fetchone()
    assert set(value) == {"last_end_date", "last_run"}
    # Prami collection.ts stateDay: ^\d{4}-\d{2}-\d{2}$
    assert value["last_end_date"] == END_DATE.isoformat()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", value["last_end_date"])
    # 원본 형식 그대로 시간대 없는 한국 시각
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?", value["last_run"])


def test_catch_up_period_from_last_end_date(db, config_dirs, fake_portal, tmp_path):
    from jodal.db import set_state

    set_state(db, "daily", {"last_end_date": "2026-10-22", "last_run": "2026-10-22T09:00:00"})
    db.commit()
    _run(config_dirs, tmp_path, no_email=True)
    db.rollback()
    _, summary = _last_summary(db)
    assert summary["period_start"] == "2026-10-23"
    assert summary["end_date"] == END_DATE.isoformat()


def test_skip_if_done_skips_when_already_reported(db, config_dirs, fake_portal, tmp_path, monkeypatch):
    from jodal.db import set_state

    set_state(db, "daily", {"last_end_date": END_DATE.isoformat(), "last_run": "2026-10-28T09:00:00"})
    db.commit()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(jodal.cli, "_read_rows", lambda _path: [dict(r) for r in ITEM_ROWS])
    main(["daily", "--date", END_DATE.isoformat(), "--skip-if-done", "--no-email"])
    db.rollback()
    assert fake_portal == {"download": 0, "deliveries": 0}
    assert _count(db, "job_runs") == 0

    # 아직 보고하지 않은 기준일이면 돈다
    main(["daily", "--date", "2026-10-28", "--skip-if-done", "--no-email"])
    db.rollback()
    assert fake_portal["download"] == 1
    assert _count(db, "job_runs") == 1


def test_read_rows_is_used_by_cli(tmp_path):
    """CSV 입력 읽기 (filter-export 경로가 쓰는 원본 헬퍼) — 합성 CSV."""
    path = tmp_path / "rows.csv"
    path.write_text("입력일자,물품식별번호\n20261027,E2E-0001\n", encoding="utf-8")
    assert _read_rows(path) == [{"입력일자": "20261027", "물품식별번호": "E2E-0001"}]
