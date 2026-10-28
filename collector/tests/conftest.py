"""수집기 테스트 공용 픽스처 — 합성 데이터만 쓴다 (실데이터·실주소·네트워크·브라우저 없음).

DB 테스트는 env COLLECTOR_TEST_DATABASE_URL 의 빈 테스트 DB 에 drizzle/*.sql 을 저널 순서로 모두 적용해 돈다.
매 세션 procurement·public 스키마를 지우고 다시 만든다 — 그래서 DB 이름에 'test' 가 없으면 거부한다.
"""

from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict

REPO = Path(__file__).resolve().parents[2]
DRIZZLE = REPO / "drizzle"
TEST_URL_ENV = "COLLECTOR_TEST_DATABASE_URL"
BREAKPOINT = "--> statement-breakpoint"

PROCUREMENT_TABLES = (
    "item_changes",
    "delivery_changes",
    "items",
    "deliveries",
    "job_runs",
    "app_state",
    "mail_recipients",
    "bid_notices",
    "bid_keywords",
)

# 합성 설정 — 실제 filter.md·products.md 와 무관한 가상 분류·제품
FILTER_MD = "물품분류명\n가상분류명\n\n물품분류번호\n99999999\n"
PRODUCTS_MD = "가상제품A\ncodes: 99999999\nkeywords: 알파\n"
PRODUCTS_MD_WITH_BETA = "가상제품A\ncodes: 99999999\nkeywords: 알파, 베타\n"

END_DATE = date(2026, 10, 27)


def apply_migrations(conn: psycopg.Connection) -> list[str]:
    journal = json.loads((DRIZZLE / "meta" / "_journal.json").read_text(encoding="utf-8"))
    tags = [entry["tag"] for entry in sorted(journal["entries"], key=lambda e: e["idx"])]
    for tag in tags:
        sql = (DRIZZLE / f"{tag}.sql").read_text(encoding="utf-8")
        for statement in sql.split(BREAKPOINT):
            if statement.strip():
                conn.execute(statement)
    return tags


@pytest.fixture(scope="session")
def database_url() -> str:
    url = os.environ.get(TEST_URL_ENV, "").strip()
    if not url:
        if os.environ.get("CI"):  # CI 에서는 DB 테스트를 건너뛴 채 녹색이 되지 않게
            pytest.fail(f"CI 에서는 {TEST_URL_ENV} 가 필요합니다")
        pytest.skip(f"{TEST_URL_ENV} 없음 — DB 테스트 건너뜀")
    if "test" not in str(conninfo_to_dict(url).get("dbname", "")):
        pytest.fail(f"안전장치: {TEST_URL_ENV} 의 DB 이름에 'test' 가 있어야 합니다 (스키마를 지우고 다시 만든다)")
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("drop schema if exists procurement cascade")
        conn.execute("drop schema if exists public cascade")
        conn.execute("create schema public")
        apply_migrations(conn)
    return url


@pytest.fixture
def config_dirs(tmp_path, monkeypatch) -> dict[str, Path]:
    """합성 JODAL_CONFIG_DIR(filter.md·products.md) + 빈 JODAL_REF_DIR."""
    config = tmp_path / "config"
    ref = tmp_path / "reference"
    config.mkdir()
    ref.mkdir()
    (config / "filter.md").write_text(FILTER_MD, encoding="utf-8")
    (config / "products.md").write_text(PRODUCTS_MD, encoding="utf-8")
    monkeypatch.setenv("JODAL_CONFIG_DIR", str(config))
    monkeypatch.setenv("JODAL_REF_DIR", str(ref))
    return {"config": config, "ref": ref}


@pytest.fixture
def db(database_url, monkeypatch):
    """깨끗한 procurement 표 + 수집기와 같은 방식(jodal.db.connect)으로 연 연결. SMTP env 는 비운다."""
    monkeypatch.setenv("COLLECTOR_DATABASE_URL", database_url)
    for name in ("JODAL_SMTP_USER", "JODAL_SMTP_PASSWORD", "JODAL_SMTP_HOST", "JODAL_SMTP_PORT", "JODAL_DASHBOARD_URL"):
        monkeypatch.delenv(name, raising=False)
    from jodal.db import connect

    conn = connect()
    conn.execute(f"truncate {', '.join(PROCUREMENT_TABLES)} restart identity cascade")
    conn.commit()
    yield conn
    conn.rollback()
    conn.close()
