from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from dds_service.api import DdsAnalysisRequest, analyze_position

PAYLOAD = {
    "knownHands": {
        "S": [
            {"suit": "S", "rank": "K"},
            {"suit": "S", "rank": "5"},
            {"suit": "H", "rank": "10"},
            {"suit": "H", "rank": "8"},
            {"suit": "H", "rank": "3"},
            {"suit": "D", "rank": "K"},
            {"suit": "D", "rank": "Q"},
            {"suit": "D", "rank": "9"},
            {"suit": "C", "rank": "A"},
            {"suit": "C", "rank": "7"},
            {"suit": "C", "rank": "6"},
            {"suit": "C", "rank": "5"},
            {"suit": "C", "rank": "2"},
        ],
        "N": [
            {"suit": "S", "rank": "Q"},
            {"suit": "S", "rank": "J"},
            {"suit": "S", "rank": "6"},
            {"suit": "H", "rank": "K"},
            {"suit": "H", "rank": "6"},
            {"suit": "H", "rank": "5"},
            {"suit": "H", "rank": "2"},
            {"suit": "D", "rank": "J"},
            {"suit": "D", "rank": "8"},
            {"suit": "D", "rank": "5"},
            {"suit": "C", "rank": "10"},
            {"suit": "C", "rank": "9"},
            {"suit": "C", "rank": "8"},
        ],
    },
    "handSizes": {"N": 13, "E": 13, "S": 13, "W": 13},
    "playedCards": [],
    "currentTrick": [],
    "turn": "S",
    "contract": {"strain": "NT", "declarer": "S"},
    "maxSamples": 10,
}


def run_once(seed: int) -> int:
    payload = dict(PAYLOAD)
    payload["randomSeed"] = seed
    req = DdsAnalysisRequest(**payload)
    result = analyze_position(req)
    return len(result["moveSuggestions"])


def main() -> None:
    workers = 8
    total = 600
    started = time.perf_counter()
    completed = 0
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(run_once, i) for i in range(total)]
        for future in as_completed(futures):
            suggestions = future.result()
            if suggestions <= 0:
                raise RuntimeError("No move suggestions returned")
            completed += 1
            if completed % 50 == 0:
                elapsed = time.perf_counter() - started
                print(f"completed={completed}/{total} elapsed={elapsed:.1f}s")

    elapsed = time.perf_counter() - started
    print(f"OK completed={completed} in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
