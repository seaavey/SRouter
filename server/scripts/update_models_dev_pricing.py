#!/usr/bin/env python3
"""
Maintenance and validation script for Models.dev pricing dataset snapshot.

Fetches the official Models.dev catalog, extracts and normalizes model pricing
records into a compact offline dataset, generates a provenance manifest,
and validates local snapshot integrity.
"""

import argparse
import hashlib
import json
import os
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_SOURCE_URL = "https://models.dev/api.json"

SCRIPT_DIR = Path(__file__).resolve().parent
SERVER_DIR = SCRIPT_DIR.parent
DEFAULT_DATA_DIR = SERVER_DIR / "src" / "features" / "catalog" / "data"
DEFAULT_PRICING_FILE = DEFAULT_DATA_DIR / "models-dev-pricing.json"
DEFAULT_MANIFEST_FILE = DEFAULT_DATA_DIR / "models-dev-pricing.manifest.json"


def atomic_write(dest_path: Path, data: bytes) -> None:
    """Atomically write binary data to dest_path using a temporary file in the same directory."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    temp_file = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=dest_path.parent,
            prefix=f".{dest_path.name}.tmp-",
            delete=False,
        ) as f:
            temp_file = Path(f.name)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_file, dest_path)
        temp_file = None
    finally:
        if temp_file is not None and temp_file.exists():
            try:
                temp_file.unlink()
            except OSError:
                pass


def normalize_catalog(raw_data: dict) -> list[dict]:
    """
    Extract and normalize models from Models.dev data into a list matching ModelPricingItem schema:
    {
        id, name, description, family, provider, attachment, reasoning,
        tool_call, temperature, structured_output, open_weights, knowledge,
        release_date, last_updated,
        cost: { input, output, cache_read, cache_write, reasoning },
        limit: { context, output },
        modalities: { input, output }
    }
    Only includes fields present. Preserves explicit zero costs. Sorts by provider, then name.
    """
    items: list[dict] = []

    for provider_id, provider_data in raw_data.items():
        if not isinstance(provider_data, dict):
            continue
        models_dict = provider_data.get("models")
        if not isinstance(models_dict, dict):
            continue

        for model_id, model_data in models_dict.items():
            if not isinstance(model_data, dict):
                continue

            item: dict = {
                "id": model_data.get("id", model_id),
                "name": model_data.get("name") or model_data.get("id") or model_id,
            }

            if "description" in model_data and model_data["description"] is not None:
                item["description"] = model_data["description"]
            if "family" in model_data and model_data["family"] is not None:
                item["family"] = model_data["family"]

            item["provider"] = provider_id

            for key in (
                "attachment",
                "reasoning",
                "tool_call",
                "temperature",
                "structured_output",
                "open_weights",
            ):
                if key in model_data and model_data[key] is not None:
                    item[key] = model_data[key]

            for key in ("knowledge", "release_date", "last_updated"):
                if key in model_data and model_data[key] is not None:
                    item[key] = model_data[key]

            if "cost" in model_data and isinstance(model_data["cost"], dict):
                cost_data = model_data["cost"]
                cost_dict = {}
                for cost_key in ("input", "output", "cache_read", "cache_write", "reasoning"):
                    if cost_key in cost_data and cost_data[cost_key] is not None:
                        cost_dict[cost_key] = cost_data[cost_key]
                if cost_dict:
                    item["cost"] = cost_dict

            if "limit" in model_data and isinstance(model_data["limit"], dict):
                limit_data = model_data["limit"]
                limit_dict = {}
                for limit_key in ("context", "output"):
                    if limit_key in limit_data and limit_data[limit_key] is not None:
                        limit_dict[limit_key] = limit_data[limit_key]
                if limit_dict:
                    item["limit"] = limit_dict

            if "modalities" in model_data and isinstance(model_data["modalities"], dict):
                mod_data = model_data["modalities"]
                mod_dict = {}
                for mod_key in ("input", "output"):
                    if mod_key in mod_data and mod_data[mod_key] is not None:
                        mod_dict[mod_key] = mod_data[mod_key]
                if mod_dict:
                    item["modalities"] = mod_dict

            items.append(item)

    # Sort deterministically by provider, then name, then id
    items.sort(key=lambda m: (m.get("provider", ""), m.get("name", ""), m.get("id", "")))
    return items


def update_dataset(
    source_url: str,
    pricing_file: Path,
    manifest_file: Path,
) -> int:
    """Fetch live catalog, normalize, and atomically write dataset and manifest."""
    print(f"Fetching official catalog from {source_url}...")
    req = urllib.request.Request(
        source_url,
        headers={"User-Agent": "SRouter-Catalog-Updater/1.0"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw_bytes = resp.read()

    raw_data = json.loads(raw_bytes.decode("utf-8"))
    if not isinstance(raw_data, dict):
        print(f"Error: Expected top-level dict in source JSON, got {type(raw_data)}", file=sys.stderr)
        return 1

    models = normalize_catalog(raw_data)
    if len(models) <= 1000:
        print(f"Error: Normalized model count ({len(models)}) is unexpectedly low (expected > 1000)", file=sys.stderr)
        return 1

    compact_json = json.dumps(models, separators=(",", ":"), ensure_ascii=False)
    json_bytes = compact_json.encode("utf-8")
    sha256_hash = hashlib.sha256(json_bytes).hexdigest()

    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest = {
        "source_url": source_url,
        "fetched_at": fetched_at,
        "record_count": len(models),
        "sha256": sha256_hash,
    }
    manifest_bytes = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")

    print(f"Atomically writing pricing dataset to {pricing_file}...")
    atomic_write(pricing_file, json_bytes)

    print(f"Atomically writing manifest to {manifest_file}...")
    atomic_write(manifest_file, manifest_bytes)

    print(
        f"Successfully updated dataset: {len(models)} models written "
        f"({len(json_bytes) / 1024 / 1024:.2f} MB, SHA-256: {sha256_hash})"
    )
    return 0


def check_dataset(pricing_file: Path, manifest_file: Path) -> int:
    """Validate snapshot and manifest integrity."""
    if not pricing_file.is_file():
        print(f"Error: Pricing dataset file not found: {pricing_file}", file=sys.stderr)
        return 1

    if not manifest_file.is_file():
        print(f"Error: Manifest file not found: {manifest_file}", file=sys.stderr)
        return 1

    try:
        pricing_bytes = pricing_file.read_bytes()
        models = json.loads(pricing_bytes.decode("utf-8"))
    except Exception as e:
        print(f"Error: Failed to parse {pricing_file} as JSON: {e}", file=sys.stderr)
        return 1

    if not isinstance(models, list):
        print(f"Error: Pricing dataset must be a JSON array, got {type(models)}", file=sys.stderr)
        return 1

    record_count = len(models)
    if record_count <= 1000:
        print(f"Error: Pricing dataset record count ({record_count}) is <= 1000", file=sys.stderr)
        return 1

    try:
        manifest_data = json.loads(manifest_file.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"Error: Failed to parse {manifest_file} as JSON: {e}", file=sys.stderr)
        return 1

    if not isinstance(manifest_data, dict):
        print(f"Error: Manifest must be a JSON object", file=sys.stderr)
        return 1

    expected_sha256 = manifest_data.get("sha256")
    if not expected_sha256 or not isinstance(expected_sha256, str):
        print("Error: Manifest missing valid 'sha256' field", file=sys.stderr)
        return 1

    computed_sha256 = hashlib.sha256(pricing_bytes).hexdigest()
    if computed_sha256.lower() != expected_sha256.lower():
        print(
            f"Error: SHA-256 mismatch for {pricing_file}:\n"
            f"  Computed: {computed_sha256}\n"
            f"  Manifest: {expected_sha256}",
            file=sys.stderr,
        )
        return 1

    manifest_record_count = manifest_data.get("record_count")
    if manifest_record_count != record_count:
        print(
            f"Error: Record count mismatch:\n"
            f"  Dataset:  {record_count}\n"
            f"  Manifest: {manifest_record_count}",
            file=sys.stderr,
        )
        return 1

    print(f"Manifest and snapshot verified ({record_count} models, SHA-256: {computed_sha256})")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Models.dev pricing dataset snapshot updater and integrity validator."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--check",
        action="store_true",
        help="Validate that pricing dataset and manifest exist, are valid JSON, have > 1000 records, and SHA-256 matches.",
    )
    group.add_argument(
        "--update",
        action="store_true",
        help="Fetch official catalog, extract/normalize models into compact dataset, and write dataset and manifest.",
    )

    parser.add_argument(
        "--url",
        default=DEFAULT_SOURCE_URL,
        help=f"Source catalog URL (default: {DEFAULT_SOURCE_URL})",
    )
    parser.add_argument(
        "--pricing-file",
        type=Path,
        default=DEFAULT_PRICING_FILE,
        help=f"Output/input pricing dataset JSON path (default: {DEFAULT_PRICING_FILE})",
    )
    parser.add_argument(
        "--manifest-file",
        type=Path,
        default=DEFAULT_MANIFEST_FILE,
        help=f"Output/input manifest JSON path (default: {DEFAULT_MANIFEST_FILE})",
    )

    args = parser.parse_args()

    if args.update:
        sys.exit(update_dataset(args.url, args.pricing_file, args.manifest_file))
    elif args.check:
        sys.exit(check_dataset(args.pricing_file, args.manifest_file))


if __name__ == "__main__":
    main()
