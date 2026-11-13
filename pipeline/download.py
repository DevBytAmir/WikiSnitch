"""Download MariaDB's Wikipedia datasets and verify every file against its SHA-256 checksum."""

import argparse
import hashlib
import sys
from pathlib import Path

import requests

from core.config import load_settings

# Dataset S: current text of Finnish history articles with ready-made article vectors. Dataset M:
# the full edit history of 50 of them.
BASE_URL = "https://github.com/MariaDB/mariadb-wikipedia-datasets/releases/download"
TIMEOUT = 60
CHUNK = 1 << 20
SUMS = "SHA256SUMS"
S_TAG = "s-2026-10"
M_TAG = "m-2026-10"
S_FILES = [
    "articles-fi.parquet",
    "articles-sv.parquet",
    "articles-en.parquet",
    "vectors-bge-m3-fi.parquet",
    "vectors-bge-m3-sv.parquet",
    "vectors-bge-m3-en.parquet",
    "category-links-fi.tsv",
    "article-categories-fi.tsv",
    SUMS,
]
M_FILES = [f"versions-{i:02d}.parquet" for i in range(1, 17)] + [SUMS]
DATASETS = {"s": (S_TAG, S_FILES), "m": (M_TAG, M_FILES)}


def download(names: list[str], tag: str, dest: Path, base_url: str = BASE_URL) -> int:
    """Fetch the named files of one release into ``dest`` and return how many were downloaded.

    Files that already match their checksum are skipped, and partial files are resumed. A file
    that fails its checksum is deleted and raises ``ValueError``.
    """
    dest.mkdir(parents=True, exist_ok=True)
    sums_path = dest / SUMS
    _fetch(_url(base_url, tag, SUMS), sums_path, resume=False)
    sums = _parse_sums(sums_path.read_text(encoding="utf-8"))
    fetched = 0
    for name in names:
        if name == SUMS:
            continue
        if name not in sums:
            raise ValueError(f"{name} is not listed in {SUMS}")
        expected = sums[name]
        path = dest / name
        if path.is_file() and _sha256(path) == expected:
            print(f"{name}: already verified, skipped")
            continue
        _fetch(_url(base_url, tag, name), path, resume=path.is_file())
        actual = _sha256(path)
        if actual != expected:
            path.unlink()
            raise ValueError(f"{name}: sha256 {actual} does not match {expected}")
        print(f"{name}: fetched and verified")
        fetched += 1
    return fetched


def _url(base_url: str, tag: str, name: str) -> str:
    return f"{base_url}/{tag}/{name}"


def _parse_sums(text: str) -> dict[str, str]:
    """Read ``sha256sum`` output into ``{file name: lowercase digest}``."""
    sums = {}
    for line in text.splitlines():
        parts = line.split(maxsplit=1)
        if len(parts) == 2:
            sums[parts[1].strip().lstrip("*")] = parts[0].lower()
    return sums


def _fetch(url: str, path: Path, resume: bool) -> None:
    """Stream a URL to ``path``, continuing a partial file when the server supports ranges."""
    offset = path.stat().st_size if resume and path.is_file() else 0
    headers = {"Range": f"bytes={offset}-"} if offset else {}
    with requests.get(url, headers=headers, stream=True, timeout=TIMEOUT) as response:
        if response.status_code == 416:
            path.unlink(missing_ok=True)
            return _fetch(url, path, resume=False)
        response.raise_for_status()
        mode = "ab" if offset and response.status_code == 206 else "wb"
        with path.open(mode) as out:
            for chunk in response.iter_content(CHUNK):
                out.write(chunk)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main(argv: list[str] | None = None) -> None:
    """Command line: ``python -m pipeline.download [s] [m]``, both datasets by default."""
    parser = argparse.ArgumentParser(prog="python -m pipeline.download")
    parser.add_argument("sets", nargs="*", choices=sorted(DATASETS), default=list(DATASETS))
    args = parser.parse_args(argv)
    settings = load_settings()
    for key in args.sets:
        tag, names = DATASETS[key]
        dest = settings.data_dir / key
        try:
            count = download(names, tag, dest, base_url=BASE_URL)
        except ValueError as error:
            print(f"checksum error in {key}: {error}", file=sys.stderr)
            raise SystemExit(1) from error
        print(f"{key}: {count} file(s) fetched into {dest}")


if __name__ == "__main__":
    main()
