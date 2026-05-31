<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { analyzeDdsPosition } from "@/api";
import CardFace from "@/components/CardFace.vue";
import LanguageSelector from "@/components/LanguageSelector.vue";
import { useAssistantRoom } from "@/composables/useAssistantRoom";
import { useRoomEventText } from "@/composables/useRoomEventText";
import type { Card, DdsCardProbability, PlayerPosition, Strain } from "@/types";

const POSITIONS: PlayerPosition[] = ["N", "E", "S", "W"];
const STRAINS: Strain[] = ["NT", "S", "H", "D", "C"];
const RANKS: Card["rank"][] = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
const SUITS: Card["suit"][] = ["S", "H", "D", "C"];

const {
  router,
  actionError,
  room,
  assistantState,
  events,
  connected,
  error,
  reconnect,
  updateOperator,
  updateContract,
  updateKnownHand,
  submitPlay,
  undoPlay,
  resetBoard,
  fetchDdsPayload,
  closeAssistantRoom,
} = useAssistantRoom();
const { formatRoomEvent } = useRoomEventText();

const contractStrain = ref<Strain>("NT");
const contractDeclarer = ref<PlayerPosition>("S");
const vulnerable = ref(0);
const ddsLoading = ref(false);
const ddsError = ref("");
const ddsResult = ref<Awaited<ReturnType<typeof analyzeDdsPosition>> | null>(null);
const lastDdsMarker = ref("");
const autoExitTriggered = ref(false);
let requestToken = 0;

const fullDeck = SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));

function cardKey(card: Card): string {
  return `${card.suit}-${card.rank}`;
}

function nextPosition(position: PlayerPosition): PlayerPosition {
  const index = POSITIONS.indexOf(position);
  return POSITIONS[(index + 1) % POSITIONS.length];
}

function previousPosition(position: PlayerPosition): PlayerPosition {
  const index = POSITIONS.indexOf(position);
  return POSITIONS[(index + POSITIONS.length - 1) % POSITIONS.length];
}

function partnerPosition(position: PlayerPosition): PlayerPosition {
  if (position === "N") {
    return "S";
  }
  if (position === "S") {
    return "N";
  }
  if (position === "E") {
    return "W";
  }
  return "E";
}

const recordedKeys = computed(() => {
  const state = assistantState.value;
  const keys = new Set<string>();
  if (!state) {
    return keys;
  }

  for (const position of POSITIONS) {
    for (const card of state.knownHands[position] ?? []) {
      keys.add(cardKey(card));
    }
  }
  for (const item of [...state.playedCards, ...state.currentTrick]) {
    keys.add(cardKey(item.card));
  }
  return keys;
});

const availableDeckCards = computed(() => {
  const keys = recordedKeys.value;
  return fullDeck.filter((card) => !keys.has(cardKey(card)));
});

const entryTargetLabel = computed(() => {
  const state = assistantState.value;
  if (!state) {
    return "等待房间状态";
  }

  if (state.entryTarget === "contract") {
    return "第一步：先在右侧选择坐庄（declarer）和你扮演的位置";
  }
  if (state.entryTarget === "operator_hand") {
    return `当前录入对象：你(${state.entryPosition})的手牌`;
  }
  if (state.entryTarget === "dummy_hand") {
    return `当前录入对象：明手(${state.entryPosition})的手牌`;
  }
  if (state.entryTarget === "opening_lead") {
    return `当前录入对象：首攻牌（${state.entryPosition} 出牌）`;
  }
  if (state.entryTarget === "trick_play") {
    return `当前录入对象：${state.entryPosition} 出牌`;
  }
  return "本局录入完成";
});

const entryCountLabel = computed(() => {
  const state = assistantState.value;
  if (!state) {
    return "";
  }

  if (state.entryTarget === "opening_lead") {
    const count = state.playedCards.length + state.currentTrick.length;
    return `${Math.min(count, 1)}/1`;
  }
  return `${state.entryCount}/${state.entryRequired}`;
});

const currentPlayableKnownCards = computed(() => {
  const state = assistantState.value;
  if (!state || !state.entryPosition) {
    return [] as Card[];
  }

  const known = state.knownHands[state.entryPosition] ?? [];
  const used = new Set<string>([
    ...state.playedCards.map((item) => cardKey(item.card)),
    ...state.currentTrick.map((item) => cardKey(item.card)),
  ]);
  return known.filter((card) => !used.has(cardKey(card)));
});

const ddsTurnPosition = computed<PlayerPosition | null>(() => assistantState.value?.turn ?? null);

const ddsTurnPlayableCards = computed(() => {
  const state = assistantState.value;
  const position = ddsTurnPosition.value;
  if (!state || !position) {
    return [] as Card[];
  }

  const known = state.knownHands[position] ?? [];
  const used = new Set<string>([
    ...state.playedCards.map((item) => cardKey(item.card)),
    ...state.currentTrick.map((item) => cardKey(item.card)),
  ]);
  return known.filter((card) => !used.has(cardKey(card)));
});

