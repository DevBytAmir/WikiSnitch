"""Fixture data with known answers, so the tests can check exact results.

The invented article ``fi/9001`` ("Testisota") has 16 versions told in Finnish. Among them:

* a junk edit by an anonymous user that is undone five minutes later (versions 103 and 104),
* a figure that changes from 25 000 to 70 000 (version 109),
* a paragraph that moves, and a rewritten one that keeps its identity (versions 110 and 111),
* a blanked article that is restored (versions 107 and 108),
* a paragraph changed and restored twice in a row in 2026, which makes it disputed.

Around it are the dataset-style rows of six articles: three Finnish (one without any history),
two English and one Swedish, with their counterparts linked by Wikidata item.
"""

import hashlib
from datetime import datetime, timezone

from core.lineage import Version

P1A = "Testisota alkoi vuonna 1939 ja siinä kuoli noin 25 000 sotilasta pohjoisen rajan taisteluissa."
P1B = P1A.replace("25 000", "70 000")
P2A = (
    "Sota loi uuden rajan ja se muutti maan tavat, mutta työ ja kauppa saivat uuden alun "
    "kun rauha tuli ja ne kylät alkoivat elää taas."
)
P2B = P2A.replace("tavat,", "tavan,")
P2C = (
    "Sota loi uuden rajan ja se muutti maan tavan, mutta pankit ja yritykset saivat uuden "
    "alun kun vero nousi ja ne lait alkoivat elää taas."
)
P3A = (
    "Rauhansopimus allekirjoitettiin keväällä ja sen ehdot julkaistiin kaikissa suurimmissa "
    "päivälehdissä.<ref>Sopimusasiakirjat, kansallisarkisto.</ref>"
)
P4A = "Lääkärit ja sairaanhoitajat auttoivat haavoittuneita sotilaita kenttäsairaaloissa koko talven ajan."
P4X = "Lääkärit ja sairaanhoitajat auttoivat haavoittuneita kenttäsairaaloissa koko talven ajan yksin."
P4Y = "Lääkärit ja sairaanhoitajat hoitivat haavoittuneita sotilaita kenttäsairaaloissa koko vuoden ajan."
P5A = "Muistomerkki paljastettiin kaupungin keskustorilla ja sinne tuodaan edelleen kukkia joka syksy."
JUNK = "Tässä on aivan toisenlaista roskaa ilman mitään sisältöä, eikä tämä liity artikkelin aiheeseen mitenkään."
SHORT = "Lyhyt artikkeli kertoo vain yhden pienen asian tässä kohdassa."
NO_HISTORY = (
    "Tämä artikkeli on kirjoitettu vain nykyisenä versiona, eikä sillä ole muokkaushistoriaa "
    "ollenkaan."
)
E1 = (
    "Test War Testisota alkoi vuonna 1939 ja siinä kuoli noin 25,000 sotilasta "
    "pohjoisen rajan taisteluissa."
)
E2 = "Merchants shipped timber and iron across the harbour while fishermen mended their nets at dawn."
S1 = (
    "Testkriget Sota loi uuden rajan ja se muutti maan tavan, mutta pankit ja yritykset saivat "
    "uuden alun kun vero nousi ja ne lait alkoivat elää taas."
)
EN_8003 = "Glaciers carved deep valleys through the northern mountains over many thousands of years."

H1 = "== Tausta =="
H2 = "== Seuraukset =="


def _text(*parts: str) -> str:
    return "\n".join(parts)


def _utc(*args: int) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


def _version(rev_id, moment, user, text, comment, anonymous=False) -> Version:
    sha1 = hashlib.md5(text.encode("utf-8")).hexdigest()[:31]
    return Version(rev_id, moment, user, anonymous, comment, False, sha1, text)


