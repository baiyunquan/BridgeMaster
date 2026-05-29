<script setup lang="ts">
import { computed } from "vue";
import CardFace from "@/components/CardFace.vue";
import type { Card, Room } from "@/types";

const props = defineProps<{
  room: Room;
  playerId: string;
}>();

const emit = defineEmits<{
  submit: [card: Card];
}>();

const myPosition = computed(() => props.room.players.find((player) => player.id === props.playerId)?.position ?? null);
const isMyTurn = computed(() => props.room.gameState.turn === myPosition.value);
const myHand = computed(() => (myPosition.value ? props.room.gameState.hands[myPosition.value] : []));
const leadSuit = computed(() => props.room.gameState.currentTrick?.cards[0]?.card.suit ?? null);

function isLegal(card: Card) {
  if (!leadSuit.value) {
    return true;
  }

  const hasLeadSuit = myHand.value.some((candidate) => candidate.suit === leadSuit.value);
  if (!hasLeadSuit) {
    return true;
  }

  return card.suit === leadSuit.value;
}
</script>

<template>
  <section class="stage-block">
    <div class="section-title">
      <h3>打牌阶段</h3>
      <span class="badge" :class="isMyTurn ? 'ok' : ''">{{ isMyTurn ? '轮到你出牌' : '等待其他玩家' }}</span>
    </div>
    <div class="trick-strip">
      <div v-for="play in room.gameState.currentTrick?.cards ?? []" :key="`${play.playerId}-${play.card.suit}-${play.card.rank}`" class="trick-card image-trick-card">
        <span>{{ play.position }}</span>
        <CardFace :card="play.card" size="sm" />
      </div>
    </div>
    <div class="cards-grid hand-grid">
      <button
        v-for="card in myHand"
        :key="`${card.suit}-${card.rank}`"
        class="card-chip image-card-chip"
        :class="{ legal: isLegal(card) }"
        :disabled="!isMyTurn || !isLegal(card)"
        @click="emit('submit', card)"
      >
        <CardFace :card="card" size="md" :dimmed="!isLegal(card) || !isMyTurn" />
      </button>
    </div>
  </section>
</template>