const ddsTurnPlayableKeys = computed(() => new Set(ddsTurnPlayableCards.value.map((card) => cardKey(card))));

const operatorMoves = computed(() => {
  const suggestions = ddsResult.value?.moveSuggestions ?? [];
  if (ddsTurnPlayableKeys.value.size === 0) {
    return suggestions.slice(0, 8);
  }
  const filtered = suggestions.filter((item) => ddsTurnPlayableKeys.value.has(cardKey(item.card)));
  return (filtered.length > 0 ? filtered : suggestions).slice(0, 8);
});

const orientedSeats = computed(() => {
  const state = assistantState.value;
  const operator = state?.operatorPosition ?? "S";
  return {
    left: nextPosition(operator),
    opposite: partnerPosition(operator),
    right: previousPosition(operator),
  };
});

function hiddenFor(position: PlayerPosition): DdsCardProbability[] {
  return ddsResult.value?.hiddenProbabilities?.[position] ?? [];
}

function remainingKnownFor(position: PlayerPosition): Card[] {
  const state = assistantState.value;
  if (!state) {
    return [];
  }

  const used = new Set<string>([
    ...state.playedCards.map((item) => cardKey(item.card)),
    ...state.currentTrick.map((item) => cardKey(item.card)),
  ]);
  return (state.knownHands[position] ?? []).filter((card) => !used.has(cardKey(card)));
}

function displayHiddenFor(position: PlayerPosition): DdsCardProbability[] {
  const hidden = hiddenFor(position);
  if (hidden.length > 0) {
    return hidden;
  }

  return remainingKnownFor(position).map((card) => ({
    card,
    probability: 1,
  }));
}

async function runDdsOnce() {
  requestToken += 1;
  const currentToken = requestToken;
  ddsLoading.value = true;
  ddsError.value = "";

  const payload = await fetchDdsPayload();
  if (currentToken !== requestToken) {
    return;
  }

  if (!payload) {
    ddsLoading.value = false;
    return;
  }

  try {
    const result = await analyzeDdsPosition(payload);
    if (currentToken === requestToken) {
      ddsResult.value = result;
    }
  } catch (err) {
    if (currentToken === requestToken) {
      ddsResult.value = null;
      ddsError.value = err instanceof Error ? err.message : "DDS 分析失败";
    }
  } finally {
    if (currentToken === requestToken) {
      ddsLoading.value = false;
    }
  }
}

watch(
  assistantState,
  (value) => {
    if (!value) {
      return;
    }

    contractStrain.value = value.contract?.strain ?? contractStrain.value;
    contractDeclarer.value = value.contract?.declarer ?? contractDeclarer.value;
    vulnerable.value = value.vulnerable;

    const marker = `${value.playedCards.length}-${value.currentTrick.length}-${value.turn}-${value.pendingDdsForOperator}`;
    if (value.pendingDdsForOperator && marker !== lastDdsMarker.value) {
      lastDdsMarker.value = marker;
      void runDdsOnce();
    }

    if (value.phase === "finished" && !autoExitTriggered.value) {
      autoExitTriggered.value = true;
      void (async () => {
        await closeAssistantRoom();
        await router.push("/");
      })();
    }
  },
  { deep: true, immediate: true },
);

async function handleSetOperator(position: PlayerPosition) {
  await updateOperator(position);
}

async function handleSetContract() {
  await updateContract(
    {
      strain: contractStrain.value,
      declarer: contractDeclarer.value,
    },
    vulnerable.value,
  );
}

async function addCardToKnown(position: PlayerPosition, card: Card) {
  const state = assistantState.value;
  if (!state) {
    return;
  }

  const known = state.knownHands[position] ?? [];
  if (known.some((item) => cardKey(item) === cardKey(card))) {
    return;
  }
  await updateKnownHand(position, [...known, card]);
}

async function handlePoolCardClick(card: Card) {
  const state = assistantState.value;
  if (!state || !state.entryPosition) {
    return;
  }

  if (state.entryTarget === "operator_hand" || state.entryTarget === "dummy_hand") {
    await addCardToKnown(state.entryPosition, card);
    return;
  }

  if (state.entryTarget === "opening_lead" || state.entryTarget === "trick_play") {
    if (currentPlayableKnownCards.value.length > 0) {
      ddsError.value = "当前对象有已录入手牌，请从“当前对象可选牌”区域点击出牌。";
      return;
    }
    await submitPlay(state.entryPosition, card);
  }
}

async function handleKnownPlay(card: Card) {
  const state = assistantState.value;
  if (!state || !state.entryPosition) {
    return;
  }
  await submitPlay(state.entryPosition, card);
}
</script>

