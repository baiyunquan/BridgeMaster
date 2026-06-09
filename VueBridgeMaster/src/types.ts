export type Suit = "C" | "D" | "H" | "S";
export type Strain = Suit | "NT";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";
export type PlayerPosition = "N" | "E" | "S" | "W";
export type BidActionType = "pass" | "bid" | "double" | "redouble";
export type GamePhase = "waiting" | "bidding" | "playing" | "finished";
export type RoomMode = "normal" | "assistant" | "exam";

export interface ExamRoomInfo {
  examName: string;
  boardNo: number;
  vulnerability: string;
}

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
  dummyPosition: PlayerPosition | null;
  isDummyRevealed: boolean;
  hands: Record<PlayerPosition, Card[]>;
  bidHistory: BidEntry[];
  contract: Contract | null;
  tricks: Trick[];
  currentTrick: Trick | null;
  score: BridgeScore | null;
}

export interface AssistantContract {
  strain: Strain;
  declarer: PlayerPosition;
  level?: number;
}

export interface AssistantPositionedCard {
  position: PlayerPosition;
  card: Card;
}

export type AssistantPhase = "setup" | "recording" | "finished";

export type AssistantEntryTarget =
  | "contract"
  | "operator_hand"
  | "dummy_hand"
  | "opening_lead"
  | "trick_play"
  | "completed";

export interface AssistantGameState {
  operatorPosition: PlayerPosition;
  contract: AssistantContract | null;
  phase: AssistantPhase;
  dummyPosition: PlayerPosition | null;
  openingLeader: PlayerPosition | null;
  entryTarget: AssistantEntryTarget;
  entryPosition: PlayerPosition | null;
  entryCount: number;
  entryRequired: number;
  pendingDdsForOperator: boolean;
  knownHands: Partial<Record<PlayerPosition, Card[]>>;
  handSizes: Record<PlayerPosition, number>;
  playedCards: AssistantPositionedCard[];
  currentTrick: AssistantPositionedCard[];
  turn: PlayerPosition;
  vulnerable: number;
}

export interface Player {
  id: string;
  name: string;
  position: PlayerPosition | null;
}

export interface Room {
  id: string;
  name: string;
  mode: RoomMode;
  examInfo?: ExamRoomInfo;
  creatorId: string;
  players: Player[];
  gameState: BridgeGameState;
  assistantState: AssistantGameState | null;
}

export interface RoomEventMeta {
  actorPlayerId?: string;
  targetPlayerId?: string;
}

export interface RoomSummary {
  id: string;
  name: string;
  mode: RoomMode;
  playerCount: number;
  examInfo?: ExamRoomInfo;
}

export interface ExamBoardStatus {
  boardNo: number;
  vulnerability: string;
  completed: boolean;
}

export interface RoomEvent {
  type:
    | "room_created"
    | "player_joined"
    | "player_left"
    | "player_kicked"
    | "room_dissolved"
    | "game_reset"
    | "player_sat"
    | "game_started"
    | "bid_submitted"
    | "card_submitted"
    | "game_finished"
    | "assistant_contract_set"
    | "assistant_cards_updated"
    | "assistant_play_updated"
    | "assistant_reset";
  inviteCode: string;
  sequence: number;
  at: number;
  room: Room;
  meta?: RoomEventMeta;
}

export interface RoomStreamSnapshot {
  inviteCode: string;
  at: number;
  room: Room;
  events: RoomEvent[];
}

export interface DdsPositionedCard {
  position: PlayerPosition;
  card: Card;
}

export interface DdsContractPayload {
  strain: Strain;
  declarer: PlayerPosition;
}

export interface DdsAnalysisRequest {
  knownHands: Partial<Record<PlayerPosition, Card[]>>;
  handSizes: Record<PlayerPosition, number>;
  playedCards: DdsPositionedCard[];
  currentTrick: DdsPositionedCard[];
  turn: PlayerPosition;
  contract: DdsContractPayload;
  vulnerable?: number;
  maxSamples?: number;
  randomSeed?: number;
}

export interface DdsCardProbability {
  card: Card;
  probability: number;
}

export interface DdsMoveSuggestion {
  card: Card;
  averageScore: number;
  sampleCoverage: number;
}

export interface DdsContractOutlook {
  expectedDeclarerTricks: number;
  averageTable: number[][];
  mostLikelyPar: {
    parScore: string[];
    parContractsString: string[];
  } | null;
}

export interface DdsAnalysisResult {
  sampleCount: number;
  hiddenProbabilities: Partial<Record<PlayerPosition, DdsCardProbability[]>>;
  moveSuggestions: DdsMoveSuggestion[];
  contractOutlook: DdsContractOutlook | null;
}
