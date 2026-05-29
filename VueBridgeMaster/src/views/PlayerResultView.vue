<script setup lang="ts">
import LanguageSelector from "@/components/LanguageSelector.vue";
import PlayerSeatMap from "@/components/PlayerSeatMap.vue";
import ScorePanel from "@/components/ScorePanel.vue";
import { useLanguage } from "@/composables/useLanguage";
import { useRoomEventText } from "@/composables/useRoomEventText";
import { usePlayerRoom } from "@/composables/usePlayerRoom";

const {
  router,
  playerId,
  playerName,
  inviteCode,
  room,
  events,
  connected,
  reconnect,
  myPosition,
  contractLabel,
  handleLeave,
} = usePlayerRoom();
const { t } = useLanguage();
const { formatRoomEvent } = useRoomEventText();
</script>

<template>
  <main class="page-shell player-shell">
    <header class="hero-panel compact">
      <div>
        <p class="eyebrow">{{ t("resultStage") }}</p>
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
      <span class="badge">{{ t("stageResult") }}</span>
      <span class="badge">{{ t("seatMine") }}: {{ myPosition ?? t("notSeated") }}</span>
      <span class="badge">{{ t("contractCurrent") }}: {{ contractLabel }}</span>
    </section>

    <section class="layout-grid player-grid" v-if="room">
      <PlayerSeatMap :players="room.players" :current-player-id="playerId" :current-turn="room.gameState.turn" />

      <article class="panel wide-panel control-panel">
        <div class="section-title">
          <h3>{{ t("resultStage") }}</h3>
          <span class="badge ok">finished</span>
        </div>
        <ScorePanel v-if="room.gameState.score" :score="room.gameState.score" />
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
