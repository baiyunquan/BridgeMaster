<script setup lang="ts">
import { computed } from "vue";
import { useLanguage } from "@/composables/useLanguage";
import type { Bid, Room, Strain } from "@/types";

const props = defineProps<{
  room: Room;
  playerId: string;
}>();

const emit = defineEmits<{
  submit: [bid: Bid];
}>();

const bidRows: Array<1 | 2 | 3 | 4 | 5 | 6 | 7> = [1, 2, 3, 4, 5, 6, 7];
const bidColumns: Strain[] = ["NT", "S", "H", "D", "C"];
const strainRank: Record<Strain, number> = { C: 0, D: 1, H: 2, S: 3, NT: 4 };

const myPosition = computed(() => props.room.players.find((player) => player.id === props.playerId)?.position ?? null);
const isMyTurn = computed(() => props.room.gameState.turn === myPosition.value);
const { t } = useLanguage();

const lastCall = computed(() => {
  for (let i = props.room.gameState.bidHistory.length - 1; i >= 0; i -= 1) {
    const entry = props.room.gameState.bidHistory[i];
    if (entry.bid.type !== "pass") {
      return entry.bid;
    }
  }
  return null;
});

const actionBidType = computed<"double" | "redouble">(() => {
  return lastCall.value?.type === "double" ? "redouble" : "double";
});

function strainToneClass(strain: Strain): string {
  if (strain === "H" || strain === "D") {
    return "bid-strain-red";
  }

  return "bid-strain-black";
}

const highestBidRank = computed(() => {
  let best = -1;
  for (const entry of props.room.gameState.bidHistory) {
    if (entry.bid.type !== "bid" || !entry.bid.level || !entry.bid.strain) {
      continue;
    }
    const rank = entry.bid.level * 10 + strainRank[entry.bid.strain];
    if (rank > best) {
      best = rank;
    }
  }
  return best;
});

function canBid(level: 1 | 2 | 3 | 4 | 5 | 6 | 7, strain: Strain): boolean {
  const rank = level * 10 + strainRank[strain];
  return rank > highestBidRank.value;
}

function sendBid(bid: Bid) {
  emit("submit", bid);
}
</script>

<template>
  <section class="stage-block">
    <div class="section-title">
      <h3>{{ t("bidStage") }}</h3>
      <span class="badge" :class="isMyTurn ? 'ok' : ''">{{ isMyTurn ? t("yourTurnBid") : t("waitingOthers") }}</span>
    </div>
    <div class="bid-grid-table">
      <div class="bid-grid-row bid-grid-head">
        <span class="grid-corner">#</span>
        <span v-for="strain in bidColumns" :key="strain" class="grid-head">{{ strain }}</span>
      </div>
      <div v-for="level in bidRows" :key="level" class="bid-grid-row">
        <span class="grid-level">{{ level }}</span>
        <button
          v-for="strain in bidColumns"
          :key="`${level}-${strain}`"
          class="bid-cell"
          :disabled="!isMyTurn || !canBid(level, strain)"
          @click="sendBid({ type: 'bid', level, strain })"
        >
          <span class="bid-call">
            <span class="bid-level">{{ level }}</span>
            <span class="bid-strain" :class="strainToneClass(strain)">{{ strain }}</span>
          </span>
        </button>
      </div>
    </div>
    <div class="inline-actions">
      <button :disabled="!isMyTurn" @click="sendBid({ type: 'pass' })">{{ t("pass") }}</button>
      <button class="accent" :disabled="!isMyTurn" @click="sendBid({ type: actionBidType })">
        {{ actionBidType === "double" ? t("double") : t("redouble") }}
      </button>
    </div>
    <div class="history-list">
      <div v-for="entry in room.gameState.bidHistory" :key="`${entry.timestamp}-${entry.playerId}`" class="history-item">
        <span>{{ entry.position }}</span>
        <strong v-if="entry.bid.type === 'bid'" class="history-call bid-call">
          <span class="bid-level">{{ entry.bid.level }}</span>
          <span class="bid-strain" :class="strainToneClass(entry.bid.strain!)">{{ entry.bid.strain }}</span>
        </strong>
        <strong v-else class="history-call">
          {{ entry.bid.type === "pass" ? t("pass") : entry.bid.type === "double" ? t("double") : t("redouble") }}
        </strong>
      </div>
    </div>
  </section>
</template>