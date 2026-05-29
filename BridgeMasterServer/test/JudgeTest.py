import json
import time
from typing import Any, Dict, List, Optional, TypedDict

from test_utils import HeartbeatLoop, api_request, assert_event_history_contains, create_full_room


POSITIONS = ["N", "E", "S", "W"]


class ContractDict(TypedDict, total=False):
	level: int
	strain: str
	declarer: str
	side: str
	doubled: bool
	redoubled: bool
	isGameContract: bool


def get_side(position: str) -> str:
	return "NS" if position in ("N", "S") else "EW"


def opposite_side(side: str) -> str:
	return "EW" if side == "NS" else "NS"


def get_undoubled_contract_points(level: int, strain: str) -> int:
	if strain == "NT":
		return 40 + (level - 1) * 30
	if strain in ("H", "S"):
		return level * 30
	return level * 20


def build_player_points(players_by_position: Dict[str, str], ns_points: int, ew_points: int) -> Dict[str, int]:
	return {
		players_by_position["N"]: ns_points,
		players_by_position["S"]: ns_points,
		players_by_position["E"]: ew_points,
		players_by_position["W"]: ew_points,
	}


def judge_score(
	players_by_position: Dict[str, str],
	contract: Optional[ContractDict],
	tricks: List[Dict[str, Any]],
) -> Dict[str, Any]:
	if not contract:
		return {
			"contractResult": "passed-out",
			"nsPoints": 0,
			"ewPoints": 0,
			"winnerSide": "tie",
			"playerPoints": build_player_points(players_by_position, 0, 0),
		}

	declarer_side = contract["side"]
	target_tricks = 6 + contract["level"]
	tricks_won_by_declarer = sum(1 for trick in tricks if get_side(trick.get("winner")) == declarer_side)

	if tricks_won_by_declarer >= target_tricks:
		overtricks = tricks_won_by_declarer - target_tricks
		multiplier = 4 if contract.get("redoubled") else 2 if contract.get("doubled") else 1
		contract_points = get_undoubled_contract_points(contract["level"], contract["strain"]) * multiplier

		if overtricks > 0:
			if contract.get("redoubled"):
				overtrick_points = overtricks * 200
			elif contract.get("doubled"):
				overtrick_points = overtricks * 100
			elif contract["strain"] in ("C", "D"):
				overtrick_points = overtricks * 20
			else:
				overtrick_points = overtricks * 30
		else:
			overtrick_points = 0

		game_bonus = 300 if contract.get("isGameContract") else 50
		slam_bonus = 500 if contract["level"] == 6 else 1000 if contract["level"] == 7 else 0
		insult_bonus = 100 if contract.get("redoubled") else 50 if contract.get("doubled") else 0
		total = contract_points + overtrick_points + game_bonus + slam_bonus + insult_bonus
		ns_points = total if declarer_side == "NS" else 0
		ew_points = total if declarer_side == "EW" else 0

		return {
			"contractResult": "made",
			"declarerSide": declarer_side,
			"contractLevel": contract["level"],
			"strain": contract["strain"],
			"tricksWonByDeclarerSide": tricks_won_by_declarer,
			"targetTricks": target_tricks,
			"overtricks": overtricks,
			"contractPoints": contract_points,
			"overtrickPoints": overtrick_points,
			"bonusPoints": game_bonus + slam_bonus + insult_bonus,
			"penaltyPoints": 0,
			"gameBonus": game_bonus,
			"slamBonus": slam_bonus,
			"insultBonus": insult_bonus,
			"doubled": contract.get("doubled", False),
			"redoubled": contract.get("redoubled", False),
			"isGameContract": contract.get("isGameContract", False),
			"nsPoints": ns_points,
			"ewPoints": ew_points,
			"winnerSide": "NS" if ns_points > ew_points else "EW" if ew_points > ns_points else "tie",
			"loserSide": "EW" if ns_points > ew_points else "NS" if ew_points > ns_points else None,
			"playerPoints": build_player_points(players_by_position, ns_points, ew_points),
		}

	undertricks = target_tricks - tricks_won_by_declarer
	if not contract.get("doubled") and not contract.get("redoubled"):
		penalty_points = undertricks * 50
	else:
		factor = 2 if contract.get("redoubled") else 1
		penalty_points = 0
		for index in range(1, undertricks + 1):
			if index == 1:
				penalty_points += 100
			elif index <= 3:
				penalty_points += 200
			else:
				penalty_points += 300
		penalty_points *= factor

	defenders = opposite_side(declarer_side)
	ns_points = penalty_points if defenders == "NS" else 0
	ew_points = penalty_points if defenders == "EW" else 0

	return {
		"contractResult": "down",
		"declarerSide": declarer_side,
		"contractLevel": contract["level"],
		"strain": contract["strain"],
		"tricksWonByDeclarerSide": tricks_won_by_declarer,
		"targetTricks": target_tricks,
		"undertricks": undertricks,
		"contractPoints": 0,
		"overtrickPoints": 0,
		"bonusPoints": 0,
		"penaltyPoints": penalty_points,
		"gameBonus": 0,
		"slamBonus": 0,
		"insultBonus": 0,
		"doubled": contract.get("doubled", False),
		"redoubled": contract.get("redoubled", False),
		"isGameContract": contract.get("isGameContract", False),
		"nsPoints": ns_points,
		"ewPoints": ew_points,
		"winnerSide": "NS" if ns_points > ew_points else "EW" if ew_points > ns_points else "tie",
		"loserSide": "EW" if ns_points > ew_points else "NS" if ew_points > ns_points else None,
		"playerPoints": build_player_points(players_by_position, ns_points, ew_points),
	}


