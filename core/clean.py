"""Wikitext and markdown to blocks of readable text."""

import hashlib
import re
from dataclasses import dataclass
from typing import Literal

_CITE = "\x01"


@dataclass(frozen=True)
class Block:
    """One heading (``h``), paragraph (``p``) or list item (``li``) with its citation count."""

    kind: Literal["h", "p", "li"]
    text: str
    citations: int


def normalise(text: str) -> str:
    """Collapse every run of whitespace to a single space."""
    return " ".join(text.split())


def text_hash(text: str) -> bytes:
    """MD5 of the normalised text: the identity of a distinct paragraph text."""
    return hashlib.md5(normalise(text).encode("utf-8")).digest()


# Adapted from MariaDB mariadb-system-versioning-wikipedia (MIT).
def _drop_nested(text: str, start: str, end: str) -> str:
    """Remove every ``start ... end`` span, including spans nested inside one another."""
    out, depth, i, n = [], 0, 0, len(text)
    while i < n:
        if depth == 0:
            j = text.find(start, i)
            if j < 0:
                out.append(text[i:])
                break
            out.append(text[i:j])
            depth, i = 1, j + len(start)
        else:
            a, b = text.find(start, i), text.find(end, i)
            if b < 0:
                break
            if 0 <= a < b:
                depth, i = depth + 1, a + len(start)
            else:
                depth, i = depth - 1, b + len(end)
    return "".join(out)


def blocks(wikitext: str) -> list[Block]:
    """Turn wikitext into blocks: drop templates, tables, comments, files and markup,
    keep link text, and count the ``<ref>`` citations on each line."""
    t = wikitext.replace(_CITE, "")
    t = re.sub(r"<!--.*?-->", "", t, flags=re.S)
    t = re.sub(r"<ref\b[^>]*/>", _CITE, t)
    t = re.sub(r"<ref\b[^>]*>.*?</ref>", _CITE, t, flags=re.S)
    t = _drop_nested(t, "{{", "}}")
    t = _drop_nested(t, "{|", "|}")
    t = re.sub(r"\[\[(?:Tiedosto|Kuva|File|Image|Luokka|Category):[^\[\]]*(?:\[\[[^\]]*\]\][^\[\]]*)*\]\]", "", t)
    t = re.sub(r"\[\[([^\]|]*)\|([^\]]*)\]\]", r"\2", t)
    t = re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[https?://\S+ ([^\]]*)\]", r"\1", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("'''", "").replace("''", "")
    result = []
    for line in t.split("\n"):
        citations = line.count(_CITE)
        line = line.replace(_CITE, "").strip()
        if not line:
            continue
        heading = re.match(r"^(=+)\s*(.*?)\s*=+$", line)
        if heading:
            kind, text = "h", heading.group(2)
        elif line[0] in "*#":
            kind, text = "li", line.lstrip("*#: ")
        elif line[0] not in "|!:;":
            kind, text = "p", line
        else:
            continue
        text = normalise(text)
        if text:
            result.append(Block(kind, text, citations))
    return result


def markdown_blocks(markdown: str) -> list[Block]:
    """Turn Markdown into blocks. Tables are skipped and citations are not counted."""
    result = []
    for line in markdown.split("\n"):
        line = line.strip()
        if not line or line.startswith("|"):
            continue
        if line.startswith("#"):
            kind, text = "h", line.lstrip("# ")
        elif line.startswith(("- ", "* ")):
            kind, text = "li", line[2:]
        elif m := re.match(r"^\d+\. ", line):
            kind, text = "li", line[m.end():]
        else:
            kind, text = "p", line
        text = normalise(text)
        if text:
            result.append(Block(kind, text, 0))
    return result
