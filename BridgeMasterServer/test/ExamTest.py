"""
ExamTest.py — End-to-end test for BridgeMaster exam mode.

Prerequisites:
  - BridgeMasterServer running on http://localhost:3001
  - DDS service may or may not be running (we test creation + selection paths)

Usage:
  python BridgeMasterServer/test/ExamTest.py

Optional env:
  BRIDGE_BASE_URL=http://localhost:3001
"""

import json
import os
import sys
import time
import urllib.parse
from typing import Any, Dict, List, Optional

# Add parent so we can import test_utils
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "."))
from test_utils import api_request, BASE_URL


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
PLAYER_ID = "exam-tester-001"
EXAM_NAME = "auto-exam-test"
POSITIONS = ["N", "E", "S", "W"]
RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
SUITS = ["C", "D", "H", "S"]

# Card utilities
def card_key(suit: str, rank: str) -> str:
	return f"{suit}-{rank}"

def make_card(suit: str, rank: str) -> Dict[str, str]:
	return {"suit": suit, "rank": rank}

def all_cards() -> List[Dict[str, str]]:
	return [make_card(s, r) for s in SUITS for r in RANKS]


# ---------------------------------------------------------------------------
# Test counters
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Step 1: List exam boards
# ---------------------------------------------------------------------------
def step_list_boards():
	print("\n=== Step 1: List exam boards ===")

	try:
		resp = api_request("GET", f"/api/exams/boards?examName={urllib.parse.quote(EXAM_NAME)}")
		check("boards" in resp, "Response contains boards array")
		check(len(resp["boards"]) > 0, f"Got {len(resp['boards'])} boards")
		check(resp["examName"] == EXAM_NAME, f"examName matches: {resp['examName']}")

		# Verify board structure
		first = resp["boards"][0]
		check("boardNo" in first, "Board has boardNo")
		check("vulnerability" in first, "Board has vulnerability")
		check("completed" in first, "Board has completed flag")

		return resp["boards"]
	except RuntimeError as e:
		check(False, f"List boards: {e}")
		return []


# ---------------------------------------------------------------------------
# Step 2: Create exam room (without boardNo — board selected inside)
# ---------------------------------------------------------------------------
def step_create_exam_room() -> Optional[str]:
	print("\n=== Step 2: Create exam room ===")

	try:
		room = api_request("POST", "/api/lobby/rooms", {
			"roomName": "考试测试桌",
			"creatorId": PLAYER_ID,
			"creatorName": PLAYER_ID,
			"mode": "exam",
			"examName": EXAM_NAME,
		})
		invite_code = room.get("id", "")
		check(bool(invite_code), f"Room created, invite_code={invite_code}")
		check(room.get("mode") == "exam", f"Room mode is exam: {room.get('mode')}")
		check(room.get("examInfo", {}).get("examName") == EXAM_NAME, f"examName matches: {room.get('examInfo', {}).get('examName')}")
		check(room.get("examInfo", {}).get("boardNo") == 0, f"boardNo starts as 0: {room.get('examInfo', {}).get('boardNo')}")
		return invite_code
	except RuntimeError as e:
		check(False, f"Create exam room: {e}")
		return None


# ---------------------------------------------------------------------------
# Step 3: Select a board inside the exam room
# ---------------------------------------------------------------------------
def step_select_board(invite_code: str, board_no: int) -> bool:
	print(f"\n=== Step 3: Select board {board_no} ===")

	try:
		room = api_request("POST", f"/api/lobby/rooms/{invite_code}/exam/board", {
			"playerId": PLAYER_ID,
			"boardNo": board_no,
		})
		check(room.get("examInfo", {}).get("boardNo") == board_no, f"boardNo set to {board_no}")
		vuln = room.get("examInfo", {}).get("vulnerability", "")
		check(bool(vuln), f"vulnerability filled: {vuln}")
		return True
	except RuntimeError as e:
		check(False, f"Select board {board_no}: {e}")
		return False