def pick_legal_card(game_state: Dict[str, Any], turn: str) -> Dict[str, str]:
	hand = game_state["hands"][turn]
	current_trick = game_state.get("currentTrick")
	if current_trick and current_trick.get("cards"):
		lead_suit = current_trick["cards"][0]["card"]["suit"]
		for card in hand:
			if card["suit"] == lead_suit:
				return card
	return hand[0]


def run_bidding_scenario(room: Dict[str, Any], bids: List[Dict[str, Any]]) -> Dict[str, Any]:
	invite_code = room["id"]
	for item in bids:
		api_request(
			"POST",
			f"/api/lobby/rooms/{invite_code}/bid",
			{"playerId": item["playerId"], "bid": item["bid"]},
		)
	return api_request("GET", f"/api/lobby/rooms/{invite_code}")


def play_to_finish(room: Dict[str, Any]) -> Dict[str, Any]:
	invite_code = room["id"]
	while True:
		room = api_request("GET", f"/api/lobby/rooms/{invite_code}")
		game_state = room["gameState"]
		if game_state["phase"] == "finished":
			return room

		if game_state["phase"] != "playing":
			time.sleep(0.05)
			continue

		turn = game_state["turn"]
		player_id = game_state["playersByPosition"][turn]
		card = pick_legal_card(game_state, turn)
		api_request(
			"POST",
			f"/api/lobby/rooms/{invite_code}/play",
			{"playerId": player_id, "card": card},
		)


def compare_subset(expected: Dict[str, Any], actual: Dict[str, Any], keys: List[str]) -> List[str]:
	mismatches: List[str] = []
	for key in keys:
		if expected.get(key) != actual.get(key):
			mismatches.append(f"{key}: expected={expected.get(key)!r}, actual={actual.get(key)!r}")
	return mismatches


