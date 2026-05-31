from __future__ import annotations

import json
import os
import random
import sys
import time
from collections import defaultdict
from collections.abc import Iterable
from pathlib import Path
from statistics import mean

from fastapi import FastAPI
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pydantic import Field

from .native import POSITION_ORDER
from .native import RANK_TO_VALUE
from .native import SUIT_ORDER
from .native import SUIT_TO_DDS
from .native import calc_dd_table_pbn
from .native import calc_par
from .native import solve_board_pbn


AUTH_ENABLED = "--auth" in sys.argv or os.environ.get("BRIDGEMASTER_AUTH") == "1"
API_KEY_FILE = Path(__file__).resolve().parent.parent / "api_key.json"
AUTH_EXEMPT_PATHS = {"/api/auth/config", "/api/auth/verify", "/health"}


def _load_api_key() -> str:
    if not API_KEY_FILE.exists():
        raise RuntimeError(f"api_key file not found at {API_KEY_FILE}")

    parsed = json.loads(API_KEY_FILE.read_text(encoding="utf-8"))
    api_key = parsed.get("api_key") if isinstance(parsed, dict) else None
    if not isinstance(api_key, str) or not api_key.strip():
        raise RuntimeError("api_key.json must contain non-empty string field api_key")
    return api_key.strip()


EXPECTED_API_KEY = _load_api_key() if AUTH_ENABLED else ""


def _read_request_api_key(request: Request) -> str:
    header_key = request.headers.get("x-api-key", "").strip()
    if header_key:
        return header_key
    return (request.cookies.get("api_key") or "").strip()


class ApiCard(BaseModel):
    suit: str
    rank: str

    def key(self) -> str:
        return f"{self.suit}-{self.rank}"


class PositionedCard(BaseModel):
    position: str
    card: ApiCard


class ContractPayload(BaseModel):
    strain: str
    declarer: str


class DdsAnalysisRequest(BaseModel):
    knownHands: dict[str, list[ApiCard]]
    handSizes: dict[str, int]
    playedCards: list[PositionedCard] = Field(default_factory=list)
    currentTrick: list[PositionedCard] = Field(default_factory=list)
    turn: str
    contract: ContractPayload
    vulnerable: int = 0
    maxSamples: int = 48
    randomSeed: int | None = None


class DdsBenchmarkRequest(BaseModel):
    request: DdsAnalysisRequest
    iterations: int = 50
    warmupIterations: int = 5


