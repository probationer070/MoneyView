import math

import pytest

from packages.core_finance.dcf import fcff_path_is_admissible, require_admissible_fcff_path
from packages.core_finance.refusals import EngineRefusal


def test_every_positive_finite_path_is_admissible():
    assert fcff_path_is_admissible([0.5 * 1.06 ** t for t in range(1, 6)])


@pytest.mark.parametrize("path", [
    [],
    [1.0, 1.0, 0.0, 1.0, 1.0],
    [1.0, -0.1, 1.0, 1.0, 1.0],
    [0.5 * (1 - 1.5) ** t for t in range(1, 6)],   # positive base, growth -150%
    [1.0, math.nan, 1.0, 1.0, 1.0],
    [1.0, math.inf, 1.0, 1.0, 1.0],
])
def test_an_empty_non_positive_or_non_finite_path_is_not(path):
    assert not fcff_path_is_admissible(path)


def test_the_raising_twin_refuses_with_the_code():
    with pytest.raises(EngineRefusal) as excinfo:
        require_admissible_fcff_path([-0.5] * 5)
    assert excinfo.value.code == "non_positive_fcff"


def test_the_raising_twin_passes_an_admissible_path():
    require_admissible_fcff_path([1.0] * 5)