def run_case(case_name: str, bids: List[Dict[str, Any]], autoplay: bool) -> Dict[str, Any]:
	room = create_full_room(case_name, ["p1", "p2", "p3", "p4"])
	invite_code = room["id"]
	assert_event_history_contains(invite_code, ["room_created", "player_joined", "player_sat", "game_started"])
	heartbeats = HeartbeatLoop(invite_code, ["p1", "p2", "p3", "p4"], interval_seconds=10)
	heartbeats.start()

	try:
		after_bids = run_bidding_scenario(room, bids)

		if autoplay and after_bids["gameState"]["phase"] != "finished":
			final_room = play_to_finish(after_bids)
		else:
			final_room = api_request("GET", f"/api/lobby/rooms/{after_bids['id']}")
	finally:
		heartbeats.stop()

	game_state = final_room["gameState"]
	expected = judge_score(game_state["playersByPosition"], game_state["contract"], game_state["tricks"])
	actual = game_state["score"]

	keys_to_check = [
		"contractResult",
		"contractLevel",
		"strain",
		"tricksWonByDeclarerSide",
		"targetTricks",
		"overtricks",
		"undertricks",
		"contractPoints",
		"overtrickPoints",
		"bonusPoints",
		"penaltyPoints",
		"gameBonus",
		"slamBonus",
		"insultBonus",
		"doubled",
		"redoubled",
		"isGameContract",
		"nsPoints",
		"ewPoints",
		"winnerSide",
		"loserSide",
		"playerPoints",
	]
	mismatches = compare_subset(expected, actual, keys_to_check)
	assert_event_history_contains(final_room["id"], ["bid_submitted"])

	return {
		"case": case_name,
		"inviteCode": final_room["id"],
		"phase": game_state["phase"],
		"contract": game_state["contract"],
		"expected": expected,
		"actual": actual,
		"matched": len(mismatches) == 0,
		"mismatches": mismatches,
	}


def main() -> None:
	cases = [
		{
			"name": "passed_out_case",
			"bids": [
				{"playerId": "p1", "bid": {"type": "pass"}},
				{"playerId": "p2", "bid": {"type": "pass"}},
				{"playerId": "p3", "bid": {"type": "pass"}},
				{"playerId": "p4", "bid": {"type": "pass"}},
			],
			"autoplay": False,
		},
		{
			"name": "normal_contract_case",
			"bids": [
				{"playerId": "p1", "bid": {"type": "bid", "level": 1, "strain": "NT"}},
				{"playerId": "p2", "bid": {"type": "pass"}},
				{"playerId": "p3", "bid": {"type": "pass"}},
				{"playerId": "p4", "bid": {"type": "pass"}},
			],
			"autoplay": True,
		},
		{
			"name": "double_case",
			"bids": [
				{"playerId": "p1", "bid": {"type": "bid", "level": 1, "strain": "H"}},
				{"playerId": "p2", "bid": {"type": "double"}},
				{"playerId": "p3", "bid": {"type": "pass"}},
				{"playerId": "p4", "bid": {"type": "pass"}},
				{"playerId": "p1", "bid": {"type": "pass"}},
			],
			"autoplay": True,
		},
		{
			"name": "redouble_case",
			"bids": [
				{"playerId": "p1", "bid": {"type": "bid", "level": 1, "strain": "S"}},
				{"playerId": "p2", "bid": {"type": "double"}},
				{"playerId": "p3", "bid": {"type": "redouble"}},
				{"playerId": "p4", "bid": {"type": "pass"}},
				{"playerId": "p1", "bid": {"type": "pass"}},
				{"playerId": "p2", "bid": {"type": "pass"}},
			],
			"autoplay": True,
		},
	]

	results = [run_case(case["name"], case["bids"], case["autoplay"]) for case in cases]

	print("=== JudgeTest Result ===")
	overall_match = True
	for result in results:
		print(f"CASE {result['case']}: {'MATCH' if result['matched'] else 'MISMATCH'}")
		print(f"  InviteCode: {result['inviteCode']}")
		print(f"  Phase: {result['phase']}")
		print(f"  Contract: {json.dumps(result['contract'], ensure_ascii=False)}")
		print(f"  API Score: {json.dumps(result['actual'], ensure_ascii=False)}")
		print(f"  Judge Score: {json.dumps(result['expected'], ensure_ascii=False)}")
		if result["mismatches"]:
			overall_match = False
			print("  Mismatches:")
			for mismatch in result["mismatches"]:
				print(f"    - {mismatch}")

	print(f"OVERALL: {'MATCH' if overall_match else 'MISMATCH'}")
	if not overall_match:
		raise SystemExit(1)


if __name__ == "__main__":
	main()
