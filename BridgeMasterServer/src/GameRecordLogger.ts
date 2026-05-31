import fs from "node:fs";
import path from "node:path";
import { AssistantGameState, BridgeGameState, PlayerPosition, Room, RoomEventMeta, RoomMode } from "./types";

export type GameRecordStatus = "completed" | "aborted";

export interface GameRecordEntry {
  inviteCode: string;
  roomName: string;
  mode: RoomMode;
  gameIndex: number;
  status: GameRecordStatus;
  startedAt: number;
  endedAt: number;
  playersByPosition: Record<PlayerPosition, string>;
  contractResult?: string;
  winnerSide?: string;
  loserSide?: string;
  declarerSide?: string;
  terminationReason?: string;
  actorPlayerId?: string;
  targetPlayerId?: string;
  assistantResult?: {
    operatorPosition: PlayerPosition;
    declarer?: PlayerPosition;
    strain?: string;
    vulnerable: number;
    playedCount: number;
    completed: boolean;
  };
}

interface ActiveGameRecord {
  inviteCode: string;
  roomName: string;
  gameIndex: number;
  startedAt: number;
  playersByPosition: Record<PlayerPosition, string>;
}

const DEFAULT_RECORD_LOG_PATH = path.resolve(__dirname, "../logs/game-records.jsonl");

export class GameRecordLogger {
  private activeGames = new Map<string, ActiveGameRecord>();

  private roomGameIndex = new Map<string, number>();

  private readonly logPath: string;

  constructor(logPath = process.env.GAME_RECORD_LOG_PATH || DEFAULT_RECORD_LOG_PATH) {
    this.logPath = logPath;
  }

  public beginGame(room: Room): void {
    const gameIndex = (this.roomGameIndex.get(room.id) ?? 0) + 1;
    this.roomGameIndex.set(room.id, gameIndex);
    this.activeGames.set(room.id, {
      inviteCode: room.id,
      roomName: room.name,
      gameIndex,
      startedAt: Date.now(),
      playersByPosition: { ...room.gameState.playersByPosition },
    });
  }

  public finishAssistantGame(room: Room): void {
    if (room.mode !== "assistant") {
      return;
    }

    const state = room.assistantState;
    if (!state) {
      return;
    }

    const gameIndex = (this.roomGameIndex.get(room.id) ?? 0) + 1;
    this.roomGameIndex.set(room.id, gameIndex);

    this.writeRecord({
      inviteCode: room.id,
      roomName: room.name,
      mode: room.mode,
      gameIndex,
      status: "completed",
      startedAt: Date.now(),
      endedAt: Date.now(),
      playersByPosition: this.emptyPlayersByPosition(),
      assistantResult: this.extractAssistantResult(state),
    });
  }

  public finishGame(room: Room): void {
    const active = this.activeGames.get(room.id);
    if (!active) {
      return;
    }

    const score = room.gameState.score;
    this.writeRecord({
      inviteCode: active.inviteCode,
      roomName: active.roomName,
      mode: "normal",
      gameIndex: active.gameIndex,
      status: "completed",
      startedAt: active.startedAt,
      endedAt: Date.now(),
      playersByPosition: active.playersByPosition,
      contractResult: score?.contractResult,
      winnerSide: score?.winnerSide,
      loserSide: score?.loserSide,
      declarerSide: score?.declarerSide,
    });
    this.activeGames.delete(room.id);
  }

  public abortGame(room: Room, reason: string, meta?: RoomEventMeta): void {
    const active = this.activeGames.get(room.id);
    if (!active) {
      return;
    }

    this.writeRecord({
      inviteCode: active.inviteCode,
      roomName: active.roomName,
      mode: "normal",
      gameIndex: active.gameIndex,
      status: "aborted",
      startedAt: active.startedAt,
      endedAt: Date.now(),
      playersByPosition: active.playersByPosition,
      terminationReason: reason,
      actorPlayerId: meta?.actorPlayerId,
      targetPlayerId: meta?.targetPlayerId,
    });
    this.activeGames.delete(room.id);
  }

  public clearRoom(roomId: string): void {
    this.activeGames.delete(roomId);
    this.roomGameIndex.delete(roomId);
  }

  public getLogPath(): string {
    return this.logPath;
  }

  private writeRecord(record: GameRecordEntry): void {
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    fs.appendFileSync(this.logPath, `${JSON.stringify(record)}\n`, "utf8");
  }

  private extractAssistantResult(state: AssistantGameState): NonNullable<GameRecordEntry["assistantResult"]> {
    return {
      operatorPosition: state.operatorPosition,
      declarer: state.contract?.declarer,
      strain: state.contract?.strain,
      vulnerable: state.vulnerable,
      playedCount: state.playedCards.length + state.currentTrick.length,
      completed: state.phase === "finished",
    };
  }

  private emptyPlayersByPosition(): Record<PlayerPosition, string> {
    return { N: "", E: "", S: "", W: "" };
  }
}

export const gameRecordLogger = new GameRecordLogger();