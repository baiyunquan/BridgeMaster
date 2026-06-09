import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { BridgeGame } from "./BridgeGame";
import { gameRecordLogger } from "./GameRecordLogger";
import {
  AssistantContract,
  AssistantGameState,
  AssistantPositionedCard,
  BridgeGameState,
  Card,
  ExamBoardResult,
  Player,
  PlayerPosition,
  Room,
  RoomEventMeta,
  RoomMode,
  RoomSummary,
} from "./types";

const POSITIONS: PlayerPosition[] = ["N", "E", "S", "W"];
const INVITE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const MAX_ROOM_EVENT_HISTORY = 120;
const PLAYER_HEARTBEAT_TIMEOUT_MS = Number(process.env.PLAYER_HEARTBEAT_TIMEOUT_MS) || 60_000;
const PLAYER_HEARTBEAT_SWEEP_MS = Number(process.env.PLAYER_HEARTBEAT_SWEEP_MS) || 10_000;
const DEFAULT_RESULT_DATA_FILE = path.resolve(__dirname, "../result_data.json");
const EXAM_SHEET_TEMPLATE_FILE = path.resolve(__dirname, "../exam_sheet.csv");
const EXAM_EXPORT_DIR = path.resolve(__dirname, "../exams");

interface ExamBoardDefinition {
  boardNo: number;
  vulnerability: string;
}

interface ExamRoomCreateOptions {
  examName: string;
  boardNo?: number;
}

interface ExamBoardStatus {
  boardNo: number;
  vulnerability: string;
  completed: boolean;
}

export type RoomEventType =
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

export interface RoomEvent {
  type: RoomEventType;
  inviteCode: string;
  sequence: number;
  at: number;
  room: Room;
  meta?: RoomEventMeta;
}

type RoomEventListener = (event: RoomEvent) => void;

function emptyGameState(): BridgeGameState {
  return {
    phase: "waiting",
    dealer: "N",
    turn: null,
    playersByPosition: { N: "", E: "", S: "", W: "" },
    dummyPosition: null,
    isDummyRevealed: false,
    hands: { N: [], E: [], S: [], W: [] },
    bidHistory: [],
    contract: null,
    tricks: [],
    currentTrick: null,
    score: null,
  };
}

function emptyAssistantState(operatorPosition: PlayerPosition = "S"): AssistantGameState {
  return {
    operatorPosition,
    contract: null,
    phase: "setup",
    dummyPosition: null,
    openingLeader: null,
    entryTarget: "contract",
    entryPosition: null,
    entryCount: 0,
    entryRequired: 0,
    pendingDdsForOperator: false,
    knownHands: {},
    handSizes: { N: 13, E: 13, S: 13, W: 13 },
    playedCards: [],
    currentTrick: [],
    turn: "N",
    vulnerable: 0,
  };
}

export class LobbyManager {
  private static instance: LobbyManager;

  private rooms = new Map<string, Room>();

  private games = new Map<string, BridgeGame>();

  private roomListeners = new Map<string, Set<RoomEventListener>>();

  private roomEventSequence = new Map<string, number>();

  private roomEventHistory = new Map<string, RoomEvent[]>();

  private roomHeartbeats = new Map<string, Map<string, number>>();

  private readonly examBoards: ExamBoardDefinition[];

  private readonly examBoardsByNo = new Map<number, ExamBoardDefinition>();

  private readonly examProgressByName = new Map<string, Set<number>>();

  private readonly examResultsByName = new Map<string, Map<number, ExamBoardResult>>();

  private constructor() {
    this.examBoards = this.loadExamBoards();
    for (const board of this.examBoards) {
      this.examBoardsByNo.set(board.boardNo, board);
    }

    setInterval(() => {
      this.releaseStalePlayers();
    }, PLAYER_HEARTBEAT_SWEEP_MS).unref();
  }

  public static getInstance(): LobbyManager {
    if (!LobbyManager.instance) {
      LobbyManager.instance = new LobbyManager();
    }
    return LobbyManager.instance;
  }

  public createRoom(
    roomName: string,
    creatorId: string,
    creatorName: string,
    mode: RoomMode = "normal",
    examOptions?: ExamRoomCreateOptions,
  ): Room {
    const trimmedName = roomName.trim();
    if (!trimmedName) {
      throw new Error("Room name is required.");
    }

    const inviteCode = this.createUniqueInviteCode();
    const creator: Player = {
      id: creatorId,
      name: creatorName,
      position: null,
    };

    const normalizedExam = mode === "exam" ? this.resolveExamRoomOptions(examOptions) : null;

    const room: Room = {
      id: inviteCode,
      name: trimmedName,
      mode,
      ...(normalizedExam
        ? {
            examInfo: {
              examName: normalizedExam.examName,
              boardNo: normalizedExam.board?.boardNo ?? 0,
              vulnerability: normalizedExam.board?.vulnerability ?? "N",
            },
          }
        : {}),
      creatorId,
      players: [creator],
      gameState: emptyGameState(),
      assistantState: mode === "assistant" || mode === "exam" ? emptyAssistantState() : null,
    };

    if (mode === "exam" && room.assistantState && room.examInfo) {
      room.assistantState.vulnerable = this.vulnerabilityToCode(room.examInfo.vulnerability);
    }

    this.rooms.set(inviteCode, room);
    this.touchPlayerPresence(room.id, creatorId);
    this.emitRoomEvent(room, "room_created");
    return this.cloneRoom(room);
  }

