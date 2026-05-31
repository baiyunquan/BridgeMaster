import type {
  AssistantContract,
  AssistantPositionedCard,
  Bid,
  Card,
  DdsAnalysisRequest,
  DdsAnalysisResult,
  PlayerPosition,
  Room,
  RoomMode,
  RoomSummary,
} from "@/types";

const DDS_API_BASE = (import.meta.env.VITE_DDS_API_BASE as string | undefined) ?? (import.meta.env.DEV ? "/dds-api" : "http://localhost:8001");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error ?? response.statusText);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

async function ddsRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${DDS_API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(payload.detail ?? payload.error ?? response.statusText);
  }

  return (await response.json()) as T;
}

export function getLobbyRooms(): Promise<RoomSummary[]> {
  return request<RoomSummary[]>("/api/lobby/rooms");
}

export function getRoom(inviteCode: string): Promise<Room> {
  return request<Room>(`/api/lobby/rooms/${inviteCode}`);
}

export function createRoom(roomName: string, creatorId: string, creatorName?: string, mode: RoomMode = "normal"): Promise<Room> {
  return request<Room>("/api/lobby/rooms", {
    method: "POST",
    body: JSON.stringify({ roomName, creatorId, creatorName, mode }),
  });
}

export function joinRoom(inviteCode: string, playerId: string, playerName?: string): Promise<Room> {
  return request<Room>(`/api/lobby/rooms/${inviteCode}/join`, {
    method: "POST",
    body: JSON.stringify({ playerId, playerName }),
  });
}

export function leaveRoom(inviteCode: string, playerId: string): Promise<Room | null> {
  return request<Room | null>(`/api/lobby/rooms/${inviteCode}/leave`, {
    method: "POST",
    body: JSON.stringify({ playerId }),
  });
}

export function kickPlayer(inviteCode: string, hostId: string, targetPlayerId: string): Promise<Room | null> {
  return request<Room | null>(`/api/lobby/rooms/${inviteCode}/kick`, {
    method: "POST",
    body: JSON.stringify({ hostId, targetPlayerId }),
  });
}

export function dissolveRoom(inviteCode: string, hostId: string): Promise<null> {
  return request<null>(`/api/lobby/rooms/${inviteCode}/dissolve`, {
    method: "POST",
    body: JSON.stringify({ hostId }),
  });
}

export function leaveRoomWithBeacon(inviteCode: string, playerId: string): boolean {
  if (!inviteCode || !playerId || typeof navigator === "undefined" || !navigator.sendBeacon) {
    return false;
  }

  const payload = new Blob([JSON.stringify({ playerId })], { type: "application/json" });
  return navigator.sendBeacon(`/api/lobby/rooms/${inviteCode}/leave`, payload);
}

export function sendHeartbeat(inviteCode: string, playerId: string): Promise<null> {
  return request<null>(`/api/lobby/rooms/${inviteCode}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({ playerId }),
  });
}

export function sitDown(inviteCode: string, playerId: string, position: string): Promise<Room> {
  return request<Room>(`/api/lobby/rooms/${inviteCode}/sit`, {
    method: "POST",
    body: JSON.stringify({ playerId, position }),
  });
}

export function submitBid(inviteCode: string, playerId: string, bid: Bid): Promise<Room> {
  return request<Room>(`/api/lobby/rooms/${inviteCode}/bid`, {
    method: "POST",
    body: JSON.stringify({ playerId, bid }),
  });
}

export function submitCard(inviteCode: string, playerId: string, card: Card): Promise<Room> {
  return request<Room>(`/api/lobby/rooms/${inviteCode}/play`, {
    method: "POST",
    body: JSON.stringify({ playerId, card }),
  });
}

export function analyzeDdsPosition(payload: DdsAnalysisRequest): Promise<DdsAnalysisResult> {
  return ddsRequest<DdsAnalysisResult>("/api/dds/analyze", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function setAssistantOperator(inviteCode: string, playerId: string, position: PlayerPosition): Promise<Room> {
  return request<Room>(`/api/lobby/rooms/${inviteCode}/assistant/operator`, {
    method: "POST",
    body: JSON.stringify({ playerId, position }),
  });
}

export function setAssistantContract(
  inviteCode: string,
  playerId: string,
  contract: AssistantContract,
  vulnerable = 0,
): Promise<Room> {
  return request<Room>(`/api/lobby/rooms/${inviteCode}/assistant/contract`, {
    method: "POST",
    body: JSON.stringify({ playerId, contract, vulnerable }),
  });
}

export function upsertAssistantHand(
  inviteCode: string,
  playerId: string,
  position: PlayerPosition,
  cards: Card[],
): Promise<Room> {
  return request<Room>(`/api/lobby/rooms/${inviteCode}/assistant/hands/${position}`, {
    method: "POST",
    body: JSON.stringify({ playerId, cards }),
  });
}

export function submitAssistantPlay(inviteCode: string, playerId: string, play: AssistantPositionedCard): Promise<Room> {
  return request<Room>(`/api/lobby/rooms/${inviteCode}/assistant/play`, {
    method: "POST",
    body: JSON.stringify({ playerId, play }),
  });
}

export function undoAssistantPlay(inviteCode: string, playerId: string): Promise<Room> {
  return request<Room>(`/api/lobby/rooms/${inviteCode}/assistant/undo`, {
    method: "POST",
    body: JSON.stringify({ playerId }),
  });
}

export function resetAssistantBoard(inviteCode: string, playerId: string): Promise<Room> {
  return request<Room>(`/api/lobby/rooms/${inviteCode}/assistant/reset`, {
    method: "POST",
    body: JSON.stringify({ playerId }),
  });
}

export function getAssistantAnalysisPayload(inviteCode: string, playerId: string): Promise<DdsAnalysisRequest> {
  return request<DdsAnalysisRequest>(`/api/lobby/rooms/${inviteCode}/assistant/analysis?playerId=${encodeURIComponent(playerId)}`);
}
