import { BridgeGame } from "./BridgeGame";
import { gameRecordLogger } from "./GameRecordLogger";
import {
  AssistantContract,
  AssistantGameState,
  AssistantPositionedCard,
  BridgeGameState,
  Card,
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

  private constructor() {
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

  public createRoom(roomName: string, creatorId: string, creatorName: string, mode: RoomMode = "normal"): Room {
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

    const room: Room = {
      id: inviteCode,
      name: trimmedName,
      mode,
      creatorId,
      players: [creator],
      gameState: emptyGameState(),
      assistantState: mode === "assistant" ? emptyAssistantState() : null,
    };

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

    if (room.mode === "assistant") {
      throw new Error("Assistant room allows only the creator to operate.");
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
    if (room.mode === "assistant") {
      throw new Error("Assistant room does not use seat assignment.");
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
      .filter((room) => (room.mode === "assistant" ? true : room.players.length < 4))
      .map((room) => ({
        id: room.id,
        name: room.name,
        mode: room.mode,
        playerCount: room.players.length,
      }));
  }

  public getRoom(inviteCode: string): Room {
    return this.cloneRoom(this.getRoomOrThrow(inviteCode));
  }

  public submitBid(inviteCode: string, playerId: string, bid: Parameters<BridgeGame["submitBid"]>[1]): Room {
    const room = this.getRoomOrThrow(inviteCode);
    if (room.mode === "assistant") {
      throw new Error("Assistant room does not support bidding API.");
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
    if (room.mode === "assistant") {
      throw new Error("Assistant room does not support standard play API.");
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
    if (!room.assistantState) {
      throw new Error("Assistant state is missing.");
    }

    room.assistantState.operatorPosition = position;
    this.touchPlayerPresence(room.id, playerId);
    this.emitRoomEvent(room, "assistant_cards_updated", { actorPlayerId: playerId });
    return this.cloneRoom(room);
  }

  public setAssistantContract(inviteCode: string, playerId: string, contract: AssistantContract, vulnerable: number): Room {
    const room = this.getAssistantRoomForOperator(inviteCode, playerId);
    if (!room.assistantState) {
      throw new Error("Assistant state is missing.");
    }

    room.assistantState.contract = { ...contract };
    room.assistantState.turn = contract.declarer;
    room.assistantState.vulnerable = Math.max(0, Math.min(3, Math.trunc(vulnerable)));
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

    state.knownHands[position] = sanitized;
    this.assertAssistantNoDuplicateCards(state);
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

    this.assertAssistantNoDuplicateCards(state);

    return {
      knownHands: state.knownHands,
      handSizes: state.handSizes,
      playedCards: state.playedCards,
      currentTrick: state.currentTrick,
      turn: state.turn,
      contract: state.contract,
      vulnerable: state.vulnerable,
    };
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
    if (room.mode !== "assistant") {
      throw new Error("Room is not assistant mode.");
    }

    if (!room.players.some((player) => player.id === playerId)) {
      throw new Error("Player is not in this room.");
    }

    return room;
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

    for (const position of POSITIONS) {
      for (const known of state.knownHands[position] ?? []) {
        if (`${known.suit}-${known.rank}` === key) {
          return;
        }
      }
    }

    throw new Error(`Card ${key} is not in known hands; please input known cards first.`);
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