  public joinRoomByCode(inviteCode: string, playerId: string, playerName: string): Room {
    const room = this.getRoomOrThrow(inviteCode);

    const existingPlayer = room.players.find((p) => p.id === playerId);
    if (existingPlayer) {
      existingPlayer.name = playerName;
      this.touchPlayerPresence(room.id, playerId);
      return this.cloneRoom(room);
    }

    if (room.players.length >= 4) {
      throw new Error("Room is full (max 4 players).");
    }

    if (room.mode === "assistant" || room.mode === "exam") {
      throw new Error("This room allows only the creator to operate.");
    }

    room.players.push({
      id: playerId,
      name: playerName,
      position: null,
    });

    this.touchPlayerPresence(room.id, playerId);

    this.emitRoomEvent(room, "player_joined");

    return this.cloneRoom(room);
  }

  public sitDown(inviteCode: string, playerId: string, position: PlayerPosition): Room {
    const room = this.getRoomOrThrow(inviteCode);
    if (room.mode === "assistant" || room.mode === "exam") {
      throw new Error("This room mode does not use seat assignment.");
    }
    const player = room.players.find((p) => p.id === playerId);

    if (!player) {
      throw new Error("Player is not in this room.");
    }

    if (room.players.some((p) => p.id !== playerId && p.position === position)) {
      throw new Error("This position is already occupied.");
    }

    player.position = position;
  this.touchPlayerPresence(room.id, playerId);
    this.emitRoomEvent(room, "player_sat");

    if (this.isReadyToStart(room)) {
      this.startRoomGame(room);
    }

    return this.cloneRoom(room);
  }

  public getLobbyRooms(): RoomSummary[] {
    return Array.from(this.rooms.values())
      .filter((room) => (room.mode === "normal" ? room.players.length < 4 : true))
      .map((room) => ({
        id: room.id,
        name: room.name,
        mode: room.mode,
        playerCount: room.players.length,
        ...(room.examInfo ? { examInfo: room.examInfo } : {}),
      }));
  }

  public listExamBoards(examName: string): { examName: string; totalBoards: number; boards: ExamBoardStatus[] } {
    const normalizedExamName = this.normalizeExamName(examName);
    const completed = this.examProgressByName.get(normalizedExamName) ?? new Set<number>();

    const boards = this.examBoards
      .map((board) => ({
        boardNo: board.boardNo,
        vulnerability: board.vulnerability,
        completed: completed.has(board.boardNo),
      }))
      .sort((a, b) => a.boardNo - b.boardNo);

    return {
      examName: normalizedExamName,
      totalBoards: boards.length,
      boards,
    };
  }

  public getExamSheetData(examName: string): {
    examName: string;
    totalBoards: number;
    completedCount: number;
    boards: {
      boardNo: number;
      vulnerability: string;
      completed: boolean;
      contractStr: string;
      resultText: string;
      nsPoints: number;
      ewPoints: number;
    }[];
  } {
    const normalizedExamName = this.normalizeExamName(examName);
    const completed = this.examProgressByName.get(normalizedExamName) ?? new Set<number>();
    const results = this.examResultsByName.get(normalizedExamName);

    const boards = this.examBoards.map((board) => {
      const r = results?.get(board.boardNo);
      return {
        boardNo: board.boardNo,
        vulnerability: board.vulnerability,
        completed: completed.has(board.boardNo),
        contractStr: r?.contractStr ?? "",
        resultText: r?.resultText ?? "",
        nsPoints: r?.nsPoints ?? 0,
        ewPoints: r?.ewPoints ?? 0,
      };
    });

    return {
      examName: normalizedExamName,
      totalBoards: boards.length,
      completedCount: completed.size,
      boards,
    };
  }

  public examSelectBoard(inviteCode: string, playerId: string, boardNo: number): Room {
    const room = this.getRoomOrThrow(inviteCode);
    if (room.mode !== "exam") {
      throw new Error("Room is not exam mode.");
    }
    if (room.creatorId !== playerId) {
      throw new Error("Only the host can select a board.");
    }
    if (!room.examInfo) {
      throw new Error("Exam info is missing.");
    }

    const board = this.examBoardsByNo.get(boardNo);
    if (!board) {
      throw new Error(`Board ${boardNo} is not available.`);
    }

    const examName = this.normalizeExamName(room.examInfo.examName);
    const completedBoards = this.examProgressByName.get(examName);
    if (completedBoards?.has(boardNo)) {
      throw new Error(`Board ${boardNo} is already completed for exam ${examName}.`);
    }

    room.examInfo.boardNo = boardNo;
    room.examInfo.vulnerability = board.vulnerability;

    this.touchPlayerPresence(room.id, playerId);
    this.emitRoomEvent(room, "assistant_cards_updated", { actorPlayerId: playerId });
    return this.cloneRoom(room);
  }

  public getRoom(inviteCode: string): Room {
    return this.cloneRoom(this.getRoomOrThrow(inviteCode));
  }

  public submitBid(inviteCode: string, playerId: string, bid: Parameters<BridgeGame["submitBid"]>[1]): Room {
    const room = this.getRoomOrThrow(inviteCode);
    if (room.mode === "assistant" || room.mode === "exam") {
      throw new Error("This room mode does not support bidding API.");
    }
    const game = this.games.get(inviteCode);

    if (!game) {
      throw new Error("Game has not started in this room.");
    }

    room.gameState = game.submitBid(playerId, bid);
  this.touchPlayerPresence(room.id, playerId);
    this.emitRoomEvent(room, "bid_submitted");
    if (room.gameState.phase === "finished") {
      this.emitRoomEvent(room, "game_finished");
    }
    return this.cloneRoom(room);
  }

