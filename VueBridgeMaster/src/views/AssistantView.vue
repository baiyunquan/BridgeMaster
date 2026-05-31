<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { analyzeDdsPosition } from "@/api";
import CardFace from "@/components/CardFace.vue";
import LanguageSelector from "@/components/LanguageSelector.vue";
import { useAssistantRoom } from "@/composables/useAssistantRoom";
import { useRoomEventText } from "@/composables/useRoomEventText";
import type { Card, PlayerPosition, Strain } from "@/types";

const POSITIONS: PlayerPosition[] = ["N", "E", "S", "W"];
const STRAINS: Strain[] = ["NT", "S", "H", "D", "C"];

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
} = useAssistantRoom();
const { formatRoomEvent } = useRoomEventText();

const contractStrain = ref<Strain>("NT");
const contractDeclarer = ref<PlayerPosition>("S");
const vulnerable = ref(0);
const handInput = ref<Record<PlayerPosition, string>>({ N: "", E: "", S: "", W: "" });

const playPosition = ref<PlayerPosition>("N");
const playCard = ref("");

const ddsLoading = ref(false);
const ddsError = ref("");
const ddsResult = ref<Awaited<ReturnType<typeof analyzeDdsPosition>> | null>(null);
let requestToken = 0;

function cardKey(card: Card): string {
  return `${card.suit}-${card.rank}`;
}

function parseCardToken(token: string): Card | null {
  const normalized = token.trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  const match = /^([CDHS])(10|[2-9JQKA])$/.exec(normalized);
  if (!match) {
    throw new Error(`非法牌面: ${token}`);
  }

  return {
    suit: match[1] as Card["suit"],
    rank: match[2] as Card["rank"],
  };
}

function parseCardsText(input: string): Card[] {
  const tokens = input
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const result: Card[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const card = parseCardToken(token);
    if (!card) {
      continue;
    }
    const key = cardKey(card);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(card);
  }

  return result;
}

function normalizeCardsText(cards: Card[] | undefined): string {
  return (cards ?? []).map((card) => `${card.suit}${card.rank}`).join(" ");
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
    for (const position of POSITIONS) {
      handInput.value[position] = normalizeCardsText(value.knownHands[position]);
    }
  },
  { immediate: true },
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

async function handleSaveHand(position: PlayerPosition) {
  let cards: Card[];
  try {
    cards = parseCardsText(handInput.value[position]);
  } catch (err) {
    ddsError.value = err instanceof Error ? err.message : "手牌格式错误";
    return;
  }

  await updateKnownHand(position, cards);
}

const availablePlayCards = computed(() => {
  const state = assistantState.value;
  if (!state) {
    return [] as Card[];
  }

  const known = state.knownHands[playPosition.value] ?? [];
  const used = new Set<string>([
    ...state.playedCards.map((item) => cardKey(item.card)),
    ...state.currentTrick.map((item) => cardKey(item.card)),
  ]);

  return known.filter((card) => !used.has(cardKey(card)));
});

watch(availablePlayCards, (cards) => {
  const exists = cards.some((card) => `${card.suit}${card.rank}` === playCard.value);
  if (!exists) {
    playCard.value = cards.length > 0 ? `${cards[0].suit}${cards[0].rank}` : "";
  }
}, { immediate: true });

async function handleSubmitPlay() {
  if (!playCard.value) {
    return;
  }

  const card = parseCardToken(playCard.value);
  if (!card) {
    return;
  }

  await submitPlay(playPosition.value, card);
}

watch(
  assistantState,
  async (value) => {
    requestToken += 1;
    const currentToken = requestToken;

    if (!value || !value.contract) {
      ddsResult.value = null;
      ddsError.value = "";
      return;
    }

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
  },
  { deep: true, immediate: true },
);
</script>

