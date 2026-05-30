import cors from "cors";
import express, { Request, Response } from "express";
import path from "path";
import { gameRecordLogger } from "./GameRecordLogger";
import { lobbyManager, RoomEvent } from "./LobbyManager";
import { Bid, Card, PlayerPosition } from "./types";

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const SHARED_PUBLIC_DIR = path.resolve(__dirname, "../../public");

app.use(cors());
app.use(express.json());
app.use(express.text({ type: "text/plain" }));
app.use(express.static(SHARED_PUBLIC_DIR));

function handleError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown server error";
  res.status(400).json({ error: message });
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function parsePosition(value: unknown): PlayerPosition {
  if (value === "N" || value === "E" || value === "S" || value === "W") {
    return value;
  }
  throw new Error("position must be one of N/E/S/W");
}

function parseBid(value: unknown): Bid {
  if (!value || typeof value !== "object") {
    throw new Error("bid payload is required");
  }

  const bid = value as Bid;

  if (bid.type === "pass" || bid.type === "double" || bid.type === "redouble") {
    return { type: bid.type };
  }

  if (
    bid.type === "bid" &&
    (bid.level === 1 ||
      bid.level === 2 ||
      bid.level === 3 ||
      bid.level === 4 ||
      bid.level === 5 ||
      bid.level === 6 ||
      bid.level === 7) &&
    (bid.strain === "C" || bid.strain === "D" || bid.strain === "H" || bid.strain === "S" || bid.strain === "NT")
  ) {
    return bid;
  }

  throw new Error("Invalid bid payload.");
}

function parseCard(value: unknown): Card {
  if (!value || typeof value !== "object") {
    throw new Error("card payload is required");
  }

  const card = value as Card;
  const validSuit = card.suit === "C" || card.suit === "D" || card.suit === "H" || card.suit === "S";
  const validRank =
    card.rank === "2" ||
    card.rank === "3" ||
    card.rank === "4" ||
    card.rank === "5" ||
    card.rank === "6" ||
    card.rank === "7" ||
    card.rank === "8" ||
    card.rank === "9" ||
    card.rank === "10" ||
    card.rank === "J" ||
    card.rank === "Q" ||
    card.rank === "K" ||
    card.rank === "A";

  if (!validSuit || !validRank) {
    throw new Error("Invalid card payload.");
  }

  return card;
}

function getInviteCode(req: Request): string {
  const { inviteCode } = req.params;
  if (typeof inviteCode !== "string" || !inviteCode.trim()) {
    throw new Error("inviteCode is required.");
  }
  return inviteCode.trim();
}

function sendSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

app.get("/api/lobby/rooms", (_req: Request, res: Response) => {
  res.json(lobbyManager.getLobbyRooms());
});

app.get("/api/lobby/rooms/:inviteCode", (req: Request, res: Response) => {
  try {
    const room = lobbyManager.getRoom(getInviteCode(req));
    res.json(room);
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/lobby/rooms/:inviteCode/stream", (req: Request, res: Response) => {
  let unsubscribe: (() => void) | null = null;
  let keepAlive: NodeJS.Timeout | null = null;

  try {
    const inviteCode = getInviteCode(req);
    const snapshot = lobbyManager.getRoomSnapshot(inviteCode);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    sendSse(res, "snapshot", {
      inviteCode: snapshot.room.id,
      at: Date.now(),
      room: snapshot.room,
      events: snapshot.events,
    });

    unsubscribe = lobbyManager.subscribeRoom(inviteCode, (event: RoomEvent) => {
      sendSse(res, "room_event", event);
    });

    keepAlive = setInterval(() => {
      res.write(": ping\n\n");
    }, 15000);

    req.on("close", () => {
      if (unsubscribe) {
        unsubscribe();
      }
      if (keepAlive) {
        clearInterval(keepAlive);
      }
      res.end();
    });
  } catch (error) {
    if (unsubscribe) {
      unsubscribe();
    }
    if (keepAlive) {
      clearInterval(keepAlive);
    }
    handleError(res, error);
  }
});

app.post("/api/lobby/rooms", (req: Request, res: Response) => {
  try {
    const roomName = requiredString(req.body?.roomName, "roomName");
    const creatorId = requiredString(req.body?.creatorId, "creatorId");
    const creatorName = optionalString(req.body?.creatorName) ?? creatorId;
    const room = lobbyManager.createRoom(roomName, creatorId, creatorName);
    res.status(201).json(room);
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/api/lobby/rooms/:inviteCode/join", (req: Request, res: Response) => {
  try {
    const playerId = requiredString(req.body?.playerId, "playerId");
    const playerName = optionalString(req.body?.playerName) ?? playerId;
    const room = lobbyManager.joinRoomByCode(getInviteCode(req), playerId, playerName);
    res.json(room);
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/api/lobby/rooms/:inviteCode/leave", (req: Request, res: Response) => {
  try {
    let body: unknown = req.body;

    if (typeof body === "string") {
      body = JSON.parse(body);
    }

    const payload = body as { playerId?: unknown };
    const playerId = requiredString(payload?.playerId, "playerId");
    const room = lobbyManager.leaveRoomByCode(getInviteCode(req), playerId);

    if (!room) {
      res.status(204).send();
      return;
    }

    res.json(room);
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/api/lobby/rooms/:inviteCode/kick", (req: Request, res: Response) => {
  try {
    const hostId = requiredString(req.body?.hostId, "hostId");
    const targetPlayerId = requiredString(req.body?.targetPlayerId, "targetPlayerId");
    const room = lobbyManager.kickPlayer(getInviteCode(req), hostId, targetPlayerId);

    if (!room) {
      res.status(204).send();
      return;
    }

    res.json(room);
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/api/lobby/rooms/:inviteCode/dissolve", (req: Request, res: Response) => {
  try {
    const hostId = requiredString(req.body?.hostId, "hostId");
    lobbyManager.dissolveRoom(getInviteCode(req), hostId);
    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/api/lobby/rooms/:inviteCode/heartbeat", (req: Request, res: Response) => {
  try {
    const playerId = requiredString(req.body?.playerId, "playerId");
    lobbyManager.touchPlayerHeartbeat(getInviteCode(req), playerId);
    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/api/lobby/rooms/:inviteCode/sit", (req: Request, res: Response) => {
  try {
    const playerId = requiredString(req.body?.playerId, "playerId");
    const position = parsePosition(req.body?.position);
    const room = lobbyManager.sitDown(getInviteCode(req), playerId, position);
    res.json(room);
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/api/lobby/rooms/:inviteCode/bid", (req: Request, res: Response) => {
  try {
    const playerId = requiredString(req.body?.playerId, "playerId");
    const bid = parseBid(req.body?.bid);
    const room = lobbyManager.submitBid(getInviteCode(req), playerId, bid);
    if (room.gameState.phase === "finished") {
      gameRecordLogger.finishGame(room);
    }
    res.json(room);
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/api/lobby/rooms/:inviteCode/play", (req: Request, res: Response) => {
  try {
    const playerId = requiredString(req.body?.playerId, "playerId");
    const card = parseCard(req.body?.card);
    const room = lobbyManager.submitCard(getInviteCode(req), playerId, card);
    if (room.gameState.phase === "finished") {
      gameRecordLogger.finishGame(room);
    }
    res.json(room);
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/game-records", (_req: Request, res: Response) => {
  res.json({ path: gameRecordLogger.getLogPath() });
});

app.listen(PORT, () => {
  console.log(`BridgeMasterServer is running on http://localhost:${PORT}`);
});