  public submitCard(inviteCode: string, playerId: string, card: Parameters<BridgeGame["submitCard"]>[1]): Room {
    const room = this.getRoomOrThrow(inviteCode);
    if (room.mode === "assistant" || room.mode === "exam") {
      throw new Error("This room mode does not support standard play API.");
    }
    const game = this.games.get(inviteCode);

    if (!game) {
      throw new Error("Game has not started in this room.");
    }

    room.gameState = game.submitCard(playerId, card);
  this.touchPlayerPresence(room.id, playerId);
    this.emitRoomEvent(room, "card_submitted");
    if (room.gameState.phase === "finished") {
      this.emitRoomEvent(room, "game_finished");
    }
    return this.cloneRoom(room);
  }

  public leaveRoomByCode(inviteCode: string, playerId: string): Room | null {
    const room = this.getRoomOrThrow(inviteCode);
    if (!room.players.some((player) => player.id === playerId)) {
      return this.cloneRoom(room);
    }

    return this.releasePlayerFromRoom(room, playerId, "player_left", { actorPlayerId: playerId, targetPlayerId: playerId });
  }

  public kickPlayer(inviteCode: string, hostId: string, targetPlayerId: string): Room | null {
    const room = this.getRoomOrThrow(inviteCode);
    this.assertHost(room, hostId);

    if (hostId === targetPlayerId) {
      throw new Error("Host cannot remove self. Use dissolve or leave instead.");
    }

    if (!room.players.some((player) => player.id === targetPlayerId)) {
      throw new Error("Target player is not in this room.");
    }

    return this.releasePlayerFromRoom(room, targetPlayerId, "player_kicked", {
      actorPlayerId: hostId,
      targetPlayerId,
    });
  }

  public dissolveRoom(inviteCode: string, hostId: string): null {
    const room = this.getRoomOrThrow(inviteCode);
    this.assertHost(room, hostId);

    this.emitRoomEvent(room, "room_dissolved", { actorPlayerId: hostId });
    this.clearRoomState(room.id);
    return null;
  }

  public touchPlayerHeartbeat(inviteCode: string, playerId: string): Room {
    const room = this.getRoomOrThrow(inviteCode);
    if (!room.players.some((player) => player.id === playerId)) {
      throw new Error("Player is not in this room.");
    }

    this.touchPlayerPresence(room.id, playerId);
    return this.cloneRoom(room);
  }

  public getRoomEvents(inviteCode: string): RoomEvent[] {
    const room = this.getRoomOrThrow(inviteCode);
    return this.cloneRoomEvents(this.roomEventHistory.get(room.id) ?? []);
  }

  public getRoomSnapshot(inviteCode: string): { room: Room; events: RoomEvent[] } {
    return {
      room: this.getRoom(inviteCode),
      events: this.getRoomEvents(inviteCode),
    };
  }

  public subscribeRoom(inviteCode: string, listener: RoomEventListener): () => void {
    const room = this.getRoomOrThrow(inviteCode);
    const code = room.id;

    let listeners = this.roomListeners.get(code);
    if (!listeners) {
      listeners = new Set<RoomEventListener>();
      this.roomListeners.set(code, listeners);
    }

    listeners.add(listener);

    return () => {
      const active = this.roomListeners.get(code);
      if (!active) {
        return;
      }

      active.delete(listener);
      if (active.size === 0) {
        this.roomListeners.delete(code);
      }
    };
  }

  public setAssistantOperatorPosition(inviteCode: string, playerId: string, position: PlayerPosition): Room {
    const room = this.getAssistantRoomForOperator(inviteCode, playerId);
    const state = room.assistantState;
    if (!state) {
      throw new Error("Assistant state is missing.");
    }

    state.operatorPosition = position;
    this.updateAssistantWorkflowState(state);
    this.touchPlayerPresence(room.id, playerId);
    this.emitRoomEvent(room, "assistant_cards_updated", { actorPlayerId: playerId });
    return this.cloneRoom(room);
  }

  public setAssistantContract(inviteCode: string, playerId: string, contract: AssistantContract, vulnerable: number): Room {
    const room = this.getAssistantRoomForOperator(inviteCode, playerId);
    const state = room.assistantState;
    if (!state) {
      throw new Error("Assistant state is missing.");
    }

    state.contract = { ...contract };
    state.dummyPosition = this.partnerPosition(contract.declarer);
    state.openingLeader = this.nextPosition(contract.declarer);
    state.turn = state.openingLeader;
    if (room.mode === "exam" && room.examInfo) {
      state.vulnerable = this.vulnerabilityToCode(room.examInfo.vulnerability);
    } else {
      state.vulnerable = Math.max(0, Math.min(3, Math.trunc(vulnerable)));
    }
    this.updateAssistantWorkflowState(state);
    this.touchPlayerPresence(room.id, playerId);
    this.emitRoomEvent(room, "assistant_contract_set", { actorPlayerId: playerId });
    return this.cloneRoom(room);
  }

  public upsertAssistantKnownHand(inviteCode: string, playerId: string, position: PlayerPosition, cards: Card[]): Room {
    const room = this.getAssistantRoomForOperator(inviteCode, playerId);
    const state = room.assistantState;
    if (!state) {
      throw new Error("Assistant state is missing.");
    }

    const sanitized = this.sanitizeCardList(cards);
    if (sanitized.length > state.handSizes[position]) {
      throw new Error(`Known cards exceed hand size for ${position}.`);
    }

    if (state.entryTarget === "operator_hand" || state.entryTarget === "dummy_hand") {
      if (state.entryPosition !== position) {
        throw new Error(`Current required entry is ${state.entryPosition ?? "unknown"}.`);
      }
    }

    state.knownHands[position] = sanitized;
    this.assertAssistantNoDuplicateCards(state);
    this.updateAssistantWorkflowState(state);
    this.touchPlayerPresence(room.id, playerId);
    this.emitRoomEvent(room, "assistant_cards_updated", { actorPlayerId: playerId });
    return this.cloneRoom(room);
  }

