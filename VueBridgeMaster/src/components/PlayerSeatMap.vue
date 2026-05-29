<script setup lang="ts">
import type { Player, PlayerPosition } from "@/types";
import { useLanguage } from "@/composables/useLanguage";

const props = defineProps<{
  players: Player[];
  currentPlayerId: string;
  currentTurn: PlayerPosition | null;
  selectable?: boolean;
}>();

const emit = defineEmits<{
  seatClick: [position: PlayerPosition];
}>();

const { t } = useLanguage();

const positions: PlayerPosition[] = ["N", "E", "S", "W"];

function playerAt(position: PlayerPosition) {
  return props.players.find((player) => player.position === position) ?? null;
}

function handleSeatClick(position: PlayerPosition) {
  if (!props.selectable || playerAt(position)) {
    return;
  }
  emit("seatClick", position);
}
</script>

<template>
  <section class="panel seat-panel">
    <div class="seat-grid">
      <button
        v-for="position in positions"
        :key="position"
        class="seat-card seat-button"
        :class="{ active: currentTurn === position, selectable: selectable && !playerAt(position) }"
        :disabled="!selectable || !!playerAt(position)"
        @click="handleSeatClick(position)"
      >
        <div class="seat-header">
          <span class="seat-label">{{ position }}</span>
          <small v-if="playerAt(position)" class="seat-id">{{ playerAt(position)?.id === currentPlayerId ? t("you") : playerAt(position)?.id }}</small>
        </div>
        <strong>{{ playerAt(position)?.name ?? t("notSeated") }}</strong>
      </button>
    </div>
  </section>
</template>
