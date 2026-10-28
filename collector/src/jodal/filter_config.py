from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple


@dataclass(frozen=True)
class ItemClassificationFilter:
    """A G2B 물품분류번호 supplied by the operator."""

    code: str
    item_keywords: tuple[str, ...]


def load_item_classification_filter(path: Path) -> ItemClassificationFilter:
    """Read the category code and 품목 keyword rules from the filter file."""
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(lines) != 4 or lines[0] != "물품분류번호" or lines[2] != "품목 키워드":
        raise ValueError("filter file must contain category code and 품목 키워드 sections")
    code = lines[1]
    if not (code.isdigit() and len(code) == 8):
        raise ValueError("물품분류번호 must be an 8-digit code")
    keywords = tuple(keyword.strip() for keyword in lines[3].split(",") if keyword.strip())
    if not keywords:
        raise ValueError("품목 키워드 must contain at least one keyword")
    return ItemClassificationFilter(code=code, item_keywords=keywords)


@dataclass(frozen=True)
class ClassificationNameFilter:
    """물품분류명(품명) 또는 물품분류번호 기반 필터."""

    names: tuple[str, ...]
    codes: tuple[str, ...]  # 추가 물품분류번호 (선택)


def load_classification_name_filter(path: Path) -> ClassificationNameFilter:
    """'물품분류명' 섹션과 선택적 '물품분류번호' 섹션을 읽는다."""
    text = path.read_text(encoding="utf-8")
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            current = None
            continue
        if line in ("물품분류명", "물품분류번호"):
            current = line
            sections[current] = []
        elif current:
            sections[current].append(line)
    if "물품분류명" not in sections:
        raise ValueError("filter file must contain '물품분류명' section")
    names = tuple(sections["물품분류명"])
    if not names:
        raise ValueError("filter file must contain at least one 물품분류명")
    codes = tuple(sections.get("물품분류번호", []))
    return ClassificationNameFilter(names=names, codes=codes)


class ProductClassifier(NamedTuple):
    """제품명 + 물품분류번호(codes, 1차 필터) + 키워드(keywords, 2차 필터) 기반 분류 규칙."""

    name: str
    codes: tuple[str, ...]  # 물품분류번호(classification_code) 1차 필터
    keywords: tuple[str, ...]  # 상품모델명/세부품명 substring(대소문자 무시) 2차 필터


def load_product_filter(path: Path) -> list[ProductClassifier]:
    """products.md 파일에서 제품별 분류 규칙을 읽는다.

    형식:
        제품명
        codes: 코드1, 코드2, ...
        keywords: 키워드1, 키워드2, ...
    """
    products: list[ProductClassifier] = []
    current_name: str | None = None
    current_codes: list[str] = []
    current_keywords: list[str] = []

    def _flush() -> None:
        if current_name:
            products.append(ProductClassifier(current_name, tuple(current_codes), tuple(current_keywords)))

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            _flush()
            current_name = None
            current_codes = []
            current_keywords = []
            continue
        if line.startswith("codes:"):
            current_codes = [c.strip() for c in line[6:].split(",") if c.strip()]
        elif line.startswith("keywords:"):
            current_keywords = [k.strip() for k in line[9:].split(",") if k.strip()]
        else:
            _flush()
            current_name = line
            current_codes = []
            current_keywords = []

    _flush()
    return products
