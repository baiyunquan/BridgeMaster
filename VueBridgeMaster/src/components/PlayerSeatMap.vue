<script setup lang="ts">
import type { Player, PlayerPosition } from "@/types";

const props = defineProps<{
  players: Player[];
  currentPlayerId: string;
  currentTurn: PlayerPosition | null;
}>();

const positions: PlayerPosition[] = ["N", "E", "S", "W"];

function playerAt(position: PlayerPosition) {
  return props.players.find((player) => player.position === position) ?? null;
}
</script>

<template>
  <section class="panel seat-panel">
    <div class="seat-grid">
      <article v-for="position in positions" :key="position" class="seat-card" :class="{ active: currentTurn === position }">
        <span class="seat-label">{{ position }}</span>
        <strong>{{ playerAt(position)?.name ?? "空位" }}</strong>
        <small v-if="playerAt(position)">{{ playerAt(position)?.id === currentPlayerId ? "你" : playerAt(position)?.id }}</small>
      </article>
    </div>
  </section>
</template>