<template>
  <main class="page-shell player-shell">
    <header class="hero-panel compact">
      <div>
        <p class="eyebrow">Assistant Mode</p>
        <h1>{{ room?.name ?? "辅助模式" }}</h1>
        <p class="hero-copy">仅打牌阶段录入：首攻开始，按你出牌前触发 DDS，出完自动结束。</p>
      </div>
      <div class="top-actions">
        <LanguageSelector />
        <button @click="router.push('/')">返回大厅</button>
        <button @click="reconnect">重连</button>
      </div>
    </header>

    <section class="status-strip" v-if="assistantState">
      <span class="badge ok">{{ connected ? 'SSE Connected' : 'SSE Disconnected' }}</span>
      <span class="badge">阶段 {{ assistantState.phase }}</span>
      <span class="badge">当前轮到 {{ assistantState.turn }}</span>
      <span class="badge">已出 {{ assistantState.playedCards.length + assistantState.currentTrick.length }}/52</span>
      <span class="badge" v-if="assistantState.contract">定约 {{ assistantState.contract.strain }} / {{ assistantState.contract.declarer }}</span>
    </section>

    <section class="layout-grid player-grid" v-if="room && assistantState">
      <article class="panel assistant-left-panel">
        <div class="section-title">
          <h3>录入控制台</h3>
          <span class="badge">{{ entryCountLabel }}</span>
        </div>
        <p class="muted">{{ entryTargetLabel }}</p>

        <div class="inline-actions">
          <button @click="undoPlay">撤销一步</button>
          <button class="danger" @click="resetBoard">重置整局</button>
        </div>

        <article class="assistant-input-block" v-if="currentPlayableKnownCards.length > 0">
          <div class="section-title">
            <h4>当前对象可选牌（已录入）</h4>
            <span class="badge">{{ currentPlayableKnownCards.length }}</span>
          </div>
          <div class="cards-grid hand-grid">
            <button
              v-for="card in currentPlayableKnownCards"
              :key="`known-play-${cardKey(card)}`"
              class="card-chip image-card-chip"
              @click="handleKnownPlay(card)"
            >
              <CardFace :card="card" size="md" />
            </button>
          </div>
        </article>

        <article class="assistant-input-block">
          <div class="section-title">
            <h4>52 张牌池（每录入一张就减少）</h4>
            <span class="badge">剩余 {{ availableDeckCards.length }}</span>
          </div>
          <div class="cards-grid hand-grid assistant-deck-grid">
            <button
              v-for="card in availableDeckCards"
              :key="`pool-${cardKey(card)}`"
              class="card-chip image-card-chip"
              @click="handlePoolCardClick(card)"
            >
              <CardFace :card="card" size="md" />
            </button>
          </div>
        </article>

        <article class="assistant-input-block">
          <div class="section-title">
            <h4>DDS 结果：当前出牌位（{{ ddsTurnPosition ?? '-' }}）的出牌概率</h4>
            <span class="badge" v-if="ddsResult">samples {{ ddsResult.sampleCount }}</span>
          </div>
          <p v-if="ddsLoading" class="muted">分析中...</p>
          <p v-else-if="ddsError" class="error-text">{{ ddsError }}</p>
          <div v-else class="dds-card-row">
            <div v-for="move in operatorMoves" :key="`move-${cardKey(move.card)}`" class="dds-card-stat">
              <CardFace :card="move.card" size="sm" />
              <strong>{{ move.averageScore.toFixed(2) }}</strong>
              <span>{{ Math.round(move.sampleCoverage * 100) }}%</span>
            </div>
          </div>
        </article>

        <article class="assistant-input-block">
          <div class="section-title">
            <h4>DDS 隐藏牌概率（左/中/右）</h4>
          </div>
          <div class="dds-oriented-grid">
            <div class="dds-oriented-col">
              <h5>左 {{ orientedSeats.left }}</h5>
              <div class="dds-card-row compact">
                <div v-for="item in displayHiddenFor(orientedSeats.left).slice(0, 8)" :key="`left-${cardKey(item.card)}`" class="dds-card-stat slim">
                  <CardFace :card="item.card" size="sm" />
                  <span>{{ Math.round(item.probability * 100) }}%</span>
                </div>
              </div>
            </div>
            <div class="dds-oriented-col">
              <h5>中 {{ orientedSeats.opposite }}</h5>
              <div class="dds-card-row compact">
                <div v-for="item in displayHiddenFor(orientedSeats.opposite).slice(0, 8)" :key="`mid-${cardKey(item.card)}`" class="dds-card-stat slim">
                  <CardFace :card="item.card" size="sm" />
                  <span>{{ Math.round(item.probability * 100) }}%</span>
                </div>
              </div>
            </div>
            <div class="dds-oriented-col">
              <h5>右 {{ orientedSeats.right }}</h5>
              <div class="dds-card-row compact">
                <div v-for="item in displayHiddenFor(orientedSeats.right).slice(0, 8)" :key="`right-${cardKey(item.card)}`" class="dds-card-stat slim">
                  <CardFace :card="item.card" size="sm" />
                  <span>{{ Math.round(item.probability * 100) }}%</span>
                </div>
              </div>
            </div>
          </div>
        </article>
      </article>

      <article class="panel assistant-right-panel">
        <div class="section-title">
          <h3>右侧上下文</h3>
        </div>
        <p class="muted">第一步：先选坐庄（declarer）和你扮演的位置。</p>

        <div class="section-title">
          <h4>我扮演的位置</h4>
        </div>
        <div class="inline-actions wrap-actions">
          <button
            v-for="position in POSITIONS"
            :key="`operator-${position}`"
            class="slim-button"
            :class="assistantState.operatorPosition === position ? 'accent' : ''"
            @click="handleSetOperator(position)"
          >
            {{ position }}
          </button>
        </div>

        <div class="section-title">
          <h4>坐庄（Declarer）</h4>
        </div>
        <div class="inline-actions wrap-actions">
          <select v-model="contractStrain">
            <option v-for="strain in STRAINS" :key="strain" :value="strain">{{ strain }}</option>
          </select>
          <select v-model="contractDeclarer">
            <option v-for="position in POSITIONS" :key="`declarer-${position}`" :value="position">{{ position }}</option>
          </select>
          <select v-model.number="vulnerable">
            <option :value="0">无局况</option>
            <option :value="1">NS 有局</option>
            <option :value="2">EW 有局</option>
            <option :value="3">双有局</option>
          </select>
        </div>
        <div class="inline-actions">
          <button class="accent" @click="handleSetContract">保存定约</button>
        </div>

        <article class="assistant-context-block" v-if="assistantState.contract">
          <p><strong>定约</strong> {{ assistantState.contract.strain }} / {{ assistantState.contract.declarer }}</p>
          <p><strong>明手</strong> {{ assistantState.dummyPosition ?? '-' }}</p>
          <p><strong>首攻</strong> {{ assistantState.openingLeader ?? '-' }}</p>
          <p><strong>我方方位</strong> 左{{ orientedSeats.left }} · 中{{ orientedSeats.opposite }} · 右{{ orientedSeats.right }}</p>
          <p><strong>DDS 触发</strong> {{ assistantState.pendingDdsForOperator ? '首攻后每出一张都会分析' : '等待完成首攻录入' }}</p>
        </article>

        <article class="panel" style="margin-top: 8px;">
          <div class="section-title">
            <h4>房间事件</h4>
            <span class="badge">{{ events.length }}</span>
          </div>
          <div class="history-list tall-list">
            <div v-for="event in events" :key="event.sequence" class="history-item">
              <span>{{ formatRoomEvent(event) }}</span>
            </div>
          </div>
        </article>
      </article>
    </section>

    <p v-if="error || actionError" class="error-text">{{ actionError || error }}</p>
  </main>
