<script setup lang="ts">
import BidControls from "@/components/BidControls.vue";
import CardFace from "@/components/CardFace.vue";
import LanguageSelector from "@/components/LanguageSelector.vue";
import PlayerSeatMap from "@/components/PlayerSeatMap.vue";
import { useLanguage } from "@/composables/useLanguage";
import { useRoomEventText } from "@/composables/useRoomEventText";
import { usePlayerRoom } from "@/composables/usePlayerRoom";

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
  myHand,
  contractLabel,
  handleSit,
  handleBid,
  handleLeave,
} = usePlayerRoom();

const { t } = useLanguage();
const { formatRoomEvent } = useRoomEventText();
</script>

<template>
  <main class="page-shell player-shell">
    <header class="hero-panel compact">
      <div>
        <p class="eyebrow">{{ t("setupStage") }}</p>
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
      <span class="badge">{{ t("stageSetupBid") }}</span>
      <span class="badge">Phase: {{ roomPhase }}</span>
      <span class="badge">{{ t("seatMine") }}: {{ myPosition ?? t("notSeated") }}</span>
      <span class="badge">{{ t("contractCurrent") }}: {{ contractLabel }}</span>
    </section>

    <section class="layout-grid player-grid" v-if="room">
      <PlayerSeatMap
        :players="room.players"
        :current-player-id="playerId"
        :current-turn="room.gameState.turn"
        :selectable="!myPosition"
        @seat-click="handleSit"
      />

      <article class="panel control-panel wide-panel">
        <div class="section-title">
          <h3>{{ t("yourConsole") }}</h3>
          <span class="badge">{{ myPosition ? t("seated") : t("waitingSeat") }}</span>
        </div>
        <p v-if="error || actionError" class="error-text">{{ actionError || error }}</p>

        <div v-if="!myPosition" class="control-stack">
          <p class="muted">{{ t("seatHint") }}</p>
        </div>

        <div v-else class="control-stack">
          <BidControls :room="room" :player-id="playerId" @submit="handleBid" />
        </div>
      </article>

      <article class="panel">
        <div class="section-title">
          <h3>{{ t("roomMembers") }}</h3>
          <span class="badge">{{ room.players.length }}</span>
        </div>
        <div class="member-list">
          <div v-for="player in room.players" :key="player.id" class="history-item">
            <strong>{{ player.name }}</strong>
            <small>{{ player.id }}</small>
            <span class="badge">{{ player.position ?? t("notSeated") }}</span>
          </div>
        </div>
      </article>

      <article v-if="myPosition && room.gameState.phase !== 'waiting'" class="panel wide-panel">
        <div class="section-title">
          <h3>{{ t("handCards") }}</h3>
          <span class="badge">{{ myHand.length }}</span>
        </div>
        <div class="cards-grid hand-grid hand-board">
          <CardFace v-for="card in myHand" :key="`${card.suit}-${card.rank}`" :card="card" size="md" />
        </div>
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
