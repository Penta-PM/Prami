"""수기로 축적된 경쟁 조달 레퍼런스 데이터 로더.

환경변수 JODAL_REF_DIR 디렉터리(기밀 자료 — 저장소에 넣지 않고 제자리에서 읽는다)의 파일들을 읽어 물품식별번호/제조사 -> 세부분류 매핑을 제공한다.
- isign_categories.csv: 물품식별번호 -> iSIGN 8개 카테고리 (레퍼런스로 확인된 경쟁 제품)
- wapples_categories.csv: 물품식별번호 -> 웹방화벽/웹방화벽(SA)
- damo_competitors.txt: D.AMO 경쟁사명 목록 (물품식별번호 단위 데이터 없음, 회사명으로만 매칭)
"""

from __future__ import annotations

import csv
from pathlib import Path

from .settings import required_dir


def ref_dir() -> Path:
    """참조 자료 디렉터리 (env JODAL_REF_DIR, 필수 — 없으면 RuntimeError)."""
    return required_dir("JODAL_REF_DIR")


def load_isign_categories(path: Path | None = None) -> dict[str, str]:
    path = path or ref_dir() / "isign_categories.csv"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        return {row["물품식별번호"].strip(): row["카테고리"].strip() for row in csv.DictReader(f)}


# iSIGN 세부분류는 아래 8개만 쓴다. 이름이 세부 그룹을 정한다 (DB 트리거 items_before_write 와 같은 규칙):
# SSO → SSO, PKI → WA, OTP·생체인증·PIN·간편인증·인증서중계 → PASS, OS 로그온 → OS 로그온
ISIGN_CATEGORIES = ["SSO", "PKI", "OTP", "생체인증", "PIN", "간편인증", "인증서중계", "OS 로그온"]
# 레퍼런스 파일(isign_categories.csv)과 예전 데이터의 번호 붙은 이름 → 새 이름
ISIGN_LEGACY = {
    "01. SSO/EAM, 통합인증": "SSO",
    "02. PKI, 구간암호화/공인인증": "PKI",
    "03-1. 인증 - OTP": "OTP",
    "03-2. 인증 - 생체인증": "생체인증",
    "03-3. 인증 - PIN": "PIN",
    "03-4. 인증 - 모바일간편인증": "간편인증",
    "03-5. 인증 - 민간인증서중계": "인증서중계",
    "04. Windows OS 로그온 보안": "OS 로그온",
}
# 자동 분류 때 걸린 키워드 → iSIGN 세부분류 (products.md 의 iSIGN 키워드 기준)
_ISIGN_KEYWORD_CATEGORY = {
    "SSO": "SSO",
    "EAM": "SSO",
    "IAM": "SSO",
    "통합인증": "SSO",
    "통합계정": "SSO",
    "적응형인증": "SSO",
    "제로트러스트": "SSO",
    "PKI": "PKI",
    "공인인증": "PKI",
    "전자서명": "PKI",
    "OTP": "OTP",
    "생체인증": "생체인증",
    "FIDO": "생체인증",
    "PIN": "PIN",
    "PASS": "간편인증",
    "간편인증": "간편인증",
    "인증서중계": "인증서중계",
    "로그온": "OS 로그온",
}


def isign_category_for(item_id: str, matched_keywords: list[str], text: str = "") -> str:
    """iSIGN 신규 물품의 세부분류 — 레퍼런스에 있으면 그 값, 없으면 걸린 키워드로 정한다 (8개 중 하나 또는 "")."""
    ref = load_isign_categories().get((item_id or "").strip())
    ref = ISIGN_LEGACY.get(ref, ref)
    if ref in ISIGN_CATEGORIES:
        return ref
    t = (text or "").replace(" ", "").upper()
    if "로그온" in t:  # Windows OS 로그온 제품은 다른 키워드(OTP 등)가 같이 걸려도 04로
        return "OS 로그온"
    for kw in matched_keywords:
        cat = _ISIGN_KEYWORD_CATEGORY.get(kw.replace(" ", "").upper()) or _ISIGN_KEYWORD_CATEGORY.get(
            kw.replace(" ", "")
        )
        if cat:
            return cat
    return ""


def load_wapples_categories(path: Path | None = None) -> dict[str, str]:
    path = path or ref_dir() / "wapples_categories.csv"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        return {row["물품식별번호"].strip(): row["세부분류"].strip() for row in csv.DictReader(f)}


def load_damo_competitors(path: Path | None = None) -> list[str]:
    path = path or ref_dir() / "damo_competitors.txt"
    if not path.exists():
        return []
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