  public submitAssistantCard(inviteCode: string, playerId: string, play: AssistantPositionedCard): Room {
    const room = this.getAssistantRoomForOperator(inviteCode, playerId);
    const state = room.assistantState;
    if (!state) {
      throw new Error("Assistant state is missing.");
    }

    if (state.phase === "finished") {
      throw new Error("Assistant board already finished.");
    }

    if (state.entryTarget === "contract" || state.entryTarget === "operator_hand" || state.entryTarget === "dummy_hand") {
      throw new Error("Please complete required hand/contract entry before play recording.");
    }

    if (state.entryPosition && play.position !== state.entryPosition) {
      throw new Error(`Current required play position is ${state.entryPosition}.`);
    }

    if (play.position !== state.turn) {
      throw new Error(`Current turn is ${state.turn}.`);
    }

    this.assertAssistantCardAvailable(state, play.card);

    if (state.currentTrick.length >= 4) {
      throw new Error("Current trick is already full.");
    }

    state.currentTrick.push({ position: play.position, card: { ...play.card } });
    state.turn = this.nextPosition(play.position);

    if (state.currentTrick.length === 4) {
      state.playedCards.push(...state.currentTrick);
      state.currentTrick = [];
    }

    this.updateAssistantWorkflowState(state);
    if (room.mode === "exam" && state.entryTarget === "completed") {
      this.markExamBoardCompleted(room);
    }

    this.touchPlayerPresence(room.id, playerId);
    this.emitRoomEvent(room, "assistant_play_updated", { actorPlayerId: playerId });
    return this.cloneRoom(room);
  }

  public undoAssistantCard(inviteCode: string, playerId: string): Room {
    const room = this.getAssistantRoomForOperator(inviteCode, playerId);
    const state = room.assistantState;
    if (!state) {
      throw new Error("Assistant state is missing.");
    }

    if (state.currentTrick.length > 0) {
      const removed = state.currentTrick.pop();
      state.turn = removed ? removed.position : state.turn;
    } else if (state.playedCards.length > 0) {
      const restored = state.playedCards.splice(Math.max(0, state.playedCards.length - 4), 4);
      state.currentTrick = restored;
      const removed = state.currentTrick.pop();
      state.turn = removed ? removed.position : state.turn;
    } else {
      throw new Error("No assistant play to undo.");
    }

    this.updateAssistantWorkflowState(state);

    this.touchPlayerPresence(room.id, playerId);
    this.emitRoomEvent(room, "assistant_play_updated", { actorPlayerId: playerId });
    return this.cloneRoom(room);
  }

  public resetAssistantBoard(inviteCode: string, playerId: string): Room {
    const room = this.getAssistantRoomForOperator(inviteCode, playerId);
    const currentOperator = room.assistantState?.operatorPosition ?? "S";
    room.assistantState = emptyAssistantState(currentOperator);
    this.touchPlayerPresence(room.id, playerId);
    this.emitRoomEvent(room, "assistant_reset", { actorPlayerId: playerId });
    return this.cloneRoom(room);
  }

  public getAssistantAnalysisInput(inviteCode: string, playerId: string): Record<string, unknown> {
    const room = this.getAssistantRoomForOperator(inviteCode, playerId);
    const state = room.assistantState;
    if (!state) {
      throw new Error("Assistant state is missing.");
    }

    if (!state.contract) {
      throw new Error("Assistant contract is required before analysis.");
    }

    if (!state.pendingDdsForOperator) {
      throw new Error("DDS is only available right before operator plays.");
    }

    if (state.phase === "finished") {
      throw new Error("Board already finished.");
    }

    this.assertAssistantNoDuplicateCards(state);

    const usedByPosition: Record<PlayerPosition, Set<string>> = { N: new Set(), E: new Set(), S: new Set(), W: new Set() };
    for (const item of [...state.playedCards, ...state.currentTrick]) {
      usedByPosition[item.position].add(`${item.card.suit}-${item.card.rank}`);
    }

    const remainingKnown: Partial<Record<PlayerPosition, Card[]>> = {};
    const remainingHandSizes: Record<PlayerPosition, number> = { N: 13, E: 13, S: 13, W: 13 };
    for (const position of POSITIONS) {
      const usedCount = usedByPosition[position].size;
      remainingHandSizes[position] = Math.max(0, state.handSizes[position] - usedCount);
      const cards = (state.knownHands[position] ?? []).filter(
        (card) => !usedByPosition[position].has(`${card.suit}-${card.rank}`),
      );
      if (cards.length > 0) {
        remainingKnown[position] = cards;
      }
    }

    return {
      knownHands: remainingKnown,
      handSizes: remainingHandSizes,
      playedCards: state.playedCards,
      currentTrick: state.currentTrick,
      turn: state.turn,
      contract: state.contract,
      vulnerable: state.vulnerable,
    };
  }