# ---------------------------------------------------------------------------
# Step 4: Set operator + contract on exam room
# ---------------------------------------------------------------------------
def step_setup_contract(invite_code: str):
	print("\n=== Step 4: Set operator and contract ===")

	try:
		# Set operator to W (not dummy S, distinct from declarer N)
		room = api_request("POST", f"/api/lobby/rooms/{invite_code}/assistant/operator", {
			"playerId": PLAYER_ID,
			"position": "W",
		})
		check(room.get("assistantState", {}).get("operatorPosition") == "W", "Operator set to W")

		# Set contract (vulnerability is forced from board config in exam mode)
		room = api_request("POST", f"/api/lobby/rooms/{invite_code}/assistant/contract", {
			"playerId": PLAYER_ID,
			"contract": {"strain": "NT", "declarer": "N"},
			"vulnerable": 0,
		})
		state = room.get("assistantState", {})
		check(state.get("contract", {}).get("strain") == "NT", "Contract strain set to NT")
		check(state.get("contract", {}).get("declarer") == "N", "Declarer set to N")
		check(state.get("dummyPosition") == "S", f"Dummy is S: {state.get('dummyPosition')}")
		check(state.get("entryTarget") == "operator_hand", f"Entry target is operator_hand: {state.get('entryTarget')}")
		return True
	except RuntimeError as e:
		check(False, f"Setup contract: {e}")
		return False


# ---------------------------------------------------------------------------
# Step 5: Fill known hands and play a few tricks
# ---------------------------------------------------------------------------
def step_play_partial_board(invite_code: str):
	print("\n=== Step 5: Upload hands and play partial board ===")

	try:
		room = api_request("GET", f"/api/lobby/rooms/{invite_code}")
		state = room.get("assistantState", {})
		op = state.get("operatorPosition", "W")
		dummy = state.get("dummyPosition", "S")

		# Split 52 cards: 13 for operator (W), 13 for dummy (S)
		deck = all_cards()
		op_cards = deck[:13]    # → W (known)
		dummy_cards = deck[13:26]  # → S (known)
		fallback_cards = deck[26:] # → E + N (not disclosed)

		# Upload operator hand (13 cards for W)
		room = api_request("POST", f"/api/lobby/rooms/{invite_code}/assistant/hands/{op}", {
			"playerId": PLAYER_ID,
			"cards": op_cards,
		})
		state = room.get("assistantState", {})
		check(state.get("entryTarget") == "dummy_hand", f"After operator hand, target is dummy_hand: {state.get('entryTarget')}")

		# Upload dummy hand (13 cards for S)
		room = api_request("POST", f"/api/lobby/rooms/{invite_code}/assistant/hands/{dummy}", {
			"playerId": PLAYER_ID,
			"cards": dummy_cards,
		})
		state = room.get("assistantState", {})
		check(state.get("entryTarget") == "opening_lead", f"After dummy hand, target is opening_lead: {state.get('entryTarget')}")
		check(state.get("turn") is not None, "Turn is set for opening lead")

		# Play 12 cards (3 full tricks) to verify game progression
		played_count = len(state.get("playedCards", [])) + len(state.get("currentTrick", []))
		target = played_count + 12
		last_err = ""

		while played_count < target:
			room = api_request("GET", f"/api/lobby/rooms/{invite_code}")
			state = room.get("assistantState", {})
			if state.get("phase") == "finished":
				break

			entry_pos = state.get("entryPosition", state.get("turn"))
			known = state.get("knownHands", {}).get(entry_pos, [])

			# Build used card key set
			used = set()
			for item in state.get("playedCards", []) + state.get("currentTrick", []):
				used.add(card_key(item["card"]["suit"], item["card"]["rank"]))

			# Pick from known first, then fallback
			available = [c for c in known if card_key(c["suit"], c["rank"]) not in used]
			if not available:
				available = [c for c in fallback_cards if card_key(c["suit"], c["rank"]) not in used]

			if not available:
				last_err = f"No card available for {entry_pos} at play {played_count + 1}"
				break

			card = available[0]
			api_request("POST", f"/api/lobby/rooms/{invite_code}/assistant/play", {
				"playerId": PLAYER_ID,
				"play": {"position": entry_pos, "card": card},
			})
			played_count += 1

		check(not last_err, last_err or "No errors during play")
		check(played_count >= target or state.get("phase") == "finished",
		      f"Played {played_count} cards (target {target})")

		return True
	except RuntimeError as e:
		check(False, f"Play board: {e}")
		return False


# ---------------------------------------------------------------------------
# Step 6: Verify board NOT completed (partial play doesn't lock it)
# ---------------------------------------------------------------------------
def step_verify_board_not_completed(invite_code: str, board_no: int):
	print(f"\n=== Step 6: Verify board {board_no} is NOT locked (partial play) ===")

	try:
		resp = api_request("GET", f"/api/exams/boards?examName={urllib.parse.quote(EXAM_NAME)}")
		target = next((b for b in resp["boards"] if b["boardNo"] == board_no), None)
		check(target is not None, f"Board {board_no} found in listing")
		check(not target["completed"], f"Board {board_no} is NOT completed: {target['completed']}")
		return True
	except RuntimeError as e:
		check(False, f"Verify board not completed: {e}")
		return False


