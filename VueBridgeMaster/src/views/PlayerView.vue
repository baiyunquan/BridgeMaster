<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getRoom, joinRoom, sitDown, submitBid, submitCard } from "@/api";
import BidControls from "@/components/BidControls.vue";
import PlayControls from "@/components/PlayControls.vue";
import PlayerSeatMap from "@/components/PlayerSeatMap.vue";
import ScorePanel from "@/components/ScorePanel.vue";
import { useRoomStream } from "@/composables/useRoomStream";
import type { Bid, Card, PlayerPosition } from "@/types";

const route = useRoute();
const router = useRouter();
const playerId = computed(() => String(route.params.playerId ?? ""));
const playerName = ref(String(route.query.name ?? "玩家"));
const inviteCode = ref(String(route.query.room ?? "").toUpperCase());
const actionError = ref("");

const { room, events, connected, error, reconnect } = useRoomStream(inviteCode);

const me = computed(() => room.value?.players.find((player) => player.id === playerId.value) ?? null);
const myPosition = computed(() => me.value?.position ?? null);
const availablePositions = computed<PlayerPosition[]>(() => {
  const occupied = new Set((room.value?.players ?? []).map((player) => player.position).filter(Boolean));
  return ["N", "E", "S", "W"].filter((position) => !occupied.has(position)) as PlayerPosition[];
});
const roomPhase = computed(() => room.value?.gameState.phase ?? "waiting");
const contractLabel = computed(() => {
  const contract = room.value?.gameState.contract;
  if (!contract) {
    return "尚未形成定约";
  }
  return `${contract.level}${contract.strain} ${contract.doubled ? 'X' : ''}${contract.redoubled ? 'XX' : ''}`;
});

async function ensureJoined() {
  if (!inviteCode.value) {
    actionError.value = "缺少邀请码";
    return;
  }

  try {
    actionError.value = "";
    await joinRoom(inviteCode.value, playerId.value, playerName.value);
    room.value = await getRoom(inviteCode.value);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : "加入房间失败";
  }
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

void ensureJoined();
</script>

<template>
  <main class="page-shell player-shell">
    <header class="hero-panel compact">
      <div>
        <p class="eyebrow">Player Page</p>
        <h1>{{ playerName }}</h1>
        <p class="hero-copy">房间 {{ inviteCode }} · {{ room?.name ?? '加载中' }}</p>
      </div>
      <div class="top-actions">
        <button @click="router.push('/')">返回大厅</button>
        <button @click="reconnect">重连实时流</button>
      </div>
    </header>

    <section class="status-strip">
      <span class="badge ok">{{ connected ? 'SSE 已连接' : 'SSE 未连接' }}</span>
      <span class="badge">阶段: {{ roomPhase }}</span>
      <span class="badge">你的座位: {{ myPosition ?? '未坐下' }}</span>
      <span class="badge">当前定约: {{ contractLabel }}</span>
    </section>

    <section class="layout-grid player-grid" v-if="room">
      <PlayerSeatMap :players="room.players" :current-player-id="playerId" :current-turn="room.gameState.turn" />

      <article class="panel">
        <div class="section-title">
          <h3>你的控制台</h3>
          <span class="badge">{{ me ? '已入房' : '未入房' }}</span>
        </div>
        <p v-if="error || actionError" class="error-text">{{ actionError || error }}</p>
        <template v-if="!myPosition">
          <p class="muted">先选择一个座位。四个方位都坐满后会自动发牌并进入叫牌。</p>
          <div class="inline-actions">
            <button v-for="position in availablePositions" :key="position" class="accent" @click="handleSit(position)">
              坐到 {{ position }}
            </button>
          </div>
        </template>
        <template v-else-if="room.gameState.phase === 'bidding'">
          <BidControls :room="room" :player-id="playerId" @submit="handleBid" />
        </template>
        <template v-else-if="room.gameState.phase === 'playing'">
          <PlayControls :room="room" :player-id="playerId" @submit="handlePlay" />
        </template>
        <template v-else-if="room.gameState.phase === 'finished' && room.gameState.score">
          <ScorePanel :score="room.gameState.score" />
        </template>
      </article>

      <article class="panel">
        <div class="section-title">
          <h3>房间事件</h3>
          <span class="badge">{{ events.length }}</span>
        </div>
        <div class="history-list tall-list">
          <div v-for="event in events" :key="event.sequence" class="history-item">
            <span>#{{ event.sequence }}</span>
            <strong>{{ event.type }}</strong>
            <small>{{ event.room.gameState.phase }}</small>
          </div>
        </div>
      </article>

      <article v-if="room.gameState.phase !== 'finished'" class="panel wide-panel">
        <div class="section-title">
          <h3>当前状态快照</h3>
          <span class="badge">turn {{ room.gameState.turn ?? '-' }}</span>
        </div>
        <pre class="json-preview">{{ JSON.stringify(room.gameState, null, 2) }}</pre>
      </article>
    </section>
  </main>
</template>