  private updateAssistantWorkflowState(state: AssistantGameState): void {
    const totalPlayed = state.playedCards.length + state.currentTrick.length;

    if (!state.contract) {
      state.phase = "setup";
      state.entryTarget = "contract";
      state.entryPosition = null;
      state.entryCount = 0;
      state.entryRequired = 0;
      state.pendingDdsForOperator = false;
      return;
    }

    const dummy = state.dummyPosition ?? this.partnerPosition(state.contract.declarer);
    state.dummyPosition = dummy;
    state.openingLeader = state.openingLeader ?? this.nextPosition(state.contract.declarer);

    const operatorKnown = (state.knownHands[state.operatorPosition] ?? []).length;
    if (operatorKnown < state.handSizes[state.operatorPosition]) {
      state.phase = "recording";
      state.entryTarget = "operator_hand";
      state.entryPosition = state.operatorPosition;
      state.entryCount = operatorKnown;
      state.entryRequired = state.handSizes[state.operatorPosition];
      state.turn = state.openingLeader;
      state.pendingDdsForOperator = false;
      return;
    }

    const dummyKnown = (state.knownHands[dummy] ?? []).length;
    if (dummyKnown < state.handSizes[dummy]) {
      state.phase = "recording";
      state.entryTarget = "dummy_hand";
      state.entryPosition = dummy;
      state.entryCount = dummyKnown;
      state.entryRequired = state.handSizes[dummy];
      state.turn = state.openingLeader;
      state.pendingDdsForOperator = false;
      return;
    }

    if (totalPlayed >= 52) {
      state.phase = "finished";
      state.entryTarget = "completed";
      state.entryPosition = null;
      state.entryCount = 52;
      state.entryRequired = 52;
      state.pendingDdsForOperator = false;
      return;
    }

    state.phase = "recording";
    if (totalPlayed === 0) {
      state.entryTarget = "opening_lead";
      state.entryPosition = state.openingLeader;
      state.entryCount = 0;
      state.entryRequired = 1;
      state.turn = state.openingLeader;
      state.pendingDdsForOperator = false;
      return;
    }

    state.entryTarget = "trick_play";
    state.entryPosition = state.turn;
    state.entryCount = totalPlayed;
    state.entryRequired = 52;
    state.pendingDdsForOperator = true;
  }

  private getRoomOrThrow(inviteCode: string): Room {
    const normalized = inviteCode.toUpperCase();
    const room = this.rooms.get(normalized);
    if (!room) {
      throw new Error("Room not found.");
    }
    return room;
  }

  private createUniqueInviteCode(): string {
    let attempts = 0;
    while (attempts < 20) {
      const code = this.generateInviteCode();
      if (!this.rooms.has(code)) {
        return code;
      }
      attempts += 1;
    }
    throw new Error("Failed to generate unique invite code.");
  }

  private getAssistantRoomForOperator(inviteCode: string, playerId: string): Room {
    const room = this.getRoomOrThrow(inviteCode);
    if (room.mode !== "assistant" && room.mode !== "exam") {
      throw new Error("Room is not assistant/exam mode.");
    }

    if (!room.players.some((player) => player.id === playerId)) {
      throw new Error("Player is not in this room.");
    }

    return room;
  }

  private resolveExamRoomOptions(examOptions?: ExamRoomCreateOptions): {
    examName: string;
    board: ExamBoardDefinition | null;
  } {
    if (!examOptions) {
      throw new Error("examName is required for exam mode.");
    }

    const examName = this.normalizeExamName(examOptions.examName);

    if (examOptions.boardNo == null) {
      return { examName, board: null };
    }

    const boardNo = Math.trunc(examOptions.boardNo);
    const board = this.examBoardsByNo.get(boardNo);
    if (!board) {
      throw new Error(`Board ${boardNo} is not available.`);
    }

    const completedBoards = this.examProgressByName.get(examName);
    if (completedBoards?.has(boardNo)) {
      throw new Error(`Board ${boardNo} is already completed for exam ${examName}.`);
    }

    return { examName, board };
  }

  private normalizeExamName(name: string): string {
    const normalized = name.trim();
    if (!normalized) {
      throw new Error("examName is required.");
    }
    return normalized;
  }

  private loadExamBoards(): ExamBoardDefinition[] {
    const fromResultData = this.tryLoadExamBoardsFromResultData();
    if (fromResultData.length > 0) {
      return fromResultData;
    }

    const fromTemplate = this.loadExamBoardsFromTemplate();
    if (fromTemplate.length > 0) {
      return fromTemplate;
    }

    throw new Error("No exam board data found. Provide result_data.json or exam_sheet.csv.");
  }

  private tryLoadExamBoardsFromResultData(): ExamBoardDefinition[] {
    const resultDataPath = process.env.RESULT_DATA_PATH
      ? path.resolve(process.env.RESULT_DATA_PATH)
      : DEFAULT_RESULT_DATA_FILE;
    if (!fs.existsSync(resultDataPath)) {
      return [];
    }

    const raw = fs.readFileSync(resultDataPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { boards?: unknown[] }).boards)
        ? (parsed as { boards: unknown[] }).boards
        : [];

    const boards: ExamBoardDefinition[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const source = item as Record<string, unknown>;
      const rawNo = source.boardNo ?? source.board ?? source.no;
      const rawVul = source.vulnerability ?? source.vulnerable ?? source.vul;
      const boardNo = typeof rawNo === "number" ? Math.trunc(rawNo) : Number(rawNo);
      if (!Number.isFinite(boardNo) || boardNo <= 0) {
        continue;
      }
      boards.push({
        boardNo,
        vulnerability: this.normalizeVulnerability(rawVul),
      });
    }

