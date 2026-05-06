HARD_BLOCK_CATEGORIES = {
    "Explicit Nudity",
    "Violence",
    "Visually Disturbing",
    "Hate Symbols",
}

BLOCK_CONFIDENCE_THRESHOLD = 90.0
FLAG_CONFIDENCE_THRESHOLD = 60.0


def determine_status(labels: list[dict]) -> str:
    for label in labels:
        confidence = float(label.get("Confidence", 0))
        parent_name = label.get("ParentName", "")
        if confidence >= BLOCK_CONFIDENCE_THRESHOLD and parent_name in HARD_BLOCK_CATEGORIES:
            return "BLOCKED"

    for label in labels:
        if float(label.get("Confidence", 0)) >= FLAG_CONFIDENCE_THRESHOLD:
            return "FLAGGED"

    return "APPROVED"
