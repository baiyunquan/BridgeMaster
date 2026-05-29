<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import CardFace from "@/components/CardFace.vue";
import LanguageSelector from "@/components/LanguageSelector.vue";
import PlayControls from "@/components/PlayControls.vue";
import PlayerSeatMap from "@/components/PlayerSeatMap.vue";
import { useLanguage } from "@/composables/useLanguage";
import { useRoomEventText } from "@/composables/useRoomEventText";
import { usePlayerRoom } from "@/composables/usePlayerRoom";

const TABLE_MODE_STORAGE_KEY = "bridge-play-table-mode";
const ThreeDTable = defineAsyncComponent(() => import("@/components/ThreeDTable.vue"));

const {
  router,
  playerId,
  playerName,
  inviteCode,
  actionError,
  room,
  events,
  connected,
  error,
  reconnect,
  myPosition,
  roomPhase,
  contractLabel,
  handlePlay,
  handleLeave,
} = usePlayerRoom();
const { t } = useLanguage();
const { formatRoomEvent } = useRoomEventText();
const tableMode = ref<"classic" | "3d">((localStorage.getItem(TABLE_MODE_STORAGE_KEY) as "classic" | "3d" | null) ?? "3d");

watch(tableMode, (value) => {
  localStorage.setItem(TABLE_MODE_STORAGE_KEY, value);
});

const revealedDummyPosition = computed(() => {
  if (!room.value?.gameState.isDummyRevealed) {
    return null;
  }
  return room.value.gameState.dummyPosition;
});

const revealedDummyPlayer = computed(
  () => room.value?.players.find((player) => player.position === revealedDummyPosition.value) ?? null,
);

const revealedDummyHand = computed(() => {
  if (!room.value || !revealedDummyPosition.value) {
    return [];
  }
  return room.value.gameState.hands[revealedDummyPosition.value];
});
</script>

<template>
  <main class="page-shell player-shell">
    <header class="hero-panel compact">
      <div>
        <p class="eyebrow">{{ t("playStage") }}</p>
        <h1>{{ playerName }}</h1>
        <p class="hero-copy">Room {{ inviteCode }} · {{ room?.name ?? t("loading") }}</p>
      </div>
      <div class="top-actions">
        <LanguageSelector />
        <button @click="router.push('/')">{{ t("backToLobby") }}</button>
        <button class="danger" @click="handleLeave">{{ t("leaveRoom") }}</button>
        <button @click="reconnect">{{ t("reconnect") }}</button>
      </div>
    </header>

    <section class="status-strip">
      <span class="badge ok">{{ connected ? 'SSE Connected' : 'SSE Disconnected' }}</span>
      <span class="badge">{{ t("stagePlay") }}</span>
      <span class="badge">Phase: {{ roomPhase }}</span>
      <span class="badge">{{ t("seatMine") }}: {{ myPosition ?? t("notSeated") }}</span>
      <span class="badge">{{ t("contractCurrent") }}: {{ contractLabel }}</span>
      <span class="badge">{{ t("tableMode") }}: {{ tableMode === '3d' ? t('table3d') : t('tableClassic') }}</span>
    </section>

    <section class="layout-grid player-grid" v-if="room">
      <template v-if="tableMode === 'classic'">
        <PlayerSeatMap :players="room.players" :current-player-id="playerId" :current-turn="room.gameState.turn" />

        <article class="panel wide-panel control-panel">
          <div class="section-title">
            <h3>{{ t("yourConsole") }}</h3>
            <div class="inline-actions">
              <span class="badge">{{ t("playStage") }}</span>
              <button class="slim-button accent" @click="tableMode = 'classic'">{{ t("tableClassic") }}</button>
              <button class="slim-button" @click="tableMode = '3d'">{{ t("table3d") }}</button>
            </div>
          </div>
          <p v-if="error || actionError" class="error-text">{{ actionError || error }}</p>
          <PlayControls :room="room" :player-id="playerId" @submit="handlePlay" />
        </article>

        <article v-if="revealedDummyPosition" class="panel wide-panel">
          <div class="section-title">
            <h3>{{ t("dummyHand") }} {{ revealedDummyPosition }}</h3>
            <span class="badge">{{ revealedDummyPlayer?.name ?? revealedDummyPlayer?.id ?? '未知玩家' }}</span>
          </div>
          <div class="cards-grid hand-grid hand-board">
            <CardFace
              v-for="card in revealedDummyHand"
              :key="`dummy-${card.suit}-${card.rank}`"
              :card="card"
              size="md"
            />
          </div>
        </article>
      </template>

      <article v-else class="panel wide-panel control-panel three-d-panel">
        <div class="section-title">
          <h3>{{ t("yourConsole") }}</h3>
          <div class="inline-actions">
            <span class="badge">{{ t("playStage") }}</span>
            <button class="slim-button" @click="tableMode = 'classic'">{{ t("tableClassic") }}</button>
            <button class="slim-button accent" @click="tableMode = '3d'">{{ t("table3d") }}</button>
          </div>
        </div>
        <p v-if="error || actionError" class="error-text">{{ actionError || error }}</p>
        <ThreeDTable :room="room" :player-id="playerId" @submit="handlePlay" />
      </article>

      <article class="panel">
        <div class="section-title">
          <h3>{{ t("roomEvents") }}</h3>
          <span class="badge">{{ events.length }}</span>
        </div>
        <div class="history-list tall-list">
          <div v-for="event in events" :key="event.sequence" class="history-item">
            <span>{{ formatRoomEvent(event) }}</span>
          </div>
        </div>
      </article>
    </section>
  </main>
</template>