    return this.normalizeBoardList(boards);
  }

  private loadExamBoardsFromTemplate(): ExamBoardDefinition[] {
    if (!fs.existsSync(EXAM_SHEET_TEMPLATE_FILE)) {
      return [];
    }

    const lines = fs
      .readFileSync(EXAM_SHEET_TEMPLATE_FILE, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const boards: ExamBoardDefinition[] = [];
    for (const line of lines.slice(1)) {
      const [boardText, vulText] = line.split(",");
      const boardNo = Number(boardText);
      if (!Number.isFinite(boardNo) || boardNo <= 0) {
        continue;
      }

      boards.push({
        boardNo: Math.trunc(boardNo),
        vulnerability: this.normalizeVulnerability(vulText),
      });
    }

    return this.normalizeBoardList(boards);
  }

  private normalizeBoardList(boards: ExamBoardDefinition[]): ExamBoardDefinition[] {
    const dedup = new Map<number, ExamBoardDefinition>();
    for (const board of boards) {
      if (!dedup.has(board.boardNo)) {
        dedup.set(board.boardNo, board);
      }
    }

    return Array.from(dedup.values()).sort((a, b) => a.boardNo - b.boardNo);
  }

  private normalizeVulnerability(raw: unknown): string {
    const value = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    if (value === "N" || value === "NONE") {
      return "N";
    }
    if (value === "N-S" || value === "NS") {
      return "N-S";
    }
    if (value === "E-W" || value === "EW") {
      return "E-W";
    }
    if (value === "B" || value === "BOTH") {
      return "B";
    }
    return "N";
  }

  private vulnerabilityToCode(vulnerability: string): number {
    if (vulnerability === "N-S") {
      return 1;
    }
    if (vulnerability === "E-W") {
      return 2;
    }
    if (vulnerability === "B") {
      return 3;
    }
    return 0;
  }

  private computeAssistantResult(state: AssistantGameState): ExamBoardResult {
    const POSITION_SIDES: Record<string, string> = { N: "NS", S: "NS", E: "EW", W: "EW" };
    const RANK_ORDER: Record<string, number> = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14 };

    const contract = state.contract;
    const level = contract?.level ?? 1;
    const strain = contract?.strain ?? "NT";
    const declarer = contract?.declarer ?? "N";
    const declarerSide = POSITION_SIDES[declarer] === "NS" ? "NS" : "EW";

    const trump = strain === "NT" ? null : strain;
    const targetTricks = 6 + level;

    // Group played cards into tricks (4 per trick)
    const allPlays = state.playedCards;
    let declarerTricks = 0;

    for (let i = 0; i < allPlays.length; i += 4) {
      const trick = allPlays.slice(i, i + 4);
      if (trick.length < 4) {
        break; // incomplete trick
      }

      const leadSuit = trick[0].card.suit;
      let winner = trick[0];

      for (const play of trick.slice(1)) {
        const wIsTrump = trump ? winner.card.suit === trump : false;
        const pIsTrump = trump ? play.card.suit === trump : false;

        if (pIsTrump && !wIsTrump) { winner = play; continue; }
        if (pIsTrump && wIsTrump && RANK_ORDER[play.card.rank] > RANK_ORDER[winner.card.rank]) { winner = play; continue; }
        if (!wIsTrump && !pIsTrump) {
          const wFollows = winner.card.suit === leadSuit;
          const pFollows = play.card.suit === leadSuit;
          if (!wFollows && pFollows) { winner = play; continue; }
          if (wFollows && pFollows && RANK_ORDER[play.card.rank] > RANK_ORDER[winner.card.rank]) { winner = play; }
        }
      }

      if (POSITION_SIDES[winner.position] === declarerSide) {
        declarerTricks += 1;
      }
    }

    const overtricks = Math.max(0, declarerTricks - targetTricks);
    const undertricks = Math.max(0, targetTricks - declarerTricks);
    const made = declarerTricks >= targetTricks;

    // Score computation (simplified duplicate bridge scoring)
    let nsPoints = 0;
    let ewPoints = 0;

    if (made) {
      // Contract points (simplified - undoubled)
      let cp = 0;
      if (strain === "NT") cp = 40 + (level - 1) * 30;
      else if (strain === "H" || strain === "S") cp = level * 30;
      else cp = level * 20;

      const op = strain === "C" || strain === "D" ? overtricks * 20 : overtricks * 30;
      const total = cp + op;

      if (declarerSide === "NS") { nsPoints = total; ewPoints = 0; }
      else { nsPoints = 0; ewPoints = total; }
    } else {
      const penalty = undertricks * (state.vulnerable ? 200 : 100);
      if (declarerSide === "NS") { nsPoints = -penalty; ewPoints = penalty; }
      else { nsPoints = penalty; ewPoints = -penalty; }
    }

    const resultText = made
      ? `+${overtricks > 0 ? String(overtricks) : "="}`
      : `-${undertricks}`;

    const contractStr = `${level}${strain}`;

    return {
      boardNo: 0,
      declarerSide,
      contractStr,
      tricksWon: declarerTricks,
      targetTricks,
      nsPoints,
      ewPoints,
      winnerSide: made ? declarerSide : (declarerSide === "NS" ? "EW" : "NS"),
      resultText,
    };
  }

  private markExamBoardCompleted(room: Room): void {
    if (room.mode !== "exam" || !room.examInfo) {
      return;
    }

    const boardNo = room.examInfo.boardNo;
    if (!boardNo || boardNo <= 0) {
      return;
    }

    const examName = this.normalizeExamName(room.examInfo.examName);

    let completed = this.examProgressByName.get(examName);
    if (!completed) {
      completed = new Set<number>();
      this.examProgressByName.set(examName, completed);
    }
    completed.add(boardNo);

    // Compute and store result for this board
    const state = room.assistantState;
    if (state) {
      const result = this.computeAssistantResult(state);
      let results = this.examResultsByName.get(examName);
      if (!results) {
        results = new Map<number, ExamBoardResult>();
        this.examResultsByName.set(examName, results);
      }
      results.set(boardNo, result);
    }

    if (completed.size >= this.examBoards.length) {
      this.writeExamSheet(examName, completed);
    }
  }

  private writeExamSheet(examName: string, completedBoards: Set<number>): void {
    const safeName = examName.replace(/[\\/:*?"<>|]/g, "_");
    fs.mkdirSync(EXAM_EXPORT_DIR, { recursive: true });
    const csvPath = path.join(EXAM_EXPORT_DIR, `exam_sheet_${safeName}.csv`);
    const results = this.examResultsByName.get(examName);

    const lines: string[] = [];
    lines.push("轮次,局 况,定约,结果,南北得分,东西得分,备注");

    for (const board of this.examBoards) {
      const r = results?.get(board.boardNo);
      const completed = completedBoards.has(board.boardNo);
      const contractStr = r?.contractStr ?? "";
      const resultText = completed ? (r?.resultText ?? "完成") : "";
      const nsScore = completed ? String(r?.nsPoints ?? "") : "";
      const ewScore = completed ? String(r?.ewPoints ?? "") : "";
      lines.push(`${board.boardNo},${board.vulnerability},${contractStr},${resultText},${nsScore},${ewScore},`);
    }

    lines.push("合计,,,,,,");
    fs.writeFileSync(csvPath, `${lines.join("\n")}\n`, "utf8");

    // Also generate Markdown + PDF via Python script
    this.generateExamPdf(examName, safeName, completedBoards);
  }

  private generateExamPdf(examName: string, safeName: string, completedBoards: Set<number>): void {
    const pythonScript = path.resolve(__dirname, "../generate_exam_pdf.py");
    if (!fs.existsSync(pythonScript)) {
      console.warn(`  [exam] Python PDF script not found: ${pythonScript}`);
      return;
    }

    const results = this.examResultsByName.get(examName);

    const boardsJson = JSON.stringify(
      this.examBoards.map((board) => {
        const r = results?.get(board.boardNo);
        return {
          boardNo: board.boardNo,
          vulnerability: board.vulnerability,
          completed: completedBoards.has(board.boardNo),
          contractStr: r?.contractStr ?? "",
          resultText: r?.resultText ?? "",
          nsPoints: r?.nsPoints ?? 0,
          ewPoints: r?.ewPoints ?? 0,
          winnerSide: r?.winnerSide ?? "",
        };
      }),
    );

    const inputJson = JSON.stringify({ examName, boards: JSON.parse(boardsJson) });

    try {
      // Try multiple Python paths
      const pythonCandidates = [
        process.env.PYTHON,
        process.env.PYTHON_PATH,
        "C:\\msys64\\ucrt64\\bin\\python.exe",
        "C:\\msys64\\usr\\bin\\python.exe",
        "python3",
        "python",
      ].filter(Boolean) as string[];

      let pythonExe = "";
      for (const candidate of pythonCandidates) {
        try {
          execSync(`"${candidate}" --version`, { timeout: 5000, encoding: "utf8" });
          pythonExe = candidate;
          break;
        } catch {
          continue;
        }
      }

      if (!pythonExe) {
        console.warn("  [exam] Python not found, skipping PDF generation");
        return;
      }

      const result = execSync(
        `"${pythonExe}" "${pythonScript}"`,
        { input: inputJson, timeout: 30_000, encoding: "utf8", maxBuffer: 1024 * 1024 },
      );
      const lines = result.trim().split("\n");
      const jsonLine = lines.find((l) => l.startsWith("{"));
      if (jsonLine) {
        const paths = JSON.parse(jsonLine) as { markdown: string; pdf: string };
        console.log(`  [exam] PDF generated: ${paths.pdf}`);
      }
    } catch (err) {
      console.warn(`  [exam] PDF generation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private sanitizeCardList(cards: Card[]): Card[] {
    const seen = new Set<string>();
    const result: Card[] = [];
    for (const card of cards) {
      const key = `${card.suit}-${card.rank}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push({ suit: card.suit, rank: card.rank });
    }
    return result;
  }

  private assertAssistantNoDuplicateCards(state: AssistantGameState): void {
    const seen = new Set<string>();

    // Known hands must be a valid global partition without duplicates.
    for (const position of POSITIONS) {
      for (const card of state.knownHands[position] ?? []) {
        const key = `${card.suit}-${card.rank}`;
        if (seen.has(key)) {
          throw new Error(`Duplicate card detected in known hands: ${key}`);
        }
        seen.add(key);
      }
    }

    // Current trick and played history must not contain duplicate entries.
    const seenPlayed = new Set<string>();
    for (const item of [...state.playedCards, ...state.currentTrick]) {
      const key = `${item.card.suit}-${item.card.rank}`;
      if (seenPlayed.has(key)) {
        throw new Error(`Duplicate played card detected: ${key}`);
      }
      seenPlayed.add(key);
    }
  }

  private assertAssistantCardAvailable(state: AssistantGameState, card: Card): void {
    const key = `${card.suit}-${card.rank}`;
    for (const played of state.playedCards) {
      if (`${played.card.suit}-${played.card.rank}` === key) {
        throw new Error(`Card ${key} was already played.`);
      }
    }
    for (const inTrick of state.currentTrick) {
      if (`${inTrick.card.suit}-${inTrick.card.rank}` === key) {
        throw new Error(`Card ${key} is already in current trick.`);
      }
    }

    return;
  }

  private partnerPosition(position: PlayerPosition): PlayerPosition {
    if (position === "N") {
      return "S";
    }
    if (position === "S") {
      return "N";
    }
    if (position === "E") {
      return "W";
    }
    return "E";
  }

  private nextPosition(position: PlayerPosition): PlayerPosition {
    const index = POSITIONS.indexOf(position);
    return POSITIONS[(index + 1) % POSITIONS.length];
  }

  private generateInviteCode(): string {
    let result = "";
    for (let i = 0; i < 6; i += 1) {
      const idx = Math.floor(Math.random() * INVITE_CHARS.length);
      result += INVITE_CHARS[idx];
    }
    return result;
  }

  private isReadyToStart(room: Room): boolean {
    if (room.gameState.phase !== "waiting") {
      return false;
    }

    if (room.players.length !== 4) {
      return false;
    }

    const occupied = new Set(room.players.map((p) => p.position).filter(Boolean));
    return occupied.size === 4;
  }

  private startRoomGame(room: Room): void {
    const playersByPosition = this.getPlayersByPosition(room);
    const game = new BridgeGame(playersByPosition);
    room.gameState = game.start();
    this.games.set(room.id, game);
    gameRecordLogger.beginGame(room);
    this.emitRoomEvent(room, "game_started");
  }

  private getPlayersByPosition(room: Room): Record<PlayerPosition, string> {
    const result = { N: "", E: "", S: "", W: "" } as Record<PlayerPosition, string>;

    for (const position of POSITIONS) {
      const seated = room.players.find((p) => p.position === position);
      if (!seated) {
        throw new Error(`Position ${position} is not seated.`);
      }
      result[position] = seated.id;
    }

    return result;
  }

  private cloneRoom(room: Room): Room {
    return JSON.parse(JSON.stringify(room)) as Room;
  }

  private cloneRoomEvents(events: RoomEvent[]): RoomEvent[] {
    return JSON.parse(JSON.stringify(events)) as RoomEvent[];
  }

  private assertHost(room: Room, hostId: string): void {
    if (room.creatorId !== hostId) {
      throw new Error("Only the host can perform this action.");
    }
  }

  private touchPlayerPresence(inviteCode: string, playerId: string): void {
    let roomPresence = this.roomHeartbeats.get(inviteCode);
    if (!roomPresence) {
      roomPresence = new Map<string, number>();
      this.roomHeartbeats.set(inviteCode, roomPresence);
    }

    roomPresence.set(playerId, Date.now());
  }

  private releasePlayerFromRoom(room: Room, playerId: string, eventType: "player_left" | "player_kicked", meta?: RoomEventMeta): Room | null {
    room.players = room.players.filter((player) => player.id !== playerId);
    this.removePlayerPresence(room.id, playerId);

    if (room.players.length === 0) {
      if (room.gameState.phase !== "waiting") {
        gameRecordLogger.abortGame(room, eventType, meta);
      } else if (room.mode === "assistant" || room.mode === "exam") {
        gameRecordLogger.abortAssistantGame(room, eventType, meta);
      }
      this.clearRoomState(room.id);
      return null;
    }

    room.creatorId = room.players[0].id;

    if (room.gameState.phase !== "waiting") {
      gameRecordLogger.abortGame(room, eventType, meta);
      for (const player of room.players) {
        player.position = null;
      }

      room.gameState = emptyGameState();
      this.games.delete(room.id);
      this.emitRoomEvent(room, eventType, meta);
      this.emitRoomEvent(room, "game_reset");
      return this.cloneRoom(room);
    } else if (room.mode === "assistant" || room.mode === "exam") {
      gameRecordLogger.abortAssistantGame(room, eventType, meta);
      this.clearRoomState(room.id);
      return null;
    }

    this.emitRoomEvent(room, eventType, meta);
    return this.cloneRoom(room);
  }

  private removePlayerPresence(inviteCode: string, playerId: string): void {
    const roomPresence = this.roomHeartbeats.get(inviteCode);
    if (!roomPresence) {
      return;
    }

    roomPresence.delete(playerId);
    if (roomPresence.size === 0) {
      this.roomHeartbeats.delete(inviteCode);
    }
  }

  private clearRoomState(inviteCode: string): void {
    gameRecordLogger.clearRoom(inviteCode);
    this.rooms.delete(inviteCode);
    this.games.delete(inviteCode);
    this.roomListeners.delete(inviteCode);
    this.roomEventSequence.delete(inviteCode);
    this.roomEventHistory.delete(inviteCode);
    this.roomHeartbeats.delete(inviteCode);
  }

  private releaseStalePlayers(): void {
    const now = Date.now();

    for (const [inviteCode, room] of this.rooms.entries()) {
      const roomPresence = this.roomHeartbeats.get(inviteCode);
      if (!roomPresence) {
        continue;
      }

      const stalePlayers = room.players
        .filter((player) => now - (roomPresence.get(player.id) ?? 0) >= PLAYER_HEARTBEAT_TIMEOUT_MS)
        .map((player) => player.id);

      for (const playerId of stalePlayers) {
        const activeRoom = this.rooms.get(inviteCode);
        if (!activeRoom || !activeRoom.players.some((player) => player.id === playerId)) {
          continue;
        }

        this.releasePlayerFromRoom(activeRoom, playerId, "player_left", {
          actorPlayerId: playerId,
          targetPlayerId: playerId,
        });
      }
    }
  }

  private emitRoomEvent(room: Room, type: RoomEventType, meta?: RoomEventMeta): void {
    const sequence = (this.roomEventSequence.get(room.id) ?? 0) + 1;
    this.roomEventSequence.set(room.id, sequence);

    const event: RoomEvent = {
      type,
      inviteCode: room.id,
      sequence,
      at: Date.now(),
      room: this.cloneRoom(room),
      ...(meta ? { meta } : {}),
    };

    const history = this.roomEventHistory.get(room.id) ?? [];
    history.push(event);
    this.roomEventHistory.set(room.id, history.slice(-MAX_ROOM_EVENT_HISTORY));

    const listeners = this.roomListeners.get(room.id);
    if (!listeners || listeners.size === 0) {
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  }
}

export const lobbyManager = LobbyManager.getInstance();