<template>
  <main class="page-shell player-shell">
    <header class="hero-panel compact">
      <div>
        <p class="eyebrow">Assistant Mode</p>
        <h1>{{ room?.name ?? "辅助模式" }}</h1>
        <p class="hero-copy">单人录入真实牌局并持续触发 DDS 分析</p>
      </div>
      <div class="top-actions">
        <LanguageSelector />
        <button @click="router.push('/')">返回大厅</button>
        <button @click="reconnect">重连</button>
      </div>
    </header>

    <section class="status-strip">
      <span class="badge ok">{{ connected ? 'SSE Connected' : 'SSE Disconnected' }}</span>
      <span class="badge">辅助模式</span>
      <span class="badge" v-if="assistantState">轮到 {{ assistantState.turn }}</span>
      <span class="badge" v-if="assistantState?.contract">定约 {{ assistantState.contract.strain }} / {{ assistantState.contract.declarer }}</span>
    </section>

    <section class="layout-grid player-grid" v-if="room && assistantState">
      <article class="panel wide-panel control-panel">
        <div class="section-title">
          <h3>操作席位</h3>
        </div>
        <div class="inline-actions">
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
          <h3>定约输入</h3>
        </div>
        <div class="inline-actions">
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
          <button class="accent" @click="handleSetContract">保存定约</button>
        </div>

        <div class="section-title">
          <h3>手牌录入</h3>
        </div>
        <p class="muted">输入格式示例: SA SK H10 D3 C2（空格分隔）</p>
        <div class="assistant-hand-grid">
          <div v-for="position in POSITIONS" :key="`hand-${position}`" class="assistant-hand-card">
            <h4>{{ position }}</h4>
            <textarea v-model="handInput[position]" rows="4" />
            <button @click="handleSaveHand(position)">保存 {{ position }}</button>
          </div>
        </div>
      </article>

      <article class="panel control-panel">
        <div class="section-title">
          <h3>打牌录入</h3>
        </div>
        <div class="inline-actions">
          <select v-model="playPosition">
            <option v-for="position in POSITIONS" :key="`play-${position}`" :value="position">{{ position }}</option>
          </select>
          <select v-model="playCard">
            <option v-for="card in availablePlayCards" :key="cardKey(card)" :value="`${card.suit}${card.rank}`">
              {{ card.suit }}{{ card.rank }}
            </option>
          </select>
          <button class="accent" :disabled="!playCard" @click="handleSubmitPlay">提交出牌</button>
        </div>
        <div class="inline-actions">
          <button @click="undoPlay">撤销一步</button>
          <button class="danger" @click="resetBoard">重置整局</button>
        </div>

        <div class="section-title">
          <h3>当前墩</h3>
        </div>
        <div class="dds-card-row">
          <div v-for="item in assistantState.currentTrick" :key="`${item.position}-${cardKey(item.card)}`" class="dds-card-stat">
            <span>{{ item.position }}</span>
            <CardFace :card="item.card" size="sm" />
          </div>
        </div>
      </article>

      <article class="panel control-panel">
        <div class="section-title">
          <h3>DDS 分析</h3>
          <span class="badge" v-if="ddsResult">samples {{ ddsResult.sampleCount }}</span>
        </div>
        <p v-if="ddsLoading" class="muted">分析中...</p>
        <p v-else-if="ddsError" class="error-text">{{ ddsError }}</p>
        <template v-else-if="ddsResult">
          <div class="dds-card-row">
            <div v-for="move in ddsResult.moveSuggestions.slice(0, 8)" :key="cardKey(move.card)" class="dds-card-stat">
              <CardFace :card="move.card" size="sm" />
              <strong>{{ move.averageScore.toFixed(2) }}</strong>
              <span>{{ Math.round(move.sampleCoverage * 100) }}%</span>
            </div>
          </div>
        </template>
      </article>

      <article class="panel">
        <div class="section-title">
          <h3>房间事件</h3>
          <span class="badge">{{ events.length }}</span>
        </div>
        <div class="history-list tall-list">
          <div v-for="event in events" :key="event.sequence" class="history-item">
            <span>{{ formatRoomEvent(event) }}</span>
          </div>
        </div>
      </article>
    </section>

    <p v-if="error || actionError" class="error-text">{{ actionError || error }}</p>
  </main>
</template>

<style scoped>
.assistant-hand-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.75rem;
}

.assistant-hand-card {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem;
  border-radius: 0.9rem;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.22);
}

.assistant-hand-card textarea {
  width: 100%;
  min-height: 86px;
  border-radius: 0.6rem;
  background: rgba(2, 6, 23, 0.85);
  color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.3);
  padding: 0.5rem;
}

.muted {
  color: rgba(226, 232, 240, 0.75);
}
</style>
