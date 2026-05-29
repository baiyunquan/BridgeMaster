import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getRoom, joinRoom, leaveRoom, leaveRoomWithBeacon, sendHeartbeat, sitDown, submitBid, submitCard } from "@/api";
import { useRoomStream } from "@/composables/useRoomStream";
import type { Bid, Card, PlayerPosition } from "@/types";

const PLAYER_NAME_STORAGE_KEY = "bridge-player-name";
const HEARTBEAT_INTERVAL_MS = 20_000;

export function usePlayerRoom() {
  const route = useRoute();
  const router = useRouter();
  const playerId = computed(() => String(route.params.playerId ?? ""));
  const displayName = computed(() => {
    const raw = route.query.name;
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }

    return localStorage.getItem(PLAYER_NAME_STORAGE_KEY)?.trim() ?? "";
  });
  const playerName = computed(() => me.value?.name ?? playerId.value);
  const inviteCode = ref(String(route.query.room ?? "").toUpperCase());
  const actionError = ref("");
  const leaveSent = ref(false);
  let heartbeatTimer: number | null = null;

  const { room, events, connected, error, reconnect } = useRoomStream(inviteCode);

  const me = computed(() => room.value?.players.find((player) => player.id === playerId.value) ?? null);
  const myPosition = computed(() => me.value?.position ?? null);
  const availablePositions = computed<PlayerPosition[]>(() => {
    const occupied = new Set<PlayerPosition>((room.value?.players ?? []).flatMap((player) => (player.position ? [player.position] : [])));
    const allPositions: PlayerPosition[] = ["N", "E", "S", "W"];
    return allPositions.filter((position) => !occupied.has(position));
  });
  const roomPhase = computed(() => room.value?.gameState.phase ?? "waiting");
  const myHand = computed(() => {
    if (!room.value || !myPosition.value) {
      return [];
    }

    return room.value.gameState.hands[myPosition.value];
  });
  const contractLabel = computed(() => {
    const contract = room.value?.gameState.contract;
    if (!contract) {
      return "尚未形成定约";
    }
    return `${contract.level}${contract.strain} ${contract.doubled ? "X" : ""}${contract.redoubled ? "XX" : ""}`;
  });

  async function ensureJoined() {
    if (!inviteCode.value) {
      actionError.value = "缺少邀请码";
      return;
    }

    try {
      actionError.value = "";
      leaveSent.value = false;
      await joinRoom(inviteCode.value, playerId.value, displayName.value || undefined);
      room.value = await getRoom(inviteCode.value);
      await sendHeartbeat(inviteCode.value, playerId.value);
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : "加入房间失败";
    }
  }

  async function pushHeartbeat() {
    if (!inviteCode.value || !playerId.value || leaveSent.value) {
      return;
    }

    try {
      await sendHeartbeat(inviteCode.value, playerId.value);
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : "心跳发送失败";
    }
  }

  function startHeartbeat() {
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
    }

    heartbeatTimer = window.setInterval(() => {
      void pushHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer === null) {
      return;
    }

    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function releasePlayerId() {
    if (leaveSent.value || !inviteCode.value || !playerId.value) {
      return;
    }

    leaveSent.value = leaveRoomWithBeacon(inviteCode.value, playerId.value);
  }

  async function handleSit(position: PlayerPosition) {
    try {
      actionError.value = "";
      await sitDown(inviteCode.value, playerId.value, position);
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : "坐下失败";
    }
  }

  async function handleBid(bid: Bid) {
    try {
      actionError.value = "";
      await submitBid(inviteCode.value, playerId.value, bid);
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : "叫牌失败";
    }
  }

  async function handlePlay(card: Card) {
    try {
      actionError.value = "";
      await submitCard(inviteCode.value, playerId.value, card);
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : "出牌失败";
    }
  }

  async function handleLeave() {
    if (!inviteCode.value || !playerId.value) {
      await router.push("/");
      return;
    }

    try {
      actionError.value = "";
      leaveSent.value = true;
      stopHeartbeat();
      await leaveRoom(inviteCode.value, playerId.value);
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : "退出房间失败";
    } finally {
      await router.push("/");
    }
  }

  async function goToPhaseRoute(phase: string) {
    const targetName = phase === "playing" ? "player-play" : phase === "finished" ? "player-result" : "player-setup";
    if (route.name === targetName) {
      return;
    }

    await router.replace({
      name: targetName,
      params: { playerId: playerId.value },
      query: { room: inviteCode.value },
    });
  }

  watch(roomPhase, (phase) => {
    void goToPhaseRoute(phase);
  });

  watch(
    () => events.value.at(-1),
    (latestEvent) => {
      if (latestEvent?.type === "game_reset") {
        void router.push("/");
      }
    },
  );

  onMounted(() => {
    startHeartbeat();
    window.addEventListener("pagehide", releasePlayerId);
    window.addEventListener("beforeunload", releasePlayerId);
  });

  onUnmounted(() => {
    stopHeartbeat();
    window.removeEventListener("pagehide", releasePlayerId);
    window.removeEventListener("beforeunload", releasePlayerId);
  });

  void ensureJoined();

  return {
    router,
    route,
    playerId,
    playerName,
    inviteCode,
    actionError,
    room,
    events,
    connected,
    error,
    reconnect,
    me,
    myPosition,
    availablePositions,
    roomPhase,
    myHand,
    contractLabel,
    ensureJoined,
    handleSit,
    handleBid,
    handlePlay,
    handleLeave,
  };
}