app = FastAPI(title="BridgeMaster DDS API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def api_key_guard(request: Request, call_next):
    if not AUTH_ENABLED or request.url.path in AUTH_EXEMPT_PATHS:
        return await call_next(request)

    provided = _read_request_api_key(request)
    if provided != EXPECTED_API_KEY:
        return JSONResponse(status_code=401, content={"detail": "Invalid api_key."})

    return await call_next(request)


FULL_DECK = [ApiCard(suit=suit, rank=rank) for suit in SUIT_ORDER for rank in ("A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2")]
RANK_ORDER = {rank: index for index, rank in enumerate(("A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"))}


def _card_sort_key(card: ApiCard) -> tuple[int, int]:
    return (SUIT_ORDER.index(card.suit), RANK_ORDER[card.rank])


def _card_to_pbn_rank(rank: str) -> str:
    return "T" if rank == "10" else rank


def _cards_to_hand_text(cards: Iterable[ApiCard]) -> str:
    grouped: dict[str, list[str]] = {suit: [] for suit in SUIT_ORDER}
    for card in cards:
        grouped[card.suit].append(card.rank)

    suit_parts = []
    for suit in SUIT_ORDER:
        ordered = sorted(grouped[suit], key=lambda rank: RANK_ORDER[rank])
        suit_parts.append("".join(_card_to_pbn_rank(rank) for rank in ordered))
    return ".".join(suit_parts)


def _build_pbn(hands: dict[str, list[ApiCard]]) -> str:
    ordered = [_cards_to_hand_text(hands[position]) for position in POSITION_ORDER]
    return f"N:{ordered[0]} {ordered[1]} {ordered[2]} {ordered[3]}"


def _build_trick_arrays(cards: list[PositionedCard]) -> tuple[list[int], list[int]]:
    suits = [0, 0, 0]
    ranks = [0, 0, 0]
    for index, play in enumerate(cards[:3]):
        suits[index] = SUIT_TO_DDS[play.card.suit]
        ranks[index] = RANK_TO_VALUE[play.card.rank]
    return suits, ranks


def _normalize_known_hands(request: DdsAnalysisRequest) -> dict[str, list[ApiCard]]:
    hands = {position: list(request.knownHands.get(position, [])) for position in POSITION_ORDER}
    for cards in hands.values():
        cards.sort(key=_card_sort_key)
    return hands


def _remaining_requirements(request: DdsAnalysisRequest, known_hands: dict[str, list[ApiCard]]) -> dict[str, int]:
    requirements: dict[str, int] = {}
    for position in POSITION_ORDER:
        required = request.handSizes[position] - len(known_hands[position])
        if required < 0:
            raise ValueError(f"Known cards exceed remaining hand size for {position}")
        requirements[position] = required
    return requirements


def _known_card_keys(request: DdsAnalysisRequest, known_hands: dict[str, list[ApiCard]]) -> set[str]:
    keys = {card.key() for cards in known_hands.values() for card in cards}
    keys.update(play.card.key() for play in request.playedCards)
    keys.update(play.card.key() for play in request.currentTrick)
    return keys


def _unknown_cards(request: DdsAnalysisRequest, known_hands: dict[str, list[ApiCard]]) -> list[ApiCard]:
    known_keys = _known_card_keys(request, known_hands)
    unknown = [card for card in FULL_DECK if card.key() not in known_keys]
    unknown.sort(key=_card_sort_key)
    return unknown


def _sample_deals(request: DdsAnalysisRequest, sample_count: int) -> list[dict[str, list[ApiCard]]]:
    known_hands = _normalize_known_hands(request)
    requirements = _remaining_requirements(request, known_hands)
    unknown_cards = _unknown_cards(request, known_hands)

    if sum(requirements.values()) != len(unknown_cards):
        raise ValueError("Hand sizes do not match the number of unknown cards")

    rng = random.Random(request.randomSeed)
    hidden_positions = [position for position in POSITION_ORDER if requirements[position] > 0]

    samples: list[dict[str, list[ApiCard]]] = []
    for _ in range(sample_count):
        shuffled = unknown_cards[:]
        rng.shuffle(shuffled)
        offset = 0
        sample = {position: list(known_hands[position]) for position in POSITION_ORDER}
        for position in hidden_positions:
            count = requirements[position]
            sample[position].extend(shuffled[offset:offset + count])
            sample[position].sort(key=_card_sort_key)
            offset += count
        samples.append(sample)
    return samples


def _probabilities(samples: list[dict[str, list[ApiCard]]], known_hands: dict[str, list[ApiCard]]) -> dict[str, list[dict]]:
    if not samples:
        return {}

    visible_keys = {card.key() for cards in known_hands.values() for card in cards}
    tally: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for sample in samples:
        for position in POSITION_ORDER:
            for card in sample[position]:
                if card.key() in visible_keys:
                    continue
                tally[position][card.key()] += 1

    result: dict[str, list[dict]] = {}
    for position, card_counts in tally.items():
        predictions = []
        for key, count in card_counts.items():
            suit, rank = key.split("-", 1)
            predictions.append(
                {
                    "card": {"suit": suit, "rank": rank},
                    "probability": round(count / len(samples), 4),
                }
            )
        predictions.sort(key=lambda item: (-item["probability"], _card_sort_key(ApiCard(**item["card"]))))
        result[position] = predictions
    return result


def analyze_position(request: DdsAnalysisRequest) -> dict:
    sample_count = max(1, min(request.maxSamples, 128))
    known_hands = _normalize_known_hands(request)
    samples = _sample_deals(request, sample_count)
    trick_suits, trick_ranks = _build_trick_arrays(request.currentTrick)

    move_totals: dict[str, dict[str, float]] = defaultdict(lambda: {"score": 0.0, "count": 0.0})
    contract_trick_total = 0.0
    dd_tables: list[list[list[int]]] = []
    pars: list[dict] = []
    strain_index = SUIT_TO_DDS[request.contract.strain]
    declarer_index = POSITION_ORDER.index(request.contract.declarer)
    turn_index = POSITION_ORDER.index(request.turn)
    first_index = (turn_index - len(request.currentTrick)) % len(POSITION_ORDER)

    for sample in samples:
        pbn = _build_pbn(sample)
        analysis = solve_board_pbn(
            pbn,
            trump=SUIT_TO_DDS[request.contract.strain],
            first=first_index,
            current_trick_suit=trick_suits,
            current_trick_rank=trick_ranks,
            solutions=3,
        )

        for move in analysis["moves"]:
            key = f"{move['suit']}-{move['rank']}"
            move_totals[key]["score"] += move["score"]
            move_totals[key]["count"] += 1

        if not request.currentTrick:
            table = calc_dd_table_pbn(pbn)
            dd_tables.append(table)
            contract_trick_total += table[strain_index][declarer_index]
            pars.append(calc_par(table, request.vulnerable))

    move_suggestions = []
    for key, stats in move_totals.items():
        suit, rank = key.split("-", 1)
        move_suggestions.append(
            {
                "card": {"suit": suit, "rank": rank},
                "averageScore": round(stats["score"] / stats["count"], 3),
                "sampleCoverage": round(stats["count"] / sample_count, 3),
            }
        )
    move_suggestions.sort(key=lambda item: (-item["averageScore"], -item["sampleCoverage"], _card_sort_key(ApiCard(**item["card"]))))

    contract_outlook = None
    if dd_tables:
        average_table = []
        for strain in range(len(dd_tables[0])):
            row = []
            for hand in range(len(dd_tables[0][strain])):
                row.append(round(sum(table[strain][hand] for table in dd_tables) / len(dd_tables), 3))
            average_table.append(row)

        contract_outlook = {
            "expectedDeclarerTricks": round(contract_trick_total / len(dd_tables), 3),
            "averageTable": average_table,
            "mostLikelyPar": max(
                (
                    {
                        "parScore": tuple(item["parScore"]),
                        "parContractsString": tuple(item["parContractsString"]),
                    }
                    for item in pars
                ),
                key=lambda item: pars.count({"parScore": list(item["parScore"]), "parContractsString": list(item["parContractsString"])}),
                default=None,
            ),
        }
        if contract_outlook["mostLikelyPar"] is not None:
            contract_outlook["mostLikelyPar"] = {
                "parScore": list(contract_outlook["mostLikelyPar"]["parScore"]),
                "parContractsString": list(contract_outlook["mostLikelyPar"]["parContractsString"]),
            }

    return {
        "sampleCount": sample_count,
        "hiddenProbabilities": _probabilities(samples, known_hands),
        "moveSuggestions": move_suggestions,
        "contractOutlook": contract_outlook,
    }


def benchmark_analyze_position(payload: DdsBenchmarkRequest) -> dict:
    iterations = max(1, min(payload.iterations, 5000))
    warmup_iterations = max(0, min(payload.warmupIterations, 1000))

    for _ in range(warmup_iterations):
        analyze_position(payload.request)

    elapsed_ms: list[float] = []
    started = time.perf_counter()
    for _ in range(iterations):
        lap_start = time.perf_counter()
        analyze_position(payload.request)
        elapsed_ms.append((time.perf_counter() - lap_start) * 1000.0)
    total_seconds = max(time.perf_counter() - started, 1e-9)

    sorted_elapsed = sorted(elapsed_ms)
    p95_index = min(len(sorted_elapsed) - 1, int(len(sorted_elapsed) * 0.95))

    return {
        "iterations": iterations,
        "warmupIterations": warmup_iterations,
        "totalSeconds": round(total_seconds, 4),
        "requestsPerSecond": round(iterations / total_seconds, 3),
        "latencyMs": {
            "min": round(sorted_elapsed[0], 3),
            "avg": round(mean(elapsed_ms), 3),
            "p95": round(sorted_elapsed[p95_index], 3),
            "max": round(sorted_elapsed[-1], 3),
        },
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/auth/config")
def auth_config() -> dict[str, bool]:
    return {"enabled": AUTH_ENABLED}


@app.post("/api/auth/verify")
def auth_verify(request: Request) -> dict[str, bool]:
    if not AUTH_ENABLED:
        return {"ok": True}

    provided = _read_request_api_key(request)
    if provided != EXPECTED_API_KEY:
        return JSONResponse(status_code=401, content={"detail": "Invalid api_key."})

    return {"ok": True}


@app.post("/api/dds/analyze")
def analyze_endpoint(request: DdsAnalysisRequest) -> dict:
    return analyze_position(request)


@app.post("/api/dds/benchmark")
def benchmark_endpoint(payload: DdsBenchmarkRequest) -> dict:
    return benchmark_analyze_position(payload)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("dds_service.api:app", host="127.0.0.1", port=8001, reload=False)