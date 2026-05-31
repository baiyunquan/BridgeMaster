from __future__ import annotations

import argparse
import json
import os
import random
import string
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

SUITS = ["C", "D", "H", "S"]
RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
POSITIONS = ["N", "E", "S", "W"]
STRAINS = ["C", "D", "H", "S", "NT"]


@dataclass
class RunStats:
    boards: int = 0
    completed: int = 0
    failed: int = 0
    analyze_calls: int = 0
    last_error: str = ""


def http_json(method: str, url: str, payload: dict | None = None) -> dict | list | None:
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(url=url, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            if not body:
                return None
            return json.loads(body)
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {err.code} {url}: {detail}") from err


def random_player_id(prefix: str = "assistant") -> str:
    suffix = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(8))
    return f"{prefix}-{suffix}"


def build_deal(rng: random.Random) -> dict[str, list[dict[str, str]]]:
    deck = [{"suit": suit, "rank": rank} for suit in SUITS for rank in RANKS]
    rng.shuffle(deck)

    hands: dict[str, list[dict[str, str]]] = {position: [] for position in POSITIONS}
    for index, card in enumerate(deck):
        hands[POSITIONS[index % 4]].append(card)
    return hands


def next_position(position: str) -> str:
    index = POSITIONS.index(position)
    return POSITIONS[(index + 1) % len(POSITIONS)]


def partner_position(position: str) -> str:
    if position == "N":
        return "S"
    if position == "S":
        return "N"
    if position == "E":
        return "W"
    return "E"


def card_key(card: dict[str, str]) -> str:
    return f"{card['suit']}-{card['rank']}"


def payload_cardinality(payload: dict[str, Any]) -> tuple[int, int]:
    known_hands = payload.get("knownHands") if isinstance(payload.get("knownHands"), dict) else {}
    hand_sizes = payload.get("handSizes") if isinstance(payload.get("handSizes"), dict) else {}
    played_cards = payload.get("playedCards") if isinstance(payload.get("playedCards"), list) else []
    current_trick = payload.get("currentTrick") if isinstance(payload.get("currentTrick"), list) else []

    known_keys: set[str] = set()
    for position in POSITIONS:
        cards = known_hands.get(position)
        if isinstance(cards, list):
            for card in cards:
                if isinstance(card, dict):
                    known_keys.add(card_key(card))
    for item in played_cards:
        card = item.get("card") if isinstance(item, dict) else None
        if isinstance(card, dict):
            known_keys.add(card_key(card))
    for item in current_trick:
        card = item.get("card") if isinstance(item, dict) else None
        if isinstance(card, dict):
            known_keys.add(card_key(card))

    unknown_count = 52 - len(known_keys)
    requirement_sum = 0
    for position in POSITIONS:
        size = hand_sizes.get(position)
        cards = known_hands.get(position)
        size_int = size if isinstance(size, int) else 0
        known_len = len(cards) if isinstance(cards, list) else 0
        requirement_sum += size_int - known_len

    return unknown_count, requirement_sum


