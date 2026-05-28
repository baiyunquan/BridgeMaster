import type { Bid, Card, Room, RoomSummary } from "@/types";

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

  return (await response.json()) as T;
}

export function getLobbyRooms(): Promise<RoomSummary[]> {
  return request<RoomSummary[]>("/api/lobby/rooms");
}

export function getRoom(inviteCode: string): Promise<Room> {
  return request<Room>(`/api/lobby/rooms/${inviteCode}`);
}

export function createRoom(roomName: string, creatorId: string, creatorName: string): Promise<Room> {
  return request<Room>("/api/lobby/rooms", {
    method: "POST",
    body: JSON.stringify({ roomName, creatorId, creatorName }),
  });
}

export function joinRoom(inviteCode: string, playerId: string, playerName: string): Promise<Room> {
  return request<Room>(`/api/lobby/rooms/${inviteCode}/join`, {
    method: "POST",
    body: JSON.stringify({ playerId, playerName }),
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
