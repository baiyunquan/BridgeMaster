"""
RecordTest.py — Full game record test for all three modes (normal / assistant / exam).

Each mode completes a full game then validates the written game-records.jsonl entry.

Prerequisites:
  - BridgeMasterServer running on http://localhost:3001
  - exam_sheet.csv present at BridgeMasterServer/exam_sheet.csv

Usage:
  python BridgeMasterServer/test/RecordTest.py
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "."))
from test_utils import HeartbeatLoop, api_request, create_full_room, BASE_URL


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RECORD_LOG_PATH = PROJECT_ROOT / "logs" / "game-records.jsonl"

POSITIONS = ["N", "E", "S", "W"]
SUITS = ["C", "D", "H", "S"]
RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]

passed = 0
failed = 0
errors: List[str] = []


def check(condition: bool, msg: str) -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  ✅ {msg}")
    else:
        failed += 1
        errors.append(msg)
        print(f"  ❌ {msg}")


def card_key(suit: str, rank: str) -> str:
    return f"{suit}-{rank}"


def make_card(suit: str, rank: str) -> Dict[str, str]:
    return {"suit": suit, "rank": rank}


def all_cards() -> List[Dict[str, str]]:
    return [make_card(s, r) for s in SUITS for r in RANKS]


def clear_record_log() -> None:
    RECORD_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    RECORD_LOG_PATH.write_text("", encoding="utf-8")


def read_record_log() -> List[Dict[str, Any]]:
    if not RECORD_LOG_PATH.exists():
        return []
    lines = [line.strip() for line in RECORD_LOG_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]
    return [json.loads(line) for line in lines]


def wait_for_record_count(expected_count: int, timeout_seconds: float = 5.0) -> List[Dict[str, Any]]:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        records = read_record_log()
        if len(records) >= expected_count:
            return records
        time.sleep(0.1)
    return read_record_log()


# ---- Normal mode helpers ----
def pick_legal_card(game_state: Dict[str, Any], turn: str) -> Dict[str, str]:
    hand: List[Dict[str, str]] = game_state["hands"][turn]
    current_trick = game_state.get("currentTrick")
    if current_trick and current_trick.get("cards"):
        lead_suit = current_trick["cards"][0]["card"]["suit"]
        for card in hand:
            if card["suit"] == lead_suit:
                return card
    return hand[0]


def play_normal_game(invite_code: str, player_ids: List[str]) -> Dict[str, Any]:
    api_request("POST", f"/api/lobby/rooms/{invite_code}/bid",
        {"playerId": player_ids[0], "bid": {"type": "bid", "level": 1, "strain": "NT"}})
    for pid in player_ids[1:]:
        api_request("POST", f"/api/lobby/rooms/{invite_code}/bid",
            {"playerId": pid, "bid": {"type": "pass"}})

    while True:
        room = api_request("GET", f"/api/lobby/rooms/{invite_code}")
        gs = room["gameState"]
        if gs["phase"] == "finished":
            return room
        turn = gs["turn"]
        pid = gs["playersByPosition"][turn]
        card = pick_legal_card(gs, turn)
        api_request("POST", f"/api/lobby/rooms/{invite_code}/play",
            {"playerId": pid, "card": card})


# ---- Assistant / Exam mode helpers ----
def play_assistant_game(invite_code: str, player_id: str,
                        operator_pos: str, contract_strain: str,
                        declarer: str) -> Dict[str, Any]:
    api_request("POST", f"/api/lobby/rooms/{invite_code}/assistant/operator",
        {"playerId": player_id, "position": operator_pos})
    api_request("POST", f"/api/lobby/rooms/{invite_code}/assistant/contract",
        {"playerId": player_id,
         "contract": {"strain": contract_strain, "declarer": declarer},
         "vulnerable": 0})

    room = api_request("GET", f"/api/lobby/rooms/{invite_code}")
    state = room["assistantState"]
    dummy_pos = state["dummyPosition"]

    deck = all_cards()
    op_cards = deck[:13]
    dummy_cards = deck[13:26]
    fallback = deck[26:]

    api_request("POST", f"/api/lobby/rooms/{invite_code}/assistant/hands/{operator_pos}",
        {"playerId": player_id, "cards": op_cards})
    api_request("POST", f"/api/lobby/rooms/{invite_code}/assistant/hands/{dummy_pos}",
        {"playerId": player_id, "cards": dummy_cards})

    for _ in range(52):
        room = api_request("GET", f"/api/lobby/rooms/{invite_code}")
        state = room["assistantState"]
        if state.get("phase") == "finished":
            break

        entry_pos = state["entryPosition"]
        known = state.get("knownHands", {}).get(entry_pos, [])

        used = set()
        for item in state.get("playedCards", []) + state.get("currentTrick", []):
            used.add(card_key(item["card"]["suit"], item["card"]["rank"]))

        avail = [c for c in known if card_key(c["suit"], c["rank"]) not in used]
        if not avail:
            avail = [c for c in fallback if card_key(c["suit"], c["rank"]) not in used]

        if not avail:
            raise RuntimeError(f"No card for {entry_pos} after {len(used)} cards")

        api_request("POST", f"/api/lobby/rooms/{invite_code}/assistant/play",
            {"playerId": player_id,
             "play": {"position": entry_pos, "card": avail[0]}})

    return api_request("GET", f"/api/lobby/rooms/{invite_code}")


# ===================================================================
def test_normal_mode() -> None:
    print("\n" + "=" * 60)
    print("TEST: Normal Mode \u2014 Full Game + Record")
    print("=" * 60)

    clear_record_log()
    player_ids = ["nr-p1", "nr-p2", "nr-p3", "nr-p4"]
    room = create_full_room("record-normal", player_ids)
    invite_code = room["id"]
    hb = HeartbeatLoop(invite_code, player_ids, interval_seconds=10)
    hb.start()

    try:
        final_room = play_normal_game(invite_code, player_ids)
        score = final_room["gameState"]["score"]

        records = wait_for_record_count(1, timeout_seconds=10)
        check(len(records) == 1, f"1 record written (got {len(records)})")
        r = records[0]
        check(r["mode"] == "normal", f"mode=normal: {r['mode']}")
        check(r["status"] == "completed", f"status=completed: {r['status']}")
        check(r["inviteCode"] == invite_code, f"inviteCode matches: {r['inviteCode']}")
        check(r["gameIndex"] == 1, f"gameIndex=1: {r['gameIndex']}")
        check(r["contractResult"] == score["contractResult"],
              f"contractResult matches: {r['contractResult']}")
        check(r["winnerSide"] == score["winnerSide"],
              f"winnerSide matches: {r['winnerSide']}")
        check(r["declarerSide"] is not None, "declarerSide present")
        check("assistantResult" not in r, "no assistantResult field")
    finally:
        hb.stop()


# ===================================================================
def test_assistant_mode() -> None:
    print("\n" + "=" * 60)
    print("TEST: Assistant Mode \u2014 Full Play + Record")
    print("=" * 60)

    clear_record_log()
    player_id = "as-op"
    room = api_request("POST", "/api/lobby/rooms", {
        "roomName": "record-assistant",
        "creatorId": player_id,
        "creatorName": player_id,
        "mode": "assistant",
    })
    invite_code = room["id"]
    hb = HeartbeatLoop(invite_code, [player_id], interval_seconds=10)
    hb.start()

    try:
        final_room = play_assistant_game(invite_code, player_id, "W", "NT", "N")
        state = final_room["assistantState"]
        check(state["phase"] == "finished", f"Game finished: {state['phase']}")

        records = wait_for_record_count(1, timeout_seconds=10)
        check(len(records) == 1, f"1 record written (got {len(records)})")
        r = records[0]
        check(r["mode"] == "assistant", f"mode=assistant: {r['mode']}")
        check(r["status"] == "completed", f"status=completed: {r['status']}")
        check(r["inviteCode"] == invite_code, f"inviteCode matches: {r['inviteCode']}")
        check(r["gameIndex"] == 1, f"gameIndex=1: {r['gameIndex']}")

        ar = r.get("assistantResult", {})
        check(bool(ar), "assistantResult present")
        check(ar.get("completed") is True, f"completed=True: {ar.get('completed')}")
        check(ar.get("playedCount", 0) >= 52, f"playedCount>=52: {ar.get('playedCount')}")
        check(ar.get("operatorPosition") == "W",
              f"operatorPosition=W: {ar.get('operatorPosition')}")
        check(ar.get("strain") == "NT", f"strain=NT: {ar.get('strain')}")
    finally:
        hb.stop()
        api_request("POST", f"/api/lobby/rooms/{invite_code}/dissolve",
                     {"hostId": player_id})


# ===================================================================
def test_exam_mode() -> None:
    print("\n" + "=" * 60)
    print("TEST: Exam Mode \u2014 All 16 Boards + Full Export")
    print("=" * 60)

    clear_record_log()
    exam_name = f"record-exam-{int(time.time())}"
    total_boards = 16
    player_id = "ex-op-full"

    for board_no in range(1, total_boards + 1):
        print(f"  Board {board_no}/{total_boards} ...", end=" ")
        sys.stdout.flush()

        room = api_request("POST", "/api/lobby/rooms", {
            "roomName": f"record-exam-b{board_no}",
            "creatorId": player_id,
            "creatorName": player_id,
            "mode": "exam",
            "examName": exam_name,
        })
        ic = room["id"]
        hb = HeartbeatLoop(ic, [player_id], interval_seconds=10)
        hb.start()

        try:
            api_request("POST", f"/api/lobby/rooms/{ic}/exam/board",
                {"playerId": player_id, "boardNo": board_no})
            play_assistant_game(ic, player_id, "W", "NT", "N")
        finally:
            hb.stop()
            try:
                api_request("POST", f"/api/lobby/rooms/{ic}/dissolve",
                    {"hostId": player_id})
            except RuntimeError:
                pass

        print(" done")

    # After all 16 boards: verify records
    records = wait_for_record_count(total_boards, timeout_seconds=15)
    check(len(records) == total_boards,
          f"{total_boards} records written (got {len(records)})")
    exam_recs = [r for r in records if r.get("mode") == "exam"]
    check(len(exam_recs) == total_boards,
          f"{total_boards} exam records (got {len(exam_recs)})")
    all_completed = all(
        r.get("assistantResult", {}).get("completed") for r in exam_recs
    )
    check(all_completed, "All exam records completed=True")

    # Verify CSV export
    csv_dir = PROJECT_ROOT / "exams"
    safe_name = re.sub(r'[\\/:*?"<>|]', "_", exam_name)
    csv_path = csv_dir / f"exam_sheet_{safe_name}.csv"
    md_path = csv_dir / f"exam_sheet_{safe_name}.md"
    pdf_path = csv_dir / f"exam_sheet_{safe_name}.pdf"

    check(csv_path.exists(), f"CSV export exists: {csv_path.name}")
    csv_content = csv_path.read_text(encoding="utf-8")
    csv_lines = [l for l in csv_content.strip().split("\n") if l.strip()]
    check(len(csv_lines) == total_boards + 2,  # header + 16 boards + total
          f"CSV has {total_boards + 2} lines (got {len(csv_lines)})")
    # Verify each board row has non-empty result column
    for i, line in enumerate(csv_lines[1:], 1):
        cells = line.split(",")
        if i <= total_boards:
            check(len(cells) >= 5, f"CSV row {i} has {len(cells)} cells")

    check(md_path.exists(), f"Markdown export exists: {md_path.name}")
    check(pdf_path.exists(), f"PDF export exists: {pdf_path.name}")
    check(pdf_path.stat().st_size > 1000, f"PDF size > 1KB: {pdf_path.stat().st_size}")

    # Verify totals in CSV
    last_line = csv_lines[-1]
    check(last_line.startswith("合计"), f"CSV ends with total row: {last_line[:20]}")

    # Verify all 16 board numbers in CSV
    csv_board_nos = [l.split(",")[0] for l in csv_lines[1:-1]]
    check(csv_board_nos == [str(i) for i in range(1, 17)],
          f"CSV boards 1-16 in order")

    # Verify markdown content
    md_content = md_path.read_text(encoding="utf-8")
    check("双人赛桥牌期末考试记分表" in md_content, "Markdown has title")
    check(exam_name in md_content, "Markdown has exam name")
    for n in [1, 8, 16]:
        check(f"| {n} |" in md_content, f"Markdown has board {n}")

    # Count data rows in markdown table (exclude header and total)
    md_data_rows = [l for l in md_content.split("\n")
                    if l.startswith("|") and not l.startswith("|---")
                    and "轮次" not in l and "合计" not in l]
    check(len(md_data_rows) == total_boards,
          f"Markdown has {total_boards} data rows (got {len(md_data_rows)})")

    # Cleanup export files
    for p in [csv_path, md_path, pdf_path]:
        try:
            p.unlink(missing_ok=True)
        except Exception:
            pass


# ===================================================================
def test_exam_pdf_generation() -> None:
    print("\n" + "=" * 60)
    print("TEST: Exam PDF Generation \u2014 Markdown + PDF output")
    print("=" * 60)

    script_path = PROJECT_ROOT / "generate_exam_pdf.py"
    check(script_path.exists(), f"Script exists: {script_path.name}")

    exam_name = "RecordTestPDF"
    data = {
        "examName": exam_name,
        "boards": [
            {"boardNo": 1, "vulnerability": "N", "completed": True, "contractStr": "1NT", "resultText": "=", "nsPoints": 90, "ewPoints": 0},
            {"boardNo": 2, "vulnerability": "N-S", "completed": False, "contractStr": "", "resultText": "", "nsPoints": 0, "ewPoints": 0},
            {"boardNo": 3, "vulnerability": "E-W", "completed": True, "contractStr": "2S", "resultText": "+1", "nsPoints": 0, "ewPoints": -140},
        ],
    }

    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            input=json.dumps(data),
            capture_output=True, text=True, timeout=30,
            cwd=str(PROJECT_ROOT),
        )
        check(result.returncode == 0, f"Script exit code 0: {result.returncode}")

        # Parse JSON output line
        out_lines = result.stdout.strip().split("\n")
        json_line = next((l for l in out_lines if l.startswith("{")), None)
        check(json_line is not None, "JSON output line found")

        paths = json.loads(json_line) if json_line else {}
        md_path = Path(paths.get("markdown", ""))
        pdf_path = Path(paths.get("pdf", ""))

        check(md_path.exists(), f"Markdown file exists: {md_path.name}")
        check(md_path.stat().st_size > 50, f"Markdown file size: {md_path.stat().st_size}")
        md_content = md_path.read_text(encoding="utf-8")
        check("双人赛桥牌期末考试记分表" in md_content, "Markdown contains title")
        check(exam_name in md_content, f"Markdown contains exam name: {exam_name}")
        check("+1" in md_content or "=" in md_content, "Markdown contains result data")

        check(pdf_path.exists(), f"PDF file exists: {pdf_path.name}")
        check(pdf_path.stat().st_size > 1000, f"PDF file size: {pdf_path.stat().st_size}")

        # Cleanup test files
        md_path.unlink(missing_ok=True)
        pdf_path.unlink(missing_ok=True)
    except Exception as e:
        check(False, f"PDF generation: {e}")


# ===================================================================
def main() -> None:
    global passed, failed, errors
    print("=" * 60)
    print("RecordTest \u2014 BridgeMaster 3-Mode Game Record Test")
    print(f"Server: {BASE_URL}")
    print(f"Log: {RECORD_LOG_PATH}")
    print("=" * 60)

    test_normal_mode()
    test_assistant_mode()
    test_exam_mode()
    test_exam_pdf_generation()

    print()
    print("=" * 60)
    total = passed + failed
    print(f"  {total} checks \u2014 {passed} passed, {failed} failed")
    if failed > 0:
        print()
        print("  Failures:")
        for err in errors:
            print(f"    \u2022 {err}")
    print("=" * 60)
    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
