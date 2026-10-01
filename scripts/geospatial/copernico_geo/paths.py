from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(os.environ.get("COPERNICO_ROOT", Path(__file__).resolve().parents[3]))
CATALOG = ROOT / "data" / "catalog" / "datasets.json"
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
BUILD = ROOT / "data" / "build"


def dataset(dataset_id: str) -> dict:
    entries = json.loads(CATALOG.read_text(encoding="utf-8"))["datasets"]
    for entry in entries:
        if entry["id"] == dataset_id:
            return entry
    raise KeyError(f"dataset {dataset_id!r} not in catalog")


def ensure(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path
