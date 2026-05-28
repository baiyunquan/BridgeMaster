export type Suit = "C" | "D" | "H" | "S";
export type Strain = Suit | "NT";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";
export type PlayerPosition = "N" | "E" | "S" | "W";
export type BidActionType = "pass" | "bid" | "double" | "redouble";
export type GamePhase = "waiting" | "bidding" | "playing" | "finished";

export interface Card {
  suit: Suit;
  rank: Rank;
}

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

export interface Contract {
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  strain: Strain;
  declarer: PlayerPosition;
  side: "NS" | "EW";
  doubled: boolean;
  redoubled: boolean;
  isGameContract: boolean;
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
  contractPoints?: number;
  overtrickPoints?: number;
  bonusPoints?: number;
  penaltyPoints?: number;
  gameBonus?: number;
  slamBonus?: number;
  insultBonus?: number;
  doubled?: boolean;
  redoubled?: boolean;
  isGameContract?: boolean;
  nsPoints: number;
  ewPoints: number;
  winnerSide: "NS" | "EW" | "tie";
  loserSide?: "NS" | "EW";
  playerPoints: Record<string, number>;
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

export interface RoomEvent {
  type:
    | "room_created"
    | "player_joined"
    | "player_sat"
    | "game_started"
    | "bid_submitted"
    | "card_submitted"
    | "game_finished";
  inviteCode: string;
  sequence: number;
  at: number;
  room: Room;
}
