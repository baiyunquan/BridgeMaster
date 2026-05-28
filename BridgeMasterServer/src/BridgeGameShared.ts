import { BridgeGameState, Card, PlayerPosition, Strain, Suit } from "./types";

export type Side = "NS" | "EW";

export const POSITIONS: PlayerPosition[] = ["N", "E", "S", "W"];
export const SUITS: Suit[] = ["C", "D", "H", "S"];
export const RANKS: Card["rank"][] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

export const RANK_VALUE: Record<Card["rank"], number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export const STRAIN_ORDER: Record<Strain, number> = {
  C: 1,
  D: 2,
  H: 3,
  S: 4,
  NT: 5,
};

export function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

export function getSideByPosition(position: PlayerPosition): Side {
  return position === "N" || position === "S" ? "NS" : "EW";
}

export function oppositeSide(side: Side): Side {
  return side === "NS" ? "EW" : "NS";
}

export function nextPosition(position: PlayerPosition): PlayerPosition {
  const idx = POSITIONS.indexOf(position);
  return POSITIONS[(idx + 1) % POSITIONS.length];
}

export function compareBidRank(level: number, strain: Strain): number {
  return level * 10 + STRAIN_ORDER[strain];
}

export function cloneState(state: BridgeGameState): BridgeGameState {
  return JSON.parse(JSON.stringify(state)) as BridgeGameState;
}

export function getUndoubledContractPoints(level: number, strain: Strain): number {
  if (strain === "NT") {
    return 40 + (level - 1) * 30;
  }

  if (strain === "H" || strain === "S") {
    return level * 30;
  }

  return level * 20;
}

export function isGameContract(level: number, strain: Strain): boolean {
  return getUndoubledContractPoints(level, strain) >= 100;
}