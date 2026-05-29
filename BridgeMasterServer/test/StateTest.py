import time
import os
from typing import List

from test_utils import api_request, assert_event_history_contains, create_full_room, create_room


HEARTBEAT_WAIT_SECONDS = float(os.environ.get("BRIDGE_PRESENCE_WAIT_SECONDS", "65"))
HEARTBEAT_KEEPALIVE_SECONDS = float(os.environ.get("BRIDGE_KEEPALIVE_INTERVAL_SECONDS", "2"))


def expect_room_missing(invite_code: str) -> None:
	try:
		api_request("GET", f"/api/lobby/rooms/{invite_code}")
	except RuntimeError as exc:
		if "HTTP 400" in str(exc) and "Room not found" in str(exc):
			return
		raise

	raise AssertionError(f"Room {invite_code} should have been released.")


def test_waiting_room_release() -> None:
	room = create_room("state-waiting", "waiting-p1", "Waiting 1")
	invite_code = room["id"]
	api_request("POST", f"/api/lobby/rooms/{invite_code}/join", {"playerId": "waiting-p2", "playerName": "Waiting 2"})
	event_types = assert_event_history_contains(invite_code, ["room_created", "player_joined"])
	assert event_types[:2] == ["room_created", "player_joined"], f"Unexpected event history: {event_types}"

	room_after_leave = api_request("POST", f"/api/lobby/rooms/{invite_code}/leave", {"playerId": "waiting-p2"})
	assert len(room_after_leave["players"]) == 1, room_after_leave
	assert room_after_leave["players"][0]["id"] == "waiting-p1", room_after_leave

	result = api_request("POST", f"/api/lobby/rooms/{invite_code}/leave", {"playerId": "waiting-p1"})
	assert result is None, result
	expect_room_missing(invite_code)


def test_in_game_release_resets_room() -> None:
	room = create_full_room("state-active", ["active-p1", "active-p2", "active-p3", "active-p4"])
	invite_code = room["id"]

	assert room["gameState"]["phase"] == "bidding", room["gameState"]

	after_leave = api_request("POST", f"/api/lobby/rooms/{invite_code}/leave", {"playerId": "active-p2"})
	assert after_leave["gameState"]["phase"] == "waiting", after_leave["gameState"]
	assert sorted(player["id"] for player in after_leave["players"]) == ["active-p1", "active-p3", "active-p4"], after_leave
	assert all(player["position"] is None for player in after_leave["players"]), after_leave["players"]
	event_types = assert_event_history_contains(invite_code, ["player_left", "game_reset"])
	assert "player_left" in event_types, event_types
	assert "game_reset" in event_types, event_types


def test_heartbeat_timeout_release() -> None:
	room = api_request(
		"POST",
		"/api/lobby/rooms",
		{"roomName": "state-heartbeat", "creatorId": "hb-p1", "creatorName": "Heartbeat 1"},
	)
	invite_code = room["id"]
	api_request("POST", f"/api/lobby/rooms/{invite_code}/join", {"playerId": "hb-p2", "playerName": "Heartbeat 2"})

	deadline = time.time() + HEARTBEAT_WAIT_SECONDS
	while time.time() < deadline:
		api_request("POST", f"/api/lobby/rooms/{invite_code}/heartbeat", {"playerId": "hb-p1"})
		time.sleep(min(HEARTBEAT_KEEPALIVE_SECONDS, max(0.1, deadline - time.time())))

	remaining_ids: List[str] = []
	poll_deadline = time.time() + 20
	while time.time() < poll_deadline:
		api_request("POST", f"/api/lobby/rooms/{invite_code}/heartbeat", {"playerId": "hb-p1"})
		room_after_timeout = api_request("GET", f"/api/lobby/rooms/{invite_code}")
		remaining_ids = sorted(player["id"] for player in room_after_timeout["players"])
		if remaining_ids == ["hb-p1"]:
			break
		time.sleep(1)

	assert remaining_ids == ["hb-p1"], remaining_ids

	api_request("POST", f"/api/lobby/rooms/{invite_code}/leave", {"playerId": "hb-p1"})
	expect_room_missing(invite_code)


def main() -> None:
	test_waiting_room_release()
	test_in_game_release_resets_room()
	test_heartbeat_timeout_release()
	print("=== StateTest Passed ===")
	print(f"Heartbeat wait seconds: {HEARTBEAT_WAIT_SECONDS}")


if __name__ == "__main__":
	main()
