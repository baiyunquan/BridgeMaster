import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  getAssistantAnalysisPayload,
  getRoom,
  dissolveRoom,
  joinRoom,
  resetAssistantBoard,
  sendHeartbeat,
  setAssistantContract,
  setAssistantOperator,
  submitAssistantPlay,
  undoAssistantPlay,
  upsertAssistantHand,
} from "@/api";
import { useRoomStream } from "@/composables/useRoomStream";
import type { AssistantContract, Card, DdsAnalysisRequest, PlayerPosition } from "@/types";

const PLAYER_NAME_STORAGE_KEY = "bridge-player-name";
const HEARTBEAT_INTERVAL_MS = 20_000;

export function useAssistantRoom() {
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
  const inviteCode = ref(String(route.query.room ?? "").toUpperCase());
  const actionError = ref("");
  const leaveSent = ref(false);
  const closingRoom = ref(false);
  let heartbeatTimer: number | null = null;

  const { room, events, connected, error, reconnect } = useRoomStream(inviteCode);

  const assistantState = computed(() => room.value?.assistantState ?? null);

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
      if (room.value.mode !== "assistant") {
        await router.replace({
          name: "player-setup",
          params: { playerId: playerId.value },
          query: { room: inviteCode.value },
        });
        return;
      }
      await sendHeartbeat(inviteCode.value, playerId.value);
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : "加入辅助房间失败";
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

  async function updateOperator(position: PlayerPosition) {
    try {
      actionError.value = "";
      await setAssistantOperator(inviteCode.value, playerId.value, position);
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : "更新操作席位失败";
    }
  }

  async function updateContract(contract: AssistantContract, vulnerable: number) {
    try {
      actionError.value = "";
      await setAssistantContract(inviteCode.value, playerId.value, contract, vulnerable);
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : "更新定约失败";
    }
  }

  async function updateKnownHand(position: PlayerPosition, cards: Card[]) {
    try {
      actionError.value = "";
      await upsertAssistantHand(inviteCode.value, playerId.value, position, cards);
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : "更新已知手牌失败";
    }
  }

  async function submitPlay(position: PlayerPosition, card: Card) {
    try {
      actionError.value = "";
      await submitAssistantPlay(inviteCode.value, playerId.value, { position, card });
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : "录入出牌失败";
    }
  }

  async function undoPlay() {
    try {
      actionError.value = "";
      await undoAssistantPlay(inviteCode.value, playerId.value);
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : "撤销失败";
    }
  }

  async function resetBoard() {
    try {
      actionError.value = "";
      await resetAssistantBoard(inviteCode.value, playerId.value);
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : "重置失败";
    }
  }

  async function fetchDdsPayload(): Promise<DdsAnalysisRequest | null> {
    try {
      actionError.value = "";
      return await getAssistantAnalysisPayload(inviteCode.value, playerId.value);
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : "DDS 输入生成失败";
      return null;
    }
  }

  async function closeAssistantRoom() {
    if (!inviteCode.value || !playerId.value || closingRoom.value) {
      return;
    }

    try {
      actionError.value = "";
      closingRoom.value = true;
      await dissolveRoom(inviteCode.value, playerId.value);
      leaveSent.value = true;
      stopHeartbeat();
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : "关闭房间失败";
    } finally {
      closingRoom.value = false;
    }
  }

  onMounted(() => {
    startHeartbeat();
  });

  onUnmounted(() => {
    stopHeartbeat();
  });

  void ensureJoined();

  return {
    router,
    playerId,
    inviteCode,
    actionError,
    room,
    assistantState,
    events,
    connected,
    error,
    reconnect,
    ensureJoined,
    updateOperator,
    updateContract,
    updateKnownHand,
    submitPlay,
    undoPlay,
    resetBoard,
    fetchDdsPayload,
    closeAssistantRoom,
  };
}