def run_one_board(
    board_index: int,
    rng: random.Random,
    server_base: str,
    dds_base: str,
    max_samples: int,
) -> tuple[bool, int, str]:
    player_id = random_player_id(f"assistant-{board_index}")
    room_name = f"assistant-board-{board_index:03d}"

    room = http_json(
        "POST",
        f"{server_base}/api/lobby/rooms",
        {
            "roomName": room_name,
            "creatorId": player_id,
            "creatorName": player_id,
            "mode": "assistant",
        },
    )
    if not isinstance(room, dict):
        return False, 0, "Invalid room creation response"

    invite_code = str(room.get("id", ""))
    if not invite_code:
        return False, 0, "Room creation did not return invite code"

    analyze_calls = 0

    try:
        operator = rng.choice(POSITIONS)
        http_json(
            "POST",
            f"{server_base}/api/lobby/rooms/{invite_code}/assistant/operator",
            {"playerId": player_id, "position": operator},
        )

        declarer = rng.choice(POSITIONS)
        contract = {"strain": rng.choice(STRAINS), "declarer": declarer}

        http_json(
            "POST",
            f"{server_base}/api/lobby/rooms/{invite_code}/assistant/contract",
            {
                "playerId": player_id,
                "contract": contract,
                "vulnerable": rng.randint(0, 3),
            },
        )

        hands = build_deal(rng)
        dummy = partner_position(declarer)
        opening_leader = next_position(declarer)

        # Step 2: only record operator hand, then dummy hand, then opening lead.
        http_json(
            "POST",
            f"{server_base}/api/lobby/rooms/{invite_code}/assistant/hands/{operator}",
            {"playerId": player_id, "cards": hands[operator]},
        )
        http_json(
            "POST",
            f"{server_base}/api/lobby/rooms/{invite_code}/assistant/hands/{dummy}",
            {"playerId": player_id, "cards": hands[dummy]},
        )

        available = {position: list(cards) for position, cards in hands.items()}
        opening_card = rng.choice(available[opening_leader])
        available[opening_leader].remove(opening_card)

        http_json(
            "POST",
            f"{server_base}/api/lobby/rooms/{invite_code}/assistant/play",
            {
                "playerId": player_id,
                "play": {
                    "position": opening_leader,
                    "card": opening_card,
                },
            },
        )

        played = 1
        turn = next_position(opening_leader)

        while played < 52:
            if turn == operator:
                payload = http_json(
                    "GET",
                    f"{server_base}/api/lobby/rooms/{invite_code}/assistant/analysis?{urllib.parse.urlencode({'playerId': player_id})}",
                )
                if not isinstance(payload, dict):
                    return False, analyze_calls, "Assistant analysis payload endpoint returned invalid data"

                payload["maxSamples"] = max_samples
                payload["randomSeed"] = board_index * 1000 + played

                try:
                    analysis = http_json("POST", f"{dds_base}/api/dds/analyze", payload)
                except RuntimeError as exc:
                    unknown_count, requirement_sum = payload_cardinality(payload)
                    os.makedirs("logs", exist_ok=True)
                    dump_path = os.path.join("logs", f"assistant-dds-failure-board-{board_index:03d}-played-{played}.json")
                    with open(dump_path, "w", encoding="utf-8") as f:
                        json.dump(payload, f, ensure_ascii=True, indent=2)
                    return (
                        False,
                        analyze_calls,
                        f"DDS analyze failed: board={board_index} played={played} turn={turn} unknown={unknown_count} req={requirement_sum} dump={dump_path}. {exc}",
                    )

                analyze_calls += 1
                if not isinstance(analysis, dict) or not analysis.get("moveSuggestions"):
                    return False, analyze_calls, "DDS analysis returned empty move suggestions"

            position_cards = available[turn]
            if not position_cards:
                return False, analyze_calls, f"No cards left for {turn} at played={played}"

            card = rng.choice(position_cards)
            position_cards.remove(card)

            http_json(
                "POST",
                f"{server_base}/api/lobby/rooms/{invite_code}/assistant/play",
                {
                    "playerId": player_id,
                    "play": {
                        "position": turn,
                        "card": card,
                    },
                },
            )

            played += 1
            turn = next_position(turn)

        room_state = http_json("GET", f"{server_base}/api/lobby/rooms/{invite_code}")
        if not isinstance(room_state, dict):
            return False, analyze_calls, "Invalid room state response"
        assistant_state = room_state.get("assistantState") if isinstance(room_state.get("assistantState"), dict) else None
        if not assistant_state or assistant_state.get("phase") != "finished":
            return False, analyze_calls, "Assistant board did not auto-finish after 52 plays"

        return True, analyze_calls, ""
    finally:
        try:
            http_json(
                "POST",
                f"{server_base}/api/lobby/rooms/{invite_code}/dissolve",
                {"hostId": player_id},
            )
        except Exception:
            pass


def run_simulation(
    boards: int,
    server_base: str,
    dds_base: str,
    seed: int,
    max_samples: int,
) -> RunStats:
    stats = RunStats(boards=boards)
    rng = random.Random(seed)

    started = time.perf_counter()
    for board in range(1, boards + 1):
        ok, calls, error_message = run_one_board(
            board_index=board,
            rng=rng,
            server_base=server_base,
            dds_base=dds_base,
            max_samples=max_samples,
        )
        stats.analyze_calls += calls

        if ok:
            stats.completed += 1
            print(f"[OK] board={board:03d} analyze_calls={calls}", flush=True)
        else:
            stats.failed += 1
            stats.last_error = error_message
            print(f"[FAIL] board={board:03d} analyze_calls={calls} error={error_message}", flush=True)

    elapsed = time.perf_counter() - started
    print("\n=== ASSISTANT MODE SUMMARY ===", flush=True)
    print(f"boards={stats.boards}", flush=True)
    print(f"completed={stats.completed}", flush=True)
    print(f"failed={stats.failed}", flush=True)
    print(f"analyze_calls={stats.analyze_calls}", flush=True)
    print(f"elapsed_seconds={elapsed:.2f}", flush=True)
    if stats.last_error:
        print(f"last_error={stats.last_error}", flush=True)

    return stats


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Assistant mode end-to-end DDS simulation")
    parser.add_argument("--boards", type=int, default=100, help="Number of boards to simulate")
    parser.add_argument("--server-base", type=str, default="http://127.0.0.1:3001", help="BridgeMasterServer base URL")
    parser.add_argument("--dds-base", type=str, default="http://127.0.0.1:8001", help="DDS API base URL")
    parser.add_argument("--seed", type=int, default=20260531, help="Random seed")
    parser.add_argument("--max-samples", type=int, default=24, help="DDS maxSamples per analysis")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    stats = run_simulation(
        boards=max(1, args.boards),
        server_base=args.server_base.rstrip("/"),
        dds_base=args.dds_base.rstrip("/"),
        seed=args.seed,
        max_samples=max(1, min(128, args.max_samples)),
    )

    if stats.failed > 0 or stats.completed != stats.boards:
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Fatal: {exc}", file=sys.stderr)
        raise
