import { onBeforeUnmount, ref, watch, type Ref } from "vue";
import { getRoom } from "@/api";
import type { Room, RoomEvent, RoomStreamSnapshot } from "@/types";

export function useRoomStream(inviteCode: Ref<string>) {
  const room = ref<Room | null>(null);
  const events = ref<RoomEvent[]>([]);
  const connected = ref(false);
  const error = ref("");
  let source: EventSource | null = null;

  async function loadSnapshot(code: string) {
    if (!code) {
      room.value = null;
      return;
    }

    room.value = await getRoom(code);
  }

  function disconnect() {
    connected.value = false;
    source?.close();
    source = null;
  }

  async function connect(code: string) {
    disconnect();
    if (!code) {
      return;
    }

    error.value = "";
    await loadSnapshot(code);

    source = new EventSource(`/api/lobby/rooms/${code}/stream`);
    source.addEventListener("snapshot", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as RoomStreamSnapshot;
      room.value = payload.room;
      events.value = payload.events;
      connected.value = true;
    });

    source.addEventListener("room_event", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as RoomEvent;
      room.value = payload.room;
      events.value = [...events.value.slice(-19), payload];
      connected.value = true;
    });

    source.onerror = () => {
      connected.value = false;
      error.value = "实时连接中断，请检查后端是否运行。";
    };
  }

  watch(
    inviteCode,
    (code) => {
      void connect(code.trim().toUpperCase());
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    disconnect();
  });

  return {
    room,
    events,
    connected,
    error,
    reconnect: () => connect(inviteCode.value.trim().toUpperCase()),
    disconnect,
  };
}
