import json
import os
import threading
import time
from typing import Any, Dict, List
from urllib import error, request


BASE_URL = os.environ.get("BRIDGE_BASE_URL", "http://localhost:3001")


def api_request(method: str, path: str, payload: Dict[str, Any] | None = None) -> Any:
	url = f"{BASE_URL}{path}"
	data = None
	headers = {"Content-Type": "application/json"}

	if payload is not None:
		data = json.dumps(payload).encode("utf-8")

	req = request.Request(url=url, data=data, headers=headers, method=method)

	try:
		with request.urlopen(req, timeout=15) as resp:
			body = resp.read().decode("utf-8")
			if not body:
				return None
			return json.loads(body)
	except error.HTTPError as http_err:
		detail = http_err.read().decode("utf-8", errors="ignore")
		raise RuntimeError(f"HTTP {http_err.code} {method} {path}: {detail}") from http_err
	except error.URLError as url_err:
		raise RuntimeError(f"Cannot connect to server at {BASE_URL}: {url_err}") from url_err


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
	url = f"{BASE_URL}/api/lobby/rooms/{invite_code}/stream"
	req = request.Request(url=url, method="GET", headers={"Accept": "text/event-stream"})

	try:
		with request.urlopen(req, timeout=60) as resp:
			event_name = "message"
			event_data: List[str] = []

			for raw_line in resp:
				line = raw_line.decode("utf-8", errors="ignore").strip()

				if not line:
					if event_data:
						try:
							payload = json.loads("".join(event_data))
						except json.JSONDecodeError:
							payload = {"raw": "".join(event_data)}

						evt = {"event": event_name, "data": payload}
						events.append(evt)

						if event_name == "room_event" and payload.get("type") == "game_finished":
							finished.set()
							return

					event_name = "message"
					event_data = []
					continue

				if line.startswith(":"):
					continue

				if line.startswith("event:"):
					event_name = line[6:].strip()
					continue

				if line.startswith("data:"):
					event_data.append(line[5:].strip())
	except Exception as exc:  # noqa: BLE001
		events.append({"event": "listener_error", "data": str(exc)})


def main() -> None:
	room = api_request(
		"POST",
		"/api/lobby/rooms",
		{"roomName": "Python完整测试房", "creatorId": "p1", "creatorName": "玩家1"},
	)
	invite_code = room["id"]

	sse_events: List[Dict[str, Any]] = []
	finished_event = threading.Event()
	listener = threading.Thread(
		target=sse_listen_until_finished,
		args=(invite_code, sse_events, finished_event),
		daemon=True,
	)
	listener.start()

	for idx in range(2, 5):
		api_request(
			"POST",
			f"/api/lobby/rooms/{invite_code}/join",
			{"playerId": f"p{idx}", "playerName": f"玩家{idx}"},
		)

	seats = [("p1", "N"), ("p2", "E"), ("p3", "S"), ("p4", "W")]
	for player_id, position in seats:
		api_request("POST", f"/api/lobby/rooms/{invite_code}/sit", {"playerId": player_id, "position": position})

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

	required_keys = [
		"contractResult",
		"nsPoints",
		"ewPoints",
		"winnerSide",
		"playerPoints",
	]
	for key in required_keys:
		assert key in score, f"Missing score field: {key}"

	finished_event.wait(timeout=5)
	assert any(
		evt.get("event") == "room_event" and evt.get("data", {}).get("type") == "game_finished"
		for evt in sse_events
	), "Did not receive game_finished event from SSE stream"

	print("=== GameTest Passed ===")
	print(f"InviteCode: {invite_code}")
	print(f"Result: {score['contractResult']}")
	print(f"NS: {score['nsPoints']}  EW: {score['ewPoints']}")
	print(f"Winner: {score['winnerSide']}")
	print(f"PlayerPoints: {json.dumps(score['playerPoints'], ensure_ascii=False)}")


if __name__ == "__main__":
	main()
