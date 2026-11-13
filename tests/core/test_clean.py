from core.clean import Block, blocks, markdown_blocks, normalise, text_hash


def test_heading_paragraph_list():
    b = blocks("== Tausta ==\nEnsimmäinen kappale.\n* kohta yksi\n")
    assert [(x.kind, x.text) for x in b] == [("h", "Tausta"), ("p", "Ensimmäinen kappale."), ("li", "kohta yksi")]


def test_citations_counted_and_removed():
    b = blocks('Väite.<ref>Lähde A</ref> Toinen.<ref name="x" /> Kolmas.<ref name="y">Lähde B</ref>')
    assert b == [Block("p", "Väite. Toinen. Kolmas.", 3)]


def test_templates_tables_files_dropped():
    b = blocks("{{Infobox|a={{sisä}}}}\n{| class=x\n| solu\n|}\n[[Tiedosto:K.jpg|thumb|[[linkki]] teksti]]\nJäljelle jää [[Helsinki|pääkaupunki]] ja [[Turku]].")
    assert b == [Block("p", "Jäljelle jää pääkaupunki ja Turku.", 0)]


def test_unclosed_template_terminates():
    assert blocks("Alku säilyy.\n{{rikki\nloppu katoaa") == [Block("p", "Alku säilyy.", 0)]


def test_unclosed_ref_terminates():
    b = blocks("Alku. <ref>ei sulkua\nToinen rivi.")      # must return, not hang
    assert b[0].text.startswith("Alku.") and b[0].citations == 0


def test_empty_and_template_only():
    assert blocks("") == [] and blocks("{{tynkä}}") == []


def test_normalise_and_hash():
    assert normalise("a  b\n\tc ") == "a b c"
    assert text_hash("a  b") == text_hash("a b") and len(text_hash("a")) == 16


def test_markdown_blocks():
    b = markdown_blocks("# Winter War\nThe war began.\n- item\n| a | b |\n## Background\n1. first")
    assert [(x.kind, x.text) for x in b] == [("h", "Winter War"), ("p", "The war began."), ("li", "item"), ("h", "Background"), ("li", "first")]


def test_reference_list_and_slash_in_ref_name():
    b = blocks('Väite.<ref name="a/b" /> Jatkuu tässä.<ref>Lähde</ref>\n<references />')
    assert b == [Block("p", "Väite. Jatkuu tässä.", 2)]


def _drop_nested_reference(text, start, end):
    out, depth, i = [], 0, 0
    while i < len(text):
        if text.startswith(start, i):
            depth += 1
            i += len(start)
        elif depth and text.startswith(end, i):
            depth -= 1
            i += len(end)
        else:
            if not depth:
                out.append(text[i])
            i += 1
    return "".join(out)


def test_drop_nested_matches_the_character_walk():
    import random

    from core.clean import _drop_nested

    rng = random.Random(3)
    for _ in range(5000):
        text = "".join(rng.choice("{}|ab \n") for _ in range(rng.randint(0, 60)))
        for start, end in (("{{", "}}"), ("{|", "|}")):
            assert _drop_nested(text, start, end) == _drop_nested_reference(text, start, end), text
