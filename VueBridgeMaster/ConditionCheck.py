from __future__ import annotations

from dataclasses import dataclass

POSITIONS = ("N", "E", "S", "W")


@dataclass(frozen=True)
class AssistantInvariantResult:
    ok: bool
    reason: str = ""


def _card_key(card: dict) -> str:
    return f"{card['suit']}-{card['rank']}"


def check_no_duplicate_cards(assistant_state: dict) -> AssistantInvariantResult:
    seen_known: set[str] = set()
    for position in POSITIONS:
        for card in assistant_state.get("knownHands", {}).get(position, []):
            key = _card_key(card)
            if key in seen_known:
                return AssistantInvariantResult(False, f"duplicate known card: {key}")
            seen_known.add(key)

    seen_played: set[str] = set()
    for item in assistant_state.get("playedCards", []) + assistant_state.get("currentTrick", []):
        key = _card_key(item["card"])
        if key in seen_played:
            return AssistantInvariantResult(False, f"duplicate played card: {key}")
        seen_played.add(key)

    return AssistantInvariantResult(True)


def check_recording_bounds(assistant_state: dict) -> AssistantInvariantResult:
    played = len(assistant_state.get("playedCards", [])) + len(assistant_state.get("currentTrick", []))
    if played < 0 or played > 52:
        return AssistantInvariantResult(False, f"played count out of range: {played}")

    if assistant_state.get("phase") == "finished" and played != 52:
        return AssistantInvariantResult(False, f"finished phase but played={played}")

    return AssistantInvariantResult(True)


def check_entry_target_shape(assistant_state: dict) -> AssistantInvariantResult:
    target = assistant_state.get("entryTarget")
    position = assistant_state.get("entryPosition")
    if target in {"operator_hand", "dummy_hand", "opening_lead", "trick_play"} and position not in POSITIONS:
        return AssistantInvariantResult(False, f"target {target} missing valid entryPosition")

    return AssistantInvariantResult(True)


def check_all(assistant_state: dict) -> AssistantInvariantResult:
    for checker in (check_no_duplicate_cards, check_recording_bounds, check_entry_target_shape):
        result = checker(assistant_state)
        if not result.ok:
            return result
    return AssistantInvariantResult(True)
