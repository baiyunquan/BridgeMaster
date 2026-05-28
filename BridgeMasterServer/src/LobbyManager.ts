import { BridgeGame } from "./BridgeGame";
import { BridgeGameState, Player, PlayerPosition, Room, RoomSummary } from "./types";

const POSITIONS: PlayerPosition[] = ["N", "E", "S", "W"];
const INVITE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export type RoomEventType =
  | "room_created"
  | "player_joined"
  | "player_sat"
  | "game_started"
  | "bid_submitted"
  | "card_submitted"
  | "game_finished";

export interface RoomEvent {
  type: RoomEventType;
  inviteCode: string;
  sequence: number;
  at: number;
  room: Room;
}

type RoomEventListener = (event: RoomEvent) => void;

function emptyGameState(): BridgeGameState {
  return {
    phase: "waiting",
    dealer: "N",
    turn: null,
    playersByPosition: { N: "", E: "", S: "", W: "" },
    hands: { N: [], E: [], S: [], W: [] },
    bidHistory: [],
    contract: null,
    tricks: [],
    currentTrick: null,
    score: null,
  };
}

export class LobbyManager {
  private static instance: LobbyManager;

  private rooms = new Map<string, Room>();

  private games = new Map<string, BridgeGame>();

  private roomListeners = new Map<string, Set<RoomEventListener>>();

  private roomEventSequence = new Map<string, number>();

  private constructor() {}

  public static getInstance(): LobbyManager {
    if (!LobbyManager.instance) {
      LobbyManager.instance = new LobbyManager();
    }
    return LobbyManager.instance;
  }

  public createRoom(roomName: string, creatorId: string, creatorName: string): Room {
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
      creatorId,
      players: [creator],
      gameState: emptyGameState(),
    };

    this.rooms.set(inviteCode, room);
    this.emitRoomEvent(room, "room_created");
    return this.cloneRoom(room);
  }

  public joinRoomByCode(inviteCode: string, playerId: string, playerName: string): Room {
    const room = this.getRoomOrThrow(inviteCode);

    const existingPlayer = room.players.find((p) => p.id === playerId);
    if (existingPlayer) {
      return this.cloneRoom(room);
    }

    if (room.players.length >= 4) {
      throw new Error("Room is full (max 4 players).");
    }

    room.players.push({
      id: playerId,
      name: playerName,
      position: null,
    });

    this.emitRoomEvent(room, "player_joined");

    return this.cloneRoom(room);
  }

  public sitDown(inviteCode: string, playerId: string, position: PlayerPosition): Room {
    const room = this.getRoomOrThrow(inviteCode);
    const player = room.players.find((p) => p.id === playerId);

    if (!player) {
      throw new Error("Player is not in this room.");
    }

    if (room.players.some((p) => p.id !== playerId && p.position === position)) {
      throw new Error("This position is already occupied.");
    }

    player.position = position;
    this.emitRoomEvent(room, "player_sat");

    if (this.isReadyToStart(room)) {
      this.startRoomGame(room);
    }

    return this.cloneRoom(room);
  }

  public getLobbyRooms(): RoomSummary[] {
    return Array.from(this.rooms.values())
      .filter((room) => room.players.length < 4)
      .map((room) => ({
        id: room.id,
        name: room.name,
        playerCount: room.players.length,
      }));
  }

  public getRoom(inviteCode: string): Room {
    return this.cloneRoom(this.getRoomOrThrow(inviteCode));
  }

  public submitBid(inviteCode: string, playerId: string, bid: Parameters<BridgeGame["submitBid"]>[1]): Room {
    const room = this.getRoomOrThrow(inviteCode);
    const game = this.games.get(inviteCode);

    if (!game) {
      throw new Error("Game has not started in this room.");
    }

    room.gameState = game.submitBid(playerId, bid);
    this.emitRoomEvent(room, "bid_submitted");
    if (room.gameState.phase === "finished") {
      this.emitRoomEvent(room, "game_finished");
    }
    return this.cloneRoom(room);
  }

  public submitCard(inviteCode: string, playerId: string, card: Parameters<BridgeGame["submitCard"]>[1]): Room {
    const room = this.getRoomOrThrow(inviteCode);
    const game = this.games.get(inviteCode);

    if (!game) {
      throw new Error("Game has not started in this room.");
    }

    room.gameState = game.submitCard(playerId, card);
    this.emitRoomEvent(room, "card_submitted");
    if (room.gameState.phase === "finished") {
      this.emitRoomEvent(room, "game_finished");
    }
    return this.cloneRoom(room);
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

  public getRoomSnapshot(inviteCode: string): Room {
    return this.getRoom(inviteCode);
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

  private emitRoomEvent(room: Room, type: RoomEventType): void {
    const listeners = this.roomListeners.get(room.id);
    if (!listeners || listeners.size === 0) {
      return;
    }

    const sequence = (this.roomEventSequence.get(room.id) ?? 0) + 1;
    this.roomEventSequence.set(room.id, sequence);

    const event: RoomEvent = {
      type,
      inviteCode: room.id,
      sequence,
      at: Date.now(),
      room: this.cloneRoom(room),
    };

    for (const listener of listeners) {
      listener(event);
    }
  }
}

export const lobbyManager = LobbyManager.getInstance();
