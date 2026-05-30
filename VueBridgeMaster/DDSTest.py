from __future__ import annotations

import sys
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
if str(WORKSPACE_ROOT) not in sys.path:
	sys.path.insert(0, str(WORKSPACE_ROOT))

from dds_service.api import app


class DDSTest(unittest.TestCase):
	@classmethod
	def setUpClass(cls) -> None:
		cls.client = TestClient(app)

	def test_health_endpoint(self) -> None:
		response = self.client.get("/health")
		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.json()["status"], "ok")

	def test_analysis_endpoint_returns_predictions(self) -> None:
		payload = {
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
			"maxSamples": 4,
			"randomSeed": 7,
		}

		response = self.client.post("/api/dds/analyze", json=payload)
		self.assertEqual(response.status_code, 200)
		data = response.json()

		self.assertEqual(data["sampleCount"], 4)
		self.assertIn("E", data["hiddenProbabilities"])
		self.assertIn("W", data["hiddenProbabilities"])
		self.assertTrue(len(data["moveSuggestions"]) > 0)
		self.assertIn("contractOutlook", data)


if __name__ == "__main__":
	unittest.main()
