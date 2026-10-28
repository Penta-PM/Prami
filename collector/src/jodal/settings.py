"""실행 환경 설정 — 환경변수 이름과 한국 시각.

필수 환경변수 (README 참고):
  COLLECTOR_DATABASE_URL  Prami Postgres 접속 주소 (search_path 는 procurement 로 맞춘다 — db.connect)
  JODAL_REF_DIR           참조 자료 디렉터리 (분류 CSV·경쟁사 목록, 기밀 — 저장소 밖)
  JODAL_CONFIG_DIR        설정 디렉터리 (filter.md·products.md, 기밀 — 저장소 밖)
선택 환경변수 (메일): JODAL_SMTP_USER · JODAL_SMTP_PASSWORD · JODAL_SMTP_HOST · JODAL_SMTP_PORT · JODAL_DASHBOARD_URL

시각: app_state 의 daily.last_run(시간대 없는 시각)·조회일자·오늘 날짜는 프로세스 TZ 와 무관하게
Asia/Seoul 로 계산한다 (zoneinfo). 운영 env 의 TZ=Asia/Seoul 은 로그·타이머용으로 함께 둔다.
"""

from __future__ import annotations

import os
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

SEOUL = ZoneInfo("Asia/Seoul")


def now_kst() -> datetime:
    """지금 한국 시각 (시간대 포함)."""
    return datetime.now(SEOUL)


def today_kst() -> date:
    return now_kst().date()


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"환경변수 {name} 이(가) 없습니다")
    return value


def required_dir(name: str) -> Path:
    """디렉터리를 가리키는 필수 환경변수 — 없거나 디렉터리가 아니면 RuntimeError."""
    path = Path(required_env(name)).expanduser()
    if not path.is_dir():
        raise RuntimeError(f"환경변수 {name} 의 디렉터리가 없습니다")
    return path


def config_dir() -> Path:
    """filter.md·products.md 가 있는 설정 디렉터리 (env JODAL_CONFIG_DIR, 필수)."""
    return required_dir("JODAL_CONFIG_DIR")