# ---------------------------------------------------------------------------
# Step 7: Verify game records contain abort entry after dissolve
# ---------------------------------------------------------------------------
def step_verify_abort_record(invite_code: str):
	print("\n=== Step 7: Dissolve room and verify abort record ===")

	try:
		# Leave room (triggers abort via releasePlayerFromRoom when last player leaves)
		api_request("POST", f"/api/lobby/rooms/{invite_code}/leave", {"playerId": PLAYER_ID})
		time.sleep(0.5)

		records = api_request("GET", "/api/game-records/data")
		# Find our specific record by inviteCode
		our_records = [r for r in records if r.get("inviteCode") == invite_code]
		check(len(our_records) >= 1, f"Our record found for {invite_code}: {len(our_records)}")

		latest = our_records[-1]
		check(latest.get("status") == "aborted", f"Latest record status: {latest.get('status')}")
		ar = latest.get("assistantResult", {})
		check(ar.get("completed") is False, "assistantResult.completed is False (aborted)")
		check(ar.get("playedCount", 0) > 0, f"Played cards recorded: {ar.get('playedCount')}")
		return True
	except RuntimeError as e:
		check(False, f"Verify abort record: {e}")
		return False


# ---------------------------------------------------------------------------
# Step 8: Negative test — create exam room and try selecting invalid/completed board
# ---------------------------------------------------------------------------
def step_negative_invalid_board():
	print("\n=== Step 8: Negative test — invalid board selection ===")

	try:
		room = api_request("POST", "/api/lobby/rooms", {
			"roomName": "负测试桌",
			"creatorId": f"{PLAYER_ID}-neg",
			"creatorName": f"{PLAYER_ID}-neg",
			"mode": "exam",
			"examName": EXAM_NAME,
		})
		invite_code = room.get("id", "")
		check(bool(invite_code), "Negative test room created")

		# Try selecting board 99999 (non-existent)
		try:
			api_request("POST", f"/api/lobby/rooms/{invite_code}/exam/board", {
				"playerId": f"{PLAYER_ID}-neg",
				"boardNo": 99999,
			})
			check(False, "Selecting non-existent board should fail")
		except RuntimeError:
			check(True, "Non-existent board correctly rejected")

		# Dissolve negative test room
		api_request("POST", f"/api/lobby/rooms/{invite_code}/dissolve", {
			"hostId": f"{PLAYER_ID}-neg",
		})
		return True
	except RuntimeError as e:
		check(False, f"Negative test: {e}")
		return False


