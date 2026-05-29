import json
import os
import threading
import time
from typing import Any, Callable, Dict, Iterable, List, Optional
from urllib import error, request


BASE_URL = os.environ.get("BRIDGE_BASE_URL", "http://localhost:3001")


def api_request(method: str, path: str, payload: Optional[Dict[str, Any]] = None, timeout: int = 20) -> Any:
	url = f"{BASE_URL}{path}"
	data = None
	headers = {"Content-Type": "application/json"}

	if payload is not None:
		data = json.dumps(payload).encode("utf-8")

	req = request.Request(url=url, data=data, headers=headers, method=method)

	try:
		with request.urlopen(req, timeout=timeout) as resp:
			body = resp.read().decode("utf-8")
			if not body:
				return None
			return json.loads(body)
	except error.HTTPError as http_err:
		detail = http_err.read().decode("utf-8", errors="ignore")
		raise RuntimeError(f"HTTP {http_err.code} {method} {path}: {detail}") from http_err
	except error.URLError as url_err:
		raise RuntimeError(f"Cannot connect to server at {BASE_URL}: {url_err}") from url_err


def read_sse_snapshot(invite_code: str, timeout: int = 20) -> Dict[str, Any]:
	url = f"{BASE_URL}/api/lobby/rooms/{invite_code}/stream"
	req = request.Request(url=url, method="GET", headers={"Accept": "text/event-stream"})

	with request.urlopen(req, timeout=timeout) as resp:
		event_name = "message"
		event_data: List[str] = []

		for raw_line in resp:
			line = raw_line.decode("utf-8", errors="ignore").strip()

			if not line:
				if event_name == "snapshot" and event_data:
					return json.loads("".join(event_data))
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

	raise RuntimeError("Did not receive SSE snapshot.")


def create_room(room_name: str, creator_id: str, creator_name: Optional[str] = None) -> Dict[str, Any]:
	return api_request(
		"POST",
		"/api/lobby/rooms",
		{"roomName": room_name, "creatorId": creator_id, "creatorName": creator_name or creator_id},
	)


def join_standard_players(invite_code: str, player_ids: Iterable[str]) -> None:
	for player_id in player_ids:
		api_request(
			"POST",
			f"/api/lobby/rooms/{invite_code}/join",
			{"playerId": player_id, "playerName": player_id},
		)


def seat_players(invite_code: str, assignments: Iterable[tuple[str, str]]) -> None:
	for player_id, position in assignments:
		api_request(
			"POST",
			f"/api/lobby/rooms/{invite_code}/sit",
			{"playerId": player_id, "position": position},
		)


def create_full_room(room_name: str, player_ids: List[str]) -> Dict[str, Any]:
	room = create_room(room_name, player_ids[0], player_ids[0])
	invite_code = room["id"]
	join_standard_players(invite_code, player_ids[1:])
	seat_players(invite_code, [(player_ids[0], "N"), (player_ids[1], "E"), (player_ids[2], "S"), (player_ids[3], "W")])
	return api_request("GET", f"/api/lobby/rooms/{invite_code}")


def assert_event_history_contains(invite_code: str, required_types: List[str]) -> List[str]:
	snapshot = read_sse_snapshot(invite_code)
	event_types = [event["type"] for event in snapshot["events"]]
	for required in required_types:
		assert required in event_types, f"Missing event {required}. Actual events: {event_types}"
	return event_types


class HeartbeatLoop:
	def __init__(self, invite_code: str, player_ids: Iterable[str], interval_seconds: float = 15.0):
		self.invite_code = invite_code
		self.player_ids = list(player_ids)
		self.interval_seconds = interval_seconds
		self._stop = threading.Event()
		self._thread: threading.Thread | None = None

	def start(self) -> None:
		if self._thread and self._thread.is_alive():
			return

		self._thread = threading.Thread(target=self._run, daemon=True)
		self._thread.start()

	def stop(self) -> None:
		self._stop.set()
		if self._thread:
			self._thread.join(timeout=2)

	def _run(self) -> None:
		while not self._stop.is_set():
			for player_id in self.player_ids:
				try:
					api_request("POST", f"/api/lobby/rooms/{self.invite_code}/heartbeat", {"playerId": player_id}, timeout=10)
				except Exception:
					pass

			if self._stop.wait(self.interval_seconds):
				return


def listen_sse_events(invite_code: str, stop_when: Callable[[Dict[str, Any]], bool], timeout: int = 60) -> List[Dict[str, Any]]:
	url = f"{BASE_URL}/api/lobby/rooms/{invite_code}/stream"
	req = request.Request(url=url, method="GET", headers={"Accept": "text/event-stream"})
	results: List[Dict[str, Any]] = []

	with request.urlopen(req, timeout=timeout) as resp:
		event_name = "message"
		event_data: List[str] = []

		for raw_line in resp:
			line = raw_line.decode("utf-8", errors="ignore").strip()

			if not line:
				if event_data:
					payload = json.loads("".join(event_data))
					event = {"event": event_name, "data": payload}
					results.append(event)
					if stop_when(event):
						return results
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

	return results