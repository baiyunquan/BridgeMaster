from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import FIRST_COMPLETED
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import wait
from dataclasses import dataclass
from pathlib import Path

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT))

from dds_service.api import DdsAnalysisRequest
from dds_service.api import analyze_position


BASE_PAYLOAD = {
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
}


@dataclass
class Stats:
    submitted: int = 0
    completed: int = 0
    failed: int = 0
    timed_out: int = 0
    last_error: str = ""


def run_once(seed: int, max_samples: int) -> int:
    payload = dict(BASE_PAYLOAD)
    payload["maxSamples"] = max_samples
    payload["randomSeed"] = seed
    req = DdsAnalysisRequest(**payload)
    result = analyze_position(req)
    suggestions = result.get("moveSuggestions", [])
    if not suggestions:
        raise RuntimeError("No moveSuggestions returned")
    return len(suggestions)


def stress(duration_sec: int, workers: int, max_samples: int, timeout_sec: float) -> Stats:
    stats = Stats()
    start = time.perf_counter()
    end_time = start + duration_sec
    seed = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        in_flight = {}

        while time.perf_counter() < end_time:
            while len(in_flight) < workers and time.perf_counter() < end_time:
                future = pool.submit(run_once, seed, max_samples)
                in_flight[future] = time.perf_counter()
                stats.submitted += 1
                seed += 1

            done, _ = wait(in_flight.keys(), timeout=0.2, return_when=FIRST_COMPLETED)
            now = time.perf_counter()

            for future in list(in_flight.keys()):
                created = in_flight[future]
                if future.done():
                    try:
                        _ = future.result()
                        stats.completed += 1
                    except Exception as exc:  # noqa: BLE001
                        stats.failed += 1
                        stats.last_error = str(exc)
                    del in_flight[future]
                elif now - created > timeout_sec:
                    future.cancel()
                    stats.timed_out += 1
                    del in_flight[future]

            elapsed = now - start
            if int(elapsed) % 10 == 0:
                print(
                    f"elapsed={elapsed:.1f}s submitted={stats.submitted} "
                    f"completed={stats.completed} failed={stats.failed} timed_out={stats.timed_out}",
                    flush=True,
                )

        # Drain remaining work briefly so summary reflects final state.
        grace_deadline = time.perf_counter() + min(5.0, timeout_sec)
        while in_flight and time.perf_counter() < grace_deadline:
            done, _ = wait(in_flight.keys(), timeout=0.2, return_when=FIRST_COMPLETED)
            _ = done
            now = time.perf_counter()
            for future in list(in_flight.keys()):
                created = in_flight[future]
                if future.done():
                    try:
                        _ = future.result()
                        stats.completed += 1
                    except Exception as exc:  # noqa: BLE001
                        stats.failed += 1
                        stats.last_error = str(exc)
                    del in_flight[future]
                elif now - created > timeout_sec:
                    future.cancel()
                    stats.timed_out += 1
                    del in_flight[future]

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="DDS concurrency stress test")
    parser.add_argument("--duration", type=int, default=120, help="Test duration in seconds")
    parser.add_argument("--workers", type=int, default=8, help="Worker thread count")
    parser.add_argument("--max-samples", type=int, default=10, help="DDS maxSamples per request")
    parser.add_argument("--timeout", type=float, default=15.0, help="Per-task timeout in seconds")
    args = parser.parse_args()

    print(
        f"Starting DDS stress test: duration={args.duration}s workers={args.workers} "
        f"max_samples={args.max_samples} timeout={args.timeout}s",
        flush=True,
    )
    started = time.perf_counter()
    stats = stress(
        duration_sec=args.duration,
        workers=args.workers,
        max_samples=args.max_samples,
        timeout_sec=args.timeout,
    )
    elapsed = time.perf_counter() - started

    print("\n=== SUMMARY ===", flush=True)
    print(f"elapsed={elapsed:.1f}s", flush=True)
    print(f"submitted={stats.submitted}", flush=True)
    print(f"completed={stats.completed}", flush=True)
    print(f"failed={stats.failed}", flush=True)
    print(f"timed_out={stats.timed_out}", flush=True)
    if stats.last_error:
        print(f"last_error={stats.last_error}", flush=True)

    if stats.failed > 0 or stats.timed_out > 0:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
