from __future__ import annotations

import csv
from pathlib import Path
from typing import Iterable

from .contracts import ItemRecord

FIELDS = [
    "input_date",
    "product_model_name",
    "classification_code",
    "item_name",
    "item_id",
    "item_specification",
    "detail_classification_code",
    "detail_item_name",
    "manufacturer_name",
    "matched_keywords",
    "raw_fields",
    "source_row_hash",
    "collected_at",
]


def export_csv(records: Iterable[ItemRecord], destination: Path) -> int:
    rows = [record.as_dict() for record in records]
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def export_xlsx(records: Iterable[ItemRecord], destination: Path) -> int:
    try:
        from openpyxl import Workbook
    except ImportError as error:
        raise RuntimeError("XLSX export requires openpyxl; install project dependencies first") from error
    rows = [record.as_dict() for record in records]
    destination.parent.mkdir(parents=True, exist_ok=True)
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet("items")
    sheet.append(FIELDS)
    for row in rows:
        sheet.append([row[field] for field in FIELDS])
    workbook.save(destination)
    return len(rows)