_T102 = _text(H1, P1A, P2B)
_T106 = _text(H1, P1A, P2B, H2, P3A, P4A)
_T109 = _text(P4A, H1, P1B, P2B, H2, P3A)
_T111 = _text(P4A, H1, P1B, P2C, H2, P3A)
_T112 = _text(P4A, H1, P1B, P2C, H2, P3A, P5A, P3A)

# Versions of the history articles by Finnish page id, in time order.
FI_HISTORY: dict[int, list[Version]] = {
    9001: [
        _version(101, _utc(2005, 3, 1, 10), "Aino", _text(H1, P1A, P2A), "Uusi artikkeli"),
        _version(102, _utc(2006, 5, 2, 12), "Björn", _T102, "Sanamuoto"),
        _version(103, _utc(2007, 1, 10, 9), "192.0.2.7", _text(P1A, JUNK), "Roskaa", True),
        _version(104, _utc(2007, 1, 10, 9, 5), "Aino", _T102, "Palautettu"),
        _version(105, _utc(2008, 8, 8, 8, 8, 8), "Cecilia", _text(_T102, H2, P3A), "Seuraukset"),
        _version(106, _utc(2008, 8, 8, 8, 8, 8), "Cecilia", _T106, "Lääkintä"),
        _version(107, _utc(2010, 2, 2), "Björn", "", "Tyhjennetty"),
        _version(108, _utc(2010, 2, 2, 0, 10), "Aino", _T106, "Palautettu"),
        _version(109, _utc(2015, 6, 15), "Daavid", _text(H1, P1B, P2B, H2, P3A, P4A), "Luvut"),
        _version(110, _utc(2020, 1, 1), "Daavid", _T109, "Kappale ylös"),
        _version(111, _utc(2026, 4, 2), "Eeva", _T111, "Tarkennus"),
        _version(112, _utc(2026, 8, 1), "Frans", _T112, "Lisäyksiä"),
        _version(113, _utc(2026, 8, 10), "Greta", _T112.replace(P4A, P4X), "Muutos"),
        _version(114, _utc(2026, 8, 11), "Aino", _T112, "Palautettu"),
        _version(115, _utc(2026, 9, 1), "Greta", _T112.replace(P4A, P4Y), "Muutos"),
        _version(116, _utc(2026, 9, 2), "Aino", _T112, "Palautettu"),
    ],
    9002: [_version(201, _utc(2012, 1, 1), "Aino", SHORT, "Uusi artikkeli")],
}


def _article(lang, page_id, rev_id, wikidata_id, title, text, date_modified) -> dict:
    return {
        "lang": lang, "page_id": page_id, "rev_id": rev_id, "wikidata_id": wikidata_id,
        "title": title, "url": f"https://{lang}.wikipedia.org/?curid={page_id}",
        "date_modified": date_modified, "text": text,
    }


def _plain(text: str) -> str:
    return text.split("<ref>")[0] + text.split("</ref>")[-1]


_CURRENT = [P4A, P1B, P2C, _plain(P3A), P5A, _plain(P3A)]

# Dataset-style article rows. The current text of 9001 matches its last version.
S_ARTICLES: list[dict] = [
    _article("fi", 9001, 116, "Q9001", "Testisota", "\n\n".join(_CURRENT), "2026-09-02T00:00:00Z"),
    _article("fi", 9002, 201, "Q9002", "Lyhyt artikkeli", SHORT, "2012-01-01T00:00:00Z"),
    _article("fi", 9003, 301, "Q9003", "Ilman historiaa", f"# Ilman historiaa\n\n{NO_HISTORY}",
             "2025-08-01T00:00:00Z"),
    _article("en", 8001, 801, "Q9001", "Test War", f"# Test War\n\n{E1}\n\n{E2}",
             "2025-08-01T00:00:00Z"),
    _article("sv", 7001, 701, "Q9001", "Testkriget", f"# Testkriget\n\n{S1}", "2025-08-01T00:00:00Z"),
    _article("en", 8003, 803, "Q9003", "No History", f"# No History\n\n{EN_8003}",
             "2025-08-01T00:00:00Z"),
]