# ---------------------------------------------------------------------------
# Step 9: Complete all 16 boards and verify exam sheet preview
# ---------------------------------------------------------------------------
def step_full_exam_sheet():
	print("\n=== Step 9: Complete all 16 boards + verify sheet preview ===")

	exam_name = f"full-sheet-{int(time.time())}"
	player_id = "sheet-tester"
	total = 16

	for board_no in range(1, total + 1):
		sys.stdout.write(f"  Board {board_no}/{total} ... ")
		sys.stdout.flush()

		try:
			room = api_request("POST", "/api/lobby/rooms", {
				"roomName": f"sheet-b{board_no}",
				"creatorId": player_id,
				"creatorName": player_id,
				"mode": "exam",
				"examName": exam_name,
			})
			ic = room["id"]

			api_request("POST", f"/api/lobby/rooms/{ic}/exam/board",
				{"playerId": player_id, "boardNo": board_no})

			# Play full 52-card game
			deck = all_cards()
			api_request("POST", f"/api/lobby/rooms/{ic}/assistant/operator",
				{"playerId": player_id, "position": "W"})
			api_request("POST", f"/api/lobby/rooms/{ic}/assistant/contract",
				{"playerId": player_id,
				 "contract": {"strain": "NT", "declarer": "N"},
				 "vulnerable": 0})

			state = api_request("GET", f"/api/lobby/rooms/{ic}")["assistantState"]
			dummy = state["dummyPosition"]
			op_cards = deck[:13]
			dummy_cards = deck[13:26]
			fallback = deck[26:]

			api_request("POST", f"/api/lobby/rooms/{ic}/assistant/hands/W",
				{"playerId": player_id, "cards": op_cards})
			api_request("POST", f"/api/lobby/rooms/{ic}/assistant/hands/{dummy}",
				{"playerId": player_id, "cards": dummy_cards})

			for _ in range(52):
				room = api_request("GET", f"/api/lobby/rooms/{ic}")
				s = room["assistantState"]
				if s.get("phase") == "finished":
					break
				ep = s["entryPosition"]
				known = s.get("knownHands", {}).get(ep, [])
				used = set()
				for item in s.get("playedCards", []) + s.get("currentTrick", []):
					used.add(card_key(item["card"]["suit"], item["card"]["rank"]))
				avail = [c for c in known if card_key(c["suit"], c["rank"]) not in used]
				if not avail:
					avail = [c for c in fallback if card_key(c["suit"], c["rank"]) not in used]
				if avail:
					api_request("POST", f"/api/lobby/rooms/{ic}/assistant/play",
						{"playerId": player_id,
						 "play": {"position": ep, "card": avail[0]}})

			api_request("POST", f"/api/lobby/rooms/{ic}/dissolve", {"hostId": player_id})
			print("done")
		except RuntimeError as e:
			print(f"FAIL: {e}")

	# Verify sheet preview endpoint
	try:
		sheet = api_request("GET", f"/api/exams/sheet/{urllib.parse.quote(exam_name)}")
		check(sheet["examName"] == exam_name, f"Sheet examName: {sheet['examName']}")
		check(sheet["totalBoards"] == total, f"totalBoards={total}: {sheet['totalBoards']}")
		check(sheet["completedCount"] == total, f"completedCount={total}: {sheet['completedCount']}")
		check(len(sheet["boards"]) == total, f"boards length={total}: {len(sheet['boards'])}")

		for b in sheet["boards"]:
			check(b["completed"], f"Board {b['boardNo']} completed")
			check(bool(b["contractStr"]), f"Board {b['boardNo']} has contract")
			check(bool(b["resultText"]), f"Board {b['boardNo']} has result")
			check(isinstance(b["nsPoints"], (int, float)), f"Board {b['boardNo']} nsPoints type")
			check(isinstance(b["ewPoints"], (int, float)), f"Board {b['boardNo']} ewPoints type")

		return True
	except RuntimeError as e:
		check(False, f"Sheet preview: {e}")
		return False


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
def step_cleanup(invite_code: str):
	print("\n=== Cleanup ===")
	if invite_code:
		try:
			api_request("POST", f"/api/lobby/rooms/{invite_code}/dissolve", {"hostId": PLAYER_ID})
			print("  ✅ Exam room dissolved")
		except RuntimeError as e:
			print(f"  ⚠️  Cleanup: {e}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
	global passed, failed, errors

	print("=" * 60)
	print("ExamTest — BridgeMaster Exam Mode End-to-End Test")
	print(f"Server: {BASE_URL}")
	print("=" * 60)

	# Step 1: check boards exist
	boards = step_list_boards()
	if not boards:
		print("\n⚠️  No boards found — exam_sheet.csv may be missing. Tests may still pass for creation paths.")
		first_open_board = 1
	else:
		first_open_board = next((b["boardNo"] for b in boards if not b.get("completed")), boards[0]["boardNo"])
		print(f"  First open board: {first_open_board}")

	# Step 2: create exam room
	invite_code = step_create_exam_room()
	if not invite_code:
		print("\n❌ Cannot proceed without a room. Aborting.")
		print_summary()
		sys.exit(1)

	# Step 3: select a board
	step_select_board(invite_code, first_open_board)

	# Step 4: setup contract
	step_setup_contract(invite_code)

	# Step 5: play partial board
	step_play_partial_board(invite_code)

	# Step 6: verify board NOT locked (partial play)
	step_verify_board_not_completed(invite_code, first_open_board)

	# Step 7: dissolve + verify abort record
	step_verify_abort_record(invite_code)

	# Step 8: negative tests
	invite_code = None  # already dissolved
	step_negative_invalid_board()

	# Step 9: full 16-board sheet test
	step_full_exam_sheet()

	# Summary
	print_summary()


def print_summary():
	print()
	print("=" * 60)
	print(f"  Results: {passed} passed, {failed} failed")
	if failed > 0:
		print()
		print("  Failures:")
		for err in errors:
			print(f"    • {err}")
	print("=" * 60)

	# Return exit code
	if failed > 0:
		sys.exit(1)


if __name__ == "__main__":
	main()
