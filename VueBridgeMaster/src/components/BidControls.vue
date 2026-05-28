<script setup lang="ts">
import { computed, ref } from "vue";
import type { Bid, Room, Strain } from "@/types";

const props = defineProps<{
  room: Room;
  playerId: string;
}>();

const emit = defineEmits<{
  submit: [bid: Bid];
}>();

const level = ref<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
const strain = ref<Strain>("NT");

const myPosition = computed(() => props.room.players.find((player) => player.id === props.playerId)?.position ?? null);
const isMyTurn = computed(() => props.room.gameState.turn === myPosition.value);

function sendBid(bid: Bid) {
  emit("submit", bid);
}
</script>

<template>
  <section class="panel">
    <div class="section-title">
      <h3>叫牌阶段</h3>
      <span class="badge" :class="isMyTurn ? 'ok' : ''">{{ isMyTurn ? "轮到你叫牌" : "等待其他玩家" }}</span>
    </div>
    <div class="action-grid">
      <label>
        Level
        <select v-model="level" :disabled="!isMyTurn">
          <option v-for="value in [1, 2, 3, 4, 5, 6, 7]" :key="value" :value="value">{{ value }}</option>
        </select>
      </label>
      <label>
        Strain
        <select v-model="strain" :disabled="!isMyTurn">
          <option value="C">C</option>
          <option value="D">D</option>
          <option value="H">H</option>
          <option value="S">S</option>
          <option value="NT">NT</option>
        </select>
      </label>
    </div>
    <div class="inline-actions">
      <button :disabled="!isMyTurn" @click="sendBid({ type: 'pass' })">Pass</button>
      <button :disabled="!isMyTurn" @click="sendBid({ type: 'double' })">Double</button>
      <button :disabled="!isMyTurn" @click="sendBid({ type: 'redouble' })">Redouble</button>
      <button class="accent" :disabled="!isMyTurn" @click="sendBid({ type: 'bid', level, strain })">提交定约</button>
    </div>
    <div class="history-list">
      <div v-for="entry in room.gameState.bidHistory" :key="`${entry.timestamp}-${entry.playerId}`" class="history-item">
        <span>{{ entry.position }}</span>
        <strong>
          {{
            entry.bid.type === "bid"
              ? `${entry.bid.level}${entry.bid.strain}`
              : entry.bid.type.toUpperCase()
          }}
        </strong>
      </div>
    </div>
  </section>
</template>