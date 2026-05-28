export type Suit = "C" | "D" | "H" | "S";
export type Strain = Suit | "NT";

export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A";

export type PlayerPosition = "N" | "E" | "S" | "W";

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type BidActionType = "pass" | "bid" | "double" | "redouble";

export interface Bid {
  type: BidActionType;
  level?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  strain?: Strain;
}

export interface BidEntry {
  playerId: string;
  position: PlayerPosition;
  bid: Bid;
  timestamp: number;
}

export interface TrickPlay {
  playerId: string;
  position: PlayerPosition;
  card: Card;
}

export interface Trick {
  leader: PlayerPosition;
  cards: TrickPlay[];
  winner?: PlayerPosition;
}

export type GamePhase = "waiting" | "bidding" | "playing" | "finished";

export interface Contract {
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  strain: Strain;
  declarer: PlayerPosition;
  side: "NS" | "EW";
  doubled: boolean;
  redoubled: boolean;
}

export interface BridgeScore {
  contractResult: "made" | "down" | "passed-out";
  declarerSide?: "NS" | "EW";
  contractLevel?: number;
  strain?: Strain;
  tricksWonByDeclarerSide?: number;
  targetTricks?: number;
  overtricks?: number;
  undertricks?: number;
}

export interface BridgeGameState {
  phase: GamePhase;
  dealer: PlayerPosition;
  turn: PlayerPosition | null;
  playersByPosition: Record<PlayerPosition, string>;
  hands: Record<PlayerPosition, Card[]>;
  bidHistory: BidEntry[];
  contract: Contract | null;
  tricks: Trick[];
  currentTrick: Trick | null;
  score: BridgeScore | null;
}

export interface Player {
  id: string;
  name: string;
  position: PlayerPosition | null;
}

export interface Room {
  id: string;
  name: string;
  creatorId: string;
  players: Player[];
  gameState: BridgeGameState;
}

export interface RoomSummary {
  id: string;
  name: string;
  playerCount: number;
}
