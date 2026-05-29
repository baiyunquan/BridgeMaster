import json
import time
from pathlib import Path
from typing import Any, Dict, List

from test_utils import api_request, create_full_room


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RECORD_LOG_PATH = PROJECT_ROOT / "logs" / "game-records.jsonl"


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


def pick_legal_card(game_state: Dict[str, Any], turn: str) -> Dict[str, str]:
	hand: List[Dict[str, str]] = game_state["hands"][turn]
	current_trick = game_state.get("currentTrick")

	if current_trick and current_trick.get("cards"):
		lead_suit = current_trick["cards"][0]["card"]["suit"]
		for card in hand:
			if card["suit"] == lead_suit:
				return card

	return hand[0]


def finish_game(invite_code: str, player_ids: List[str]) -> Dict[str, Any]:
	api_request(
		"POST",
		f"/api/lobby/rooms/{invite_code}/bid",
		{"playerId": player_ids[0], "bid": {"type": "bid", "level": 1, "strain": "NT"}},
	)
	api_request("POST", f"/api/lobby/rooms/{invite_code}/bid", {"playerId": player_ids[1], "bid": {"type": "pass"}})
	api_request("POST", f"/api/lobby/rooms/{invite_code}/bid", {"playerId": player_ids[2], "bid": {"type": "pass"}})
	api_request("POST", f"/api/lobby/rooms/{invite_code}/bid", {"playerId": player_ids[3], "bid": {"type": "pass"}})

	while True:
		room = api_request("GET", f"/api/lobby/rooms/{invite_code}")
		game_state = room["gameState"]
		if game_state["phase"] == "finished":
			return room

		turn = game_state["turn"]
		player_id = game_state["playersByPosition"][turn]
		card = pick_legal_card(game_state, turn)
		api_request("POST", f"/api/lobby/rooms/{invite_code}/play", {"playerId": player_id, "card": card})


def test_completed_game_record() -> None:
	clear_record_log()
	player_ids = ["p1", "p2", "p3", "p4"]
	room = create_full_room("record-complete", player_ids)
	invite_code = room["id"]
	final_room = finish_game(invite_code, player_ids)

	records = wait_for_record_count(1)
	assert len(records) == 1, records
	record = records[0]
	assert record["inviteCode"] == invite_code, record
	assert record["status"] == "completed", record
	assert record["contractResult"] == final_room["gameState"]["score"]["contractResult"], record
	assert record["winnerSide"] == final_room["gameState"]["score"]["winnerSide"], record
	assert record["gameIndex"] == 1, record


def test_aborted_game_then_new_game_record() -> None:
	clear_record_log()
	player_ids = ["reset-p1", "reset-p2", "reset-p3", "reset-p4"]
	room = create_full_room("record-reset", player_ids)
	invite_code = room["id"]

	api_request("POST", f"/api/lobby/rooms/{invite_code}/leave", {"playerId": "reset-p2"})
	records = wait_for_record_count(1)
	assert len(records) == 1, records
	assert records[0]["status"] == "aborted", records[0]
	assert records[0]["terminationReason"] == "player_left", records[0]
	assert records[0]["gameIndex"] == 1, records[0]

	api_request("POST", f"/api/lobby/rooms/{invite_code}/join", {"playerId": "reset-p2", "playerName": "reset-p2"})
	api_request("POST", f"/api/lobby/rooms/{invite_code}/sit", {"playerId": "reset-p1", "position": "N"})
	api_request("POST", f"/api/lobby/rooms/{invite_code}/sit", {"playerId": "reset-p2", "position": "E"})
	api_request("POST", f"/api/lobby/rooms/{invite_code}/sit", {"playerId": "reset-p3", "position": "S"})
	api_request("POST", f"/api/lobby/rooms/{invite_code}/sit", {"playerId": "reset-p4", "position": "W"})

	finish_game(invite_code, player_ids)
	records = wait_for_record_count(2)
	assert len(records) == 2, records
	assert records[1]["status"] == "completed", records[1]
	assert records[1]["gameIndex"] == 2, records[1]


def main() -> None:
	test_completed_game_record()
	test_aborted_game_then_new_game_record()
	print("=== RecordTest Passed ===")
	print(f"Record log path: {RECORD_LOG_PATH}")


if __name__ == "__main__":
	main()