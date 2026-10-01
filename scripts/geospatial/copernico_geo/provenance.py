"""Records exactly how every raw artifact was obtained (URL, window, checksum, time, GDAL version)."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from osgeo import gdal


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_record(artifact: Path, **fields) -> dict:
    record = {
        "artifact": artifact.name,
        "bytes": artifact.stat().st_size,
        "sha256": sha256(artifact),
        "retrievedUtc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "gdal": gdal.__version__,
        **fields,
    }
    artifact.with_suffix(artifact.suffix + ".provenance.json").write_text(
        json.dumps(record, indent=2), encoding="utf-8"
    )
    return record


def read_record(artifact: Path) -> dict | None:
    p = artifact.with_suffix(artifact.suffix + ".provenance.json")
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