</template>

<style scoped>
.assistant-left-panel {
  grid-column: 1 / -1;
  display: grid;
  gap: 0.8rem;
  width: 100%;
  max-width: 1680px;
  margin: 0 auto;
}

.assistant-right-panel {
  grid-column: 1 / -1;
  display: grid;
  gap: 0.8rem;
  width: 100%;
  max-width: 1680px;
  margin: 0 auto;
}

.layout-grid.player-grid {
  grid-template-columns: minmax(0, 1fr);
  row-gap: 1rem;
}

.assistant-input-block {
  display: grid;
  gap: 0.7rem;
  padding: 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(15, 23, 42, 0.08);
}

.assistant-context-block {
  display: grid;
  gap: 0.35rem;
  padding: 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(15, 23, 42, 0.08);
}

.assistant-deck-grid {
  max-height: 1000px;
  overflow: auto;
  padding-right: 0.25rem;
}

.dds-oriented-grid {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  align-items: start;
}

.dds-card-row.compact {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.dds-card-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.6rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
}

.dds-card-stat {
  display: grid;
  justify-items: center;
  gap: 0.3rem;
  min-width: 4.8rem;
  padding: 0.55rem 0.4rem;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(255, 255, 255, 0.55);
}

.dds-card-stat.slim {
  min-width: 4rem;
  padding: 0.45rem 0.35rem;
}

.dds-oriented-col {
  display: grid;
  gap: 0.5rem;
}

.muted {
  color: rgba(31, 41, 55, 0.76);
}

@media (max-width: 900px) {
  .assistant-left-panel,
  .assistant-right-panel {
    grid-column: 1 / -1;
    max-width: 100%;
  }

  .dds-oriented-grid {
    grid-template-columns: 1fr;
  }
}
</style>
