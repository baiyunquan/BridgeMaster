import cors from "cors";
import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { gameRecordLogger } from "./GameRecordLogger";
import { lobbyManager, RoomEvent } from "./LobbyManager";
import { AssistantContract, AssistantPositionedCard, Bid, Card, PlayerPosition, RoomMode } from "./types";

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const SHARED_PUBLIC_DIR = path.resolve(__dirname, "../../public");
const API_KEY_FILE = path.resolve(__dirname, "../../api_key.json");
const AUTH_ENABLED = process.argv.includes("--auth") || process.env.BRIDGEMASTER_AUTH === "1";
const AUTH_EXEMPT_PATHS = new Set(["/auth/config", "/auth/verify"]);
const EXPECTED_API_KEY = AUTH_ENABLED ? loadApiKey() : "";

app.use(cors());
app.use(express.json());
app.use(express.text({ type: "text/plain" }));
app.use(express.static(SHARED_PUBLIC_DIR));

app.use("/api", (req: Request, res: Response, next) => {
  if (!AUTH_ENABLED || AUTH_EXEMPT_PATHS.has(req.path)) {
    next();
    return;
  }

  const requestApiKey = readRequestApiKey(req);
  if (requestApiKey !== EXPECTED_API_KEY) {
    res.status(401).json({ error: "Invalid api_key." });
    return;
  }

  next();
});

function handleError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown server error";
  res.status(400).json({ error: message });
}

function parseCookieValue(cookieHeader: string | undefined, key: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const chunk of cookieHeader.split(";")) {
    const [name, ...rest] = chunk.trim().split("=");
    if (name !== key) {
      continue;
    }
    return decodeURIComponent(rest.join("="));
  }

  return null;
}

function readRequestApiKey(req: Request): string {
  const headerValue = req.header("x-api-key");
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim();
  }

  const cookieValue = parseCookieValue(req.header("cookie"), "api_key");
  return cookieValue?.trim() ?? "";
}

function loadApiKey(): string {
  if (!fs.existsSync(API_KEY_FILE)) {
    throw new Error(`api_key file not found at ${API_KEY_FILE}`);
  }

  const raw = fs.readFileSync(API_KEY_FILE, "utf8");
  const parsed = JSON.parse(raw) as { api_key?: unknown };
  if (typeof parsed.api_key !== "string" || !parsed.api_key.trim()) {
    throw new Error("api_key.json must contain non-empty string field api_key");
  }
  return parsed.api_key.trim();
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

function parseRoomMode(value: unknown): RoomMode {
  if (value === "assistant") {
    return "assistant";
  }
  return "normal";
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

function parseCards(value: unknown): Card[] {
  if (!Array.isArray(value)) {
    throw new Error("cards payload must be an array.");
  }
  return value.map((item) => parseCard(item));
}

function parseAssistantContract(value: unknown): AssistantContract {
  if (!value || typeof value !== "object") {
    throw new Error("contract payload is required");
  }
  const contract = value as AssistantContract;
  const position = parsePosition(contract.declarer);
  const strain = contract.strain;
  if (!(strain === "C" || strain === "D" || strain === "H" || strain === "S" || strain === "NT")) {
    throw new Error("contract strain must be one of C/D/H/S/NT");
  }
  return { strain, declarer: position };
}

function parseAssistantPlay(value: unknown): AssistantPositionedCard {
  if (!value || typeof value !== "object") {
    throw new Error("assistant play payload is required");
  }

  const raw = value as { position?: unknown; card?: unknown };
  return {
    position: parsePosition(raw.position),
    card: parseCard(raw.card),
  };
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

app.get("/api/auth/config", (_req: Request, res: Response) => {
  res.json({ enabled: AUTH_ENABLED });
});

app.post("/api/auth/verify", (req: Request, res: Response) => {
  if (!AUTH_ENABLED) {
    res.json({ ok: true });
    return;
  }

  const bodyKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  const requestKey = readRequestApiKey(req);
  const providedKey = bodyKey || requestKey;
  if (providedKey !== EXPECTED_API_KEY) {
    res.status(401).json({ error: "Invalid api_key." });
    return;
  }

  res.json({ ok: true });
});

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
    const mode = parseRoomMode(req.body?.mode);
    const room = lobbyManager.createRoom(roomName, creatorId, creatorName, mode);
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

app.post("/api/lobby/rooms/:inviteCode/assistant/operator", (req: Request, res: Response) => {
  try {
    const playerId = requiredString(req.body?.playerId, "playerId");
    const position = parsePosition(req.body?.position);
    const room = lobbyManager.setAssistantOperatorPosition(getInviteCode(req), playerId, position);
    res.json(room);
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/api/lobby/rooms/:inviteCode/assistant/contract", (req: Request, res: Response) => {
  try {
    const playerId = requiredString(req.body?.playerId, "playerId");
    const contract = parseAssistantContract(req.body?.contract);
    const vulnerable = Number(req.body?.vulnerable ?? 0);
    const room = lobbyManager.setAssistantContract(getInviteCode(req), playerId, contract, vulnerable);
    res.json(room);
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/api/lobby/rooms/:inviteCode/assistant/hands/:position", (req: Request, res: Response) => {
  try {
    const playerId = requiredString(req.body?.playerId, "playerId");
    const position = parsePosition(req.params.position);
    const cards = parseCards(req.body?.cards);
    const room = lobbyManager.upsertAssistantKnownHand(getInviteCode(req), playerId, position, cards);
    res.json(room);
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/api/lobby/rooms/:inviteCode/assistant/play", (req: Request, res: Response) => {
  try {
    const playerId = requiredString(req.body?.playerId, "playerId");
    const play = parseAssistantPlay(req.body?.play);
    const room = lobbyManager.submitAssistantCard(getInviteCode(req), playerId, play);
    if (room.assistantState?.phase === "finished") {
      gameRecordLogger.finishAssistantGame(room);
    }
    res.json(room);
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/api/lobby/rooms/:inviteCode/assistant/undo", (req: Request, res: Response) => {
  try {
    const playerId = requiredString(req.body?.playerId, "playerId");
    const room = lobbyManager.undoAssistantCard(getInviteCode(req), playerId);
    res.json(room);
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/api/lobby/rooms/:inviteCode/assistant/reset", (req: Request, res: Response) => {
  try {
    const playerId = requiredString(req.body?.playerId, "playerId");
    const room = lobbyManager.resetAssistantBoard(getInviteCode(req), playerId);
    res.json(room);
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/lobby/rooms/:inviteCode/assistant/analysis", (req: Request, res: Response) => {
  try {
    const playerId = requiredString(req.query.playerId, "playerId");
    const payload = lobbyManager.getAssistantAnalysisInput(getInviteCode(req), playerId);
    res.json(payload);
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
