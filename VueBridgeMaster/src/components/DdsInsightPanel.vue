<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { analyzeDdsPosition } from "@/api";
import CardFace from "@/components/CardFace.vue";
import { useLanguage } from "@/composables/useLanguage";
import type { DdsAnalysisRequest, DdsAnalysisResult, DdsCardProbability, PlayerPosition, Room } from "@/types";

const props = defineProps<{
  room: Room;
  playerPosition: PlayerPosition | null;
}>();

const { t } = useLanguage();
const analysis = ref<DdsAnalysisResult | null>(null);
const loading = ref(false);
const error = ref("");
let requestToken = 0;

const payload = computed<DdsAnalysisRequest | null>(() => {
  const { gameState } = props.room;
  if (!props.playerPosition || !gameState.contract || !gameState.turn) {
    return null;
  }

  const knownHands: DdsAnalysisRequest["knownHands"] = {
    [props.playerPosition]: [...gameState.hands[props.playerPosition]],
  };

  if (gameState.isDummyRevealed && gameState.dummyPosition) {
    knownHands[gameState.dummyPosition] = [...gameState.hands[gameState.dummyPosition]];
  }

  return {
    knownHands,
    handSizes: {
      N: gameState.hands.N.length,
      E: gameState.hands.E.length,
      S: gameState.hands.S.length,
      W: gameState.hands.W.length,
    },
    playedCards: gameState.tricks.flatMap((trick) => trick.cards.map((play) => ({ position: play.position, card: play.card }))),
    currentTrick: gameState.currentTrick?.cards.map((play) => ({ position: play.position, card: play.card })) ?? [],
    turn: gameState.turn,
    contract: {
      strain: gameState.contract.strain,
      declarer: gameState.contract.declarer,
    },
    maxSamples: 48,
    vulnerable: 0,
  };
});

watch(
  payload,
  async (value) => {
    requestToken += 1;
    const currentToken = requestToken;

    if (!value) {
      analysis.value = null;
      error.value = "";
      return;
    }

    loading.value = true;
    error.value = "";
    try {
      const response = await analyzeDdsPosition(value);
      if (currentToken === requestToken) {
        analysis.value = response;
      }
    } catch (err) {
      if (currentToken === requestToken) {
        analysis.value = null;
        error.value = err instanceof Error ? err.message : t("ddsAnalysisFailed");
      }
    } finally {
      if (currentToken === requestToken) {
        loading.value = false;
      }
    }
  },
  { deep: true, immediate: true },
);

const hiddenPredictions = computed(() => {
  const data = analysis.value?.hiddenProbabilities ?? {};
  return (Object.entries(data) as Array<[PlayerPosition, DdsCardProbability[]]>).map(([position, cards]) => ({
    position,
    cards: cards.slice(0, 12),
  }));
});
</script>

<template>
  <section class="dds-shell">
    <div class="dds-summary">
      <span class="badge accent">DDS</span>
      <span class="badge">{{ t("ddsSamples") }}: {{ analysis?.sampleCount ?? 0 }}</span>
      <span class="badge" v-if="analysis?.contractOutlook">{{ t("ddsExpectedTricks") }}: {{ analysis.contractOutlook.expectedDeclarerTricks }}</span>
    </div>

    <p v-if="loading" class="muted-line">{{ t("ddsLoading") }}</p>
    <p v-else-if="error" class="error-text">{{ error }}</p>

    <template v-else-if="analysis">
      <article class="dds-panel-block" v-if="analysis.moveSuggestions.length">
        <div class="section-title">
          <h3>{{ t("ddsMoveSuggestions") }}</h3>
          <span class="badge">{{ analysis.moveSuggestions.length }}</span>
        </div>
        <div class="dds-card-row">
          <div v-for="suggestion in analysis.moveSuggestions.slice(0, 8)" :key="`${suggestion.card.suit}-${suggestion.card.rank}`" class="dds-card-stat">
            <CardFace :card="suggestion.card" size="sm" />
            <strong>{{ suggestion.averageScore.toFixed(2) }}</strong>
            <span>{{ t("ddsCoverage") }} {{ Math.round(suggestion.sampleCoverage * 100) }}%</span>
          </div>
        </div>
      </article>

      <article class="dds-panel-block" v-if="analysis.contractOutlook">
        <div class="section-title">
          <h3>{{ t("ddsContractOutlook") }}</h3>
          <span class="badge">{{ analysis.contractOutlook.expectedDeclarerTricks }}</span>
        </div>
        <p class="muted-line" v-if="analysis.contractOutlook.mostLikelyPar">
          {{ analysis.contractOutlook.mostLikelyPar.parScore.filter(Boolean).join(" / ") || t("ddsNoPar") }}
        </p>
      </article>

      <article class="dds-panel-block" v-if="hiddenPredictions.length">
        <div class="section-title">
          <h3>{{ t("ddsHiddenPredictions") }}</h3>
          <span class="badge">{{ hiddenPredictions.length }}</span>
        </div>
        <div class="dds-prediction-grid">
          <div v-for="group in hiddenPredictions" :key="group.position" class="dds-prediction-column">
            <h4>{{ t("ddsSeatPrediction") }} {{ group.position }}</h4>
            <div class="dds-card-row compact">
              <div v-for="prediction in group.cards" :key="`${group.position}-${prediction.card.suit}-${prediction.card.rank}`" class="dds-card-stat slim">
                <CardFace :card="prediction.card" size="sm" />
                <span>{{ Math.round(prediction.probability * 100) }}%</span>
              </div>
            </div>
          </div>
        </div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.dds-shell {
  display: grid;
  gap: 1rem;
}

.dds-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.dds-panel-block {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: 1rem;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.22);
}

.dds-card-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.dds-card-row.compact {
  gap: 0.5rem;
}

.dds-card-stat {
  display: grid;
  justify-items: center;
  gap: 0.35rem;
  min-width: 4.75rem;
  padding: 0.65rem 0.5rem;
  border-radius: 0.9rem;
  background: rgba(30, 41, 59, 0.7);
}

.dds-card-stat.slim {
  min-width: 4rem;
  padding: 0.5rem 0.35rem;
}

.dds-prediction-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
}

.dds-prediction-column {
  display: grid;
  gap: 0.75rem;
}

.muted-line {
  color: rgba(226, 232, 240, 0.78);
}
</style>