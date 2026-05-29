import json
import threading
import time
from typing import Any, Dict, List

from test_utils import HeartbeatLoop, api_request, assert_event_history_contains, create_full_room, listen_sse_events


def pick_legal_card(game_state: Dict[str, Any], turn: str) -> Dict[str, str]:
	hand: List[Dict[str, str]] = game_state["hands"][turn]
	current_trick = game_state.get("currentTrick")

	if current_trick and current_trick.get("cards"):
		lead_suit = current_trick["cards"][0]["card"]["suit"]
		for card in hand:
			if card["suit"] == lead_suit:
				return card

	return hand[0]


def sse_listen_until_finished(invite_code: str, events: List[Dict[str, Any]], finished: threading.Event) -> None:
	try:
		results = listen_sse_events(
			invite_code,
			lambda event: event.get("event") == "room_event" and event.get("data", {}).get("type") == "game_finished",
		)
		events.extend(results)
		if any(event.get("event") == "room_event" and event.get("data", {}).get("type") == "game_finished" for event in results):
			finished.set()
	except Exception as exc:  # noqa: BLE001
		events.append({"event": "listener_error", "data": str(exc)})


def main() -> None:
	room = create_full_room("game-test-room", ["p1", "p2", "p3", "p4"])
	invite_code = room["id"]
	assert room["gameState"]["phase"] == "bidding", room["gameState"]
	assert_event_history_contains(invite_code, ["room_created", "player_joined", "player_sat", "game_started"])
	heartbeats = HeartbeatLoop(invite_code, ["p1", "p2", "p3", "p4"], interval_seconds=10)
	heartbeats.start()

	sse_events: List[Dict[str, Any]] = []
	finished_event = threading.Event()
	listener = threading.Thread(
		target=sse_listen_until_finished,
		args=(invite_code, sse_events, finished_event),
		daemon=True,
	)
	listener.start()

	try:
		api_request(
			"POST",
			f"/api/lobby/rooms/{invite_code}/bid",
			{"playerId": "p1", "bid": {"type": "bid", "level": 1, "strain": "NT"}},
		)
		api_request("POST", f"/api/lobby/rooms/{invite_code}/bid", {"playerId": "p2", "bid": {"type": "pass"}})
		api_request("POST", f"/api/lobby/rooms/{invite_code}/bid", {"playerId": "p3", "bid": {"type": "pass"}})
		api_request("POST", f"/api/lobby/rooms/{invite_code}/bid", {"playerId": "p4", "bid": {"type": "pass"}})

		while True:
			room_state = api_request("GET", f"/api/lobby/rooms/{invite_code}")
			game_state = room_state["gameState"]
			phase = game_state["phase"]

			if phase == "finished":
				break

			if phase != "playing":
				time.sleep(0.05)
				continue

			turn = game_state["turn"]
			assert turn in ("N", "E", "S", "W"), f"Unexpected turn: {turn}"
			player_id = game_state["playersByPosition"][turn]
			card = pick_legal_card(game_state, turn)

			api_request("POST", f"/api/lobby/rooms/{invite_code}/play", {"playerId": player_id, "card": card})

		final_room = api_request("GET", f"/api/lobby/rooms/{invite_code}")
		score = final_room["gameState"]["score"]
		assert score is not None, "Score must exist after game finishes"

		required_keys = ["contractResult", "nsPoints", "ewPoints", "winnerSide", "playerPoints"]
		for key in required_keys:
			assert key in score, f"Missing score field: {key}"

		finished_event.wait(timeout=5)
		assert any(
			evt.get("event") == "room_event" and evt.get("data", {}).get("type") == "game_finished"
			for evt in sse_events
		), "Did not receive game_finished event from SSE stream"
		assert_event_history_contains(invite_code, ["bid_submitted", "card_submitted", "game_finished"])

		print("=== GameTest Passed ===")
		print(f"InviteCode: {invite_code}")
		print(f"Result: {score['contractResult']}")
		print(f"NS: {score['nsPoints']}  EW: {score['ewPoints']}")
		print(f"Winner: {score['winnerSide']}")
		print(f"PlayerPoints: {json.dumps(score['playerPoints'], ensure_ascii=False)}")
	finally:
		heartbeats.stop()


if __name__ == "__main__":
	main()
