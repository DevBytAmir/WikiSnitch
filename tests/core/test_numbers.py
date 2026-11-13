from core.numbers import diff_numbers, extract_numbers, numbers_field


def test_thousand_separators_unify():
    for s in ("25 000", "25 000", "25,000", "25.000", "25000"):
        assert extract_numbers(f"noin {s} sotilasta") == ["25000"]

def test_years_and_sorting_and_single_digits():
    assert extract_numbers("Vuosina 1939–1940 kaatui 3 kenraalia ja 70 000 miestä.") == ["1939", "1940", "70000"]

def test_no_numbers():
    assert extract_numbers("Ei lukuja.") == [] and numbers_field("Ei lukuja.") == ""

def test_diff():
    assert diff_numbers("1939,25000", "1939,70000") == (["25000"], ["70000"])
    assert diff_numbers("", "") == ([], [])

def test_field_length_cap():
    assert len(numbers_field(" ".join(str(10_000 + i) for i in range(400)))) <= 1000


def test_separate_numbers_stay_apart():
    assert extract_numbers("vuosina 1939 1940, sitten 10000 10001") == ["1939", "1940", "10000", "10001"]
    assert extract_numbers("1,5 ja 12.50") == ["12", "50"]
