import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.testset import fresh_graph  # noqa: E402


@pytest.fixture(scope="session")
def g():
    graph = fresh_graph()
    yield graph
    graph.close()
