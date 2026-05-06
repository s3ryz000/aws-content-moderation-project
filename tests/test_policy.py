import importlib.util
import os
import sys

_POLICY_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "lambdas", "process_image", "policy.py")
)
_spec = importlib.util.spec_from_file_location("policy", _POLICY_PATH)
_mod = importlib.util.module_from_spec(_spec)
sys.modules["policy"] = _mod
_spec.loader.exec_module(_mod)

determine_status = _mod.determine_status
HARD_BLOCK_CATEGORIES = _mod.HARD_BLOCK_CATEGORIES


def test_no_labels_is_approved():
    assert determine_status([]) == "APPROVED"


def test_all_labels_below_60_is_approved():
    labels = [
        {"Name": "Suggestive", "Confidence": 55.0, "ParentName": "Suggestive"},
        {"Name": "Tobacco", "Confidence": 30.0, "ParentName": "Tobacco"},
    ]
    assert determine_status(labels) == "APPROVED"


def test_label_at_60_confidence_is_flagged():
    labels = [{"Name": "Suggestive", "Confidence": 60.0, "ParentName": "Suggestive"}]
    assert determine_status(labels) == "FLAGGED"


def test_label_above_60_confidence_is_flagged():
    labels = [{"Name": "Suggestive", "Confidence": 75.0, "ParentName": "Suggestive"}]
    assert determine_status(labels) == "FLAGGED"


def test_hard_block_label_at_90_is_blocked():
    labels = [{"Name": "Explicit Nudity", "Confidence": 90.0, "ParentName": "Explicit Nudity"}]
    assert determine_status(labels) == "BLOCKED"


def test_hard_block_label_at_89_is_flagged():
    labels = [{"Name": "Explicit Nudity", "Confidence": 89.9, "ParentName": "Explicit Nudity"}]
    assert determine_status(labels) == "FLAGGED"


def test_non_hard_block_label_at_95_is_flagged():
    labels = [{"Name": "Suggestive", "Confidence": 95.0, "ParentName": "Suggestive"}]
    assert determine_status(labels) == "FLAGGED"


def test_worst_case_wins_blocked_beats_flagged():
    labels = [
        {"Name": "Suggestive", "Confidence": 75.0, "ParentName": "Suggestive"},
        {"Name": "Violence", "Confidence": 92.0, "ParentName": "Violence"},
    ]
    assert determine_status(labels) == "BLOCKED"


def test_all_hard_block_categories_trigger_blocked():
    for category in HARD_BLOCK_CATEGORIES:
        labels = [{"Name": category, "Confidence": 95.0, "ParentName": category}]
        assert determine_status(labels) == "BLOCKED", f"Expected BLOCKED for {category}"


def test_hard_block_name_not_parent_is_flagged():
    labels = [{"Name": "Explicit Nudity", "Confidence": 95.0, "ParentName": "Other"}]
    assert determine_status(labels) == "FLAGGED"
