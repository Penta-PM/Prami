from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from typing import Any


@dataclass(frozen=True)
class ItemRecord:
    input_date: date | None
    product_model_name: str | None
    classification_code: str | None
    item_name: str | None
    item_id: str | None
    item_specification: str | None
    detail_classification_code: str | None
    detail_item_name: str | None
    manufacturer_name: str | None
    matched_keywords: tuple[str, ...]
    raw_fields: dict[str, Any]
    source_row_hash: str
    collected_at: str

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["input_date"] = self.input_date.isoformat() if self.input_date else None
        data["raw_fields"] = json.dumps(self.raw_fields, ensure_ascii=False, sort_keys=True)
        data["matched_keywords"] = ", ".join(self.matched_keywords)
        return data


def make_row_hash(values: dict[str, Any]) -> str:
    canonical = json.dumps(values, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
