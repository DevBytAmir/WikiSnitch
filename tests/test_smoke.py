import importlib


def test_imports():
    for name in ("core", "pipeline", "api"):
        importlib.import_module(name)
