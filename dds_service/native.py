from __future__ import annotations

import ctypes
from ctypes import POINTER
from ctypes import c_char
from ctypes import c_int
from ctypes import c_uint
from dataclasses import dataclass
from pathlib import Path
import os

from .build_native import ensure_dds_dll
from .build_native import _find_cpp_compiler


DDS_STRAINS = 5
DDS_HANDS = 4
RETURN_NO_FAULT = 1

POSITION_ORDER = ("N", "E", "S", "W")
SUIT_ORDER = ("S", "H", "D", "C")
SUIT_TO_DDS = {"S": 0, "H": 1, "D": 2, "C": 3, "NT": 4}
DDS_TO_SUIT = {0: "S", 1: "H", 2: "D", 3: "C"}
RANK_TO_VALUE = {
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    "10": 10,
    "J": 11,
    "Q": 12,
    "K": 13,
    "A": 14,
}
VALUE_TO_RANK = {value: rank for rank, value in RANK_TO_VALUE.items()}


class FutureTricks(ctypes.Structure):
    _fields_ = [
        ("nodes", c_int),
        ("cards", c_int),
        ("suit", c_int * 13),
        ("rank", c_int * 13),
        ("equals", c_int * 13),
        ("score", c_int * 13),
    ]


class DealPBN(ctypes.Structure):
    _fields_ = [
        ("trump", c_int),
        ("first", c_int),
        ("currentTrickSuit", c_int * 3),
        ("currentTrickRank", c_int * 3),
        ("remainCards", c_char * 80),
    ]


class DdTableDealPBN(ctypes.Structure):
    _fields_ = [("cards", c_char * 80)]


class DdTableResults(ctypes.Structure):
    _fields_ = [("resTable", (c_int * DDS_HANDS) * DDS_STRAINS)]


class ParResults(ctypes.Structure):
    _fields_ = [
        ("parScore", (c_char * 16) * 2),
        ("parContractsString", (c_char * 128) * 2),
    ]


def _load_library() -> ctypes.WinDLL:
    dll_path = ensure_dds_dll()
    os.add_dll_directory(str(Path(dll_path).parent))
    compiler_path, compiler_kind = _find_cpp_compiler()
    if compiler_kind == "g++":
        os.add_dll_directory(str(compiler_path.parent))
    library = ctypes.WinDLL(str(dll_path))

    library.SolveBoardPBN.argtypes = [DealPBN, c_int, c_int, c_int, POINTER(FutureTricks), c_int]
    library.SolveBoardPBN.restype = c_int

    library.CalcDDtablePBN.argtypes = [DdTableDealPBN, POINTER(DdTableResults)]
    library.CalcDDtablePBN.restype = c_int

    library.Par.argtypes = [POINTER(DdTableResults), POINTER(ParResults), c_int]
    library.Par.restype = c_int

    library.ErrorMessage.argtypes = [c_int, ctypes.c_char_p]
    library.ErrorMessage.restype = None
    return library


_LIB = _load_library()


def _error_message(code: int) -> str:
    buffer = ctypes.create_string_buffer(80)
    _LIB.ErrorMessage(code, buffer)
    return buffer.value.decode("ascii", errors="ignore") or f"DDS error {code}"


def _ensure_success(code: int) -> None:
    if code == RETURN_NO_FAULT:
        return
    raise RuntimeError(f"DDS call failed with code {code}: {_error_message(code)}")


def _encode_fixed_string(value: str, size: int) -> bytes:
    encoded = value.encode("ascii")
    if len(encoded) >= size:
        raise ValueError(f"Encoded DDS string exceeds {size - 1} bytes")
    return encoded


def _make_deal_pbn(
    remain_cards: str,
    trump: int,
    first: int,
    current_trick_suit: list[int],
    current_trick_rank: list[int],
) -> DealPBN:
    deal = DealPBN()
    deal.trump = trump
    deal.first = first
    deal.currentTrickSuit[:] = current_trick_suit
    deal.currentTrickRank[:] = current_trick_rank
    deal.remainCards = _encode_fixed_string(remain_cards, 80)
    return deal


def solve_board_pbn(
    remain_cards: str,
    trump: int,
    first: int,
    current_trick_suit: list[int],
    current_trick_rank: list[int],
    target: int = -1,
    solutions: int = 3,
    mode: int = 0,
    thread_index: int = 0,
) -> dict:
    future = FutureTricks()
    deal = _make_deal_pbn(remain_cards, trump, first, current_trick_suit, current_trick_rank)
    code = _LIB.SolveBoardPBN(deal, target, solutions, mode, ctypes.byref(future), thread_index)
    _ensure_success(code)

    cards = []
    for index in range(future.cards):
        cards.append(
            {
                "suit": DDS_TO_SUIT.get(int(future.suit[index]), "S"),
                "rank": VALUE_TO_RANK.get(int(future.rank[index]), str(int(future.rank[index]))),
                "equals": int(future.equals[index]),
                "score": int(future.score[index]),
            }
        )

    return {
        "nodes": int(future.nodes),
        "cards": int(future.cards),
        "moves": cards,
    }


def calc_dd_table_pbn(remain_cards: str) -> list[list[int]]:
    deal = DdTableDealPBN()
    deal.cards = _encode_fixed_string(remain_cards, 80)
    table = DdTableResults()
    code = _LIB.CalcDDtablePBN(deal, ctypes.byref(table))
    _ensure_success(code)
    return [[int(table.resTable[strain][hand]) for hand in range(DDS_HANDS)] for strain in range(DDS_STRAINS)]


def calc_par(table: list[list[int]], vulnerable: int) -> dict:
    native_table = DdTableResults()
    for strain in range(DDS_STRAINS):
        for hand in range(DDS_HANDS):
            native_table.resTable[strain][hand] = table[strain][hand]

    par = ParResults()
    code = _LIB.Par(ctypes.byref(native_table), ctypes.byref(par), vulnerable)
    _ensure_success(code)
    return {
        "parScore": [bytes(par.parScore[index]).split(b"\0", 1)[0].decode("ascii", errors="ignore") for index in range(2)],
        "parContractsString": [
            bytes(par.parContractsString[index]).split(b"\0", 1)[0].decode("ascii", errors="ignore")
            for index in range(2)
        ],
    }


@dataclass(frozen=True)
class NativeCard:
    suit: str
    rank: str

    @property
    def sort_key(self) -> tuple[int, int]:
        return (SUIT_ORDER.index(self.suit), -RANK_TO_VALUE[self.rank])