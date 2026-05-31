<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import LanguageSelector from "@/components/LanguageSelector.vue";
import { useLanguage } from "@/composables/useLanguage";
import { useRouter } from "vue-router";
import { createRoom, getLobbyRooms, joinRoom } from "@/api";
import type { RoomMode, RoomSummary } from "@/types";

const router = useRouter();
const rooms = ref<RoomSummary[]>([]);
const error = ref("");
const roomName = ref("晨雾桥牌桌");
const roomMode = ref<RoomMode>("normal");
const playerId = ref(`player-${Math.random().toString(36).slice(2, 8)}`);
const playerName = ref("");
const inviteCode = ref("");
const { t, currentLanguage } = useLanguage();

function generateFallbackName(): string {
  return `玩家${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function initPlayerName() {
  const stored = localStorage.getItem("bridge-player-name")?.trim() ?? "";
  if (stored) {
    playerName.value = stored;
    return;
  }

  const promptText = currentLanguage.value === "en" ? "Enter your display name (leave empty for auto-generated)" : "请输入你的显示名（可留空自动生成）";
  const input = window.prompt(promptText, "") ?? "";
  const resolved = input.trim() || generateFallbackName();
  playerName.value = resolved;
  localStorage.setItem("bridge-player-name", resolved);
}

function resetPlayerName() {
  const promptText = currentLanguage.value === "en" ? "Update display name" : "修改显示名";
  const input = window.prompt(promptText, playerName.value) ?? "";
  const resolved = input.trim() || generateFallbackName();
  playerName.value = resolved;
  localStorage.setItem("bridge-player-name", resolved);
}

const sharePreview = computed(() => {
  const room = inviteCode.value.trim().toUpperCase();
  if (!room) {
    return [];
  }

  return [1, 2, 3, 4].map((index) => ({
    label: `玩家${index}`,
    url: `${window.location.origin}/player/setup/p${index}?room=${room}`,
  }));
});

async function loadRooms() {
  rooms.value = await getLobbyRooms();
}

async function handleCreate() {
  try {
    error.value = "";
    const room = await createRoom(roomName.value, playerId.value, playerName.value, roomMode.value);
    inviteCode.value = room.id;
    await router.push({
      name: room.mode === "assistant" ? "assistant" : "player-setup",
      params: { playerId: playerId.value },
      query: { room: room.id },
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "创建房间失败";
  }
}

async function handleJoin(targetCode?: string) {
  try {
    const code = (targetCode ?? inviteCode.value).trim().toUpperCase();
    error.value = "";
    const room = await joinRoom(code, playerId.value, playerName.value);
    await router.push({
      name: room.mode === "assistant" ? "assistant" : "player-setup",
      params: { playerId: playerId.value },
      query: { room: code },
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加入房间失败";
  }
}

onMounted(() => {
  initPlayerName();
  void loadRooms();
});
</script>

<template>
  <main class="page-shell">
    <section class="hero-panel">
      <div>
        <p class="eyebrow">Vue BridgeMaster</p>
      </div>
      <LanguageSelector />
    </section>

    <section class="hero-panel compact">
      <h1>同步桥牌</h1>
      <p class="hero-copy">
        每个玩家使用独立 URL 进入自己的页面。大厅页负责建房、加入和分享入口，房间页负责坐下、叫牌、出牌与结算同步。
      </p>
    </section>

    <section class="layout-grid">
      <article class="panel tall-panel">
        <div class="section-title">
          <h2>{{ t("lobbyEnter") }}</h2>
          <button @click="loadRooms">{{ t("refreshLobby") }}</button>
        </div>
        <form class="control-stack" @submit.prevent="handleCreate">
          <label>
            {{ t("displayName") }}
            <div class="inline-actions">
              <input :value="playerName" readonly />
              <button type="button" @click="resetPlayerName">{{ t("editName") }}</button>
            </div>
          </label>
          <label>
            {{ t("yourId") }}
            <input v-model="playerId" />
          </label>
          <label>
            {{ t("roomName") }}
            <input v-model="roomName" />
          </label>
          <label>
            模式
            <select v-model="roomMode">
              <option value="normal">普通对局（4人）</option>
              <option value="assistant">辅助模式（单人录入+DDS）</option>
            </select>
          </label>
          <button class="accent" type="submit">{{ t("createAndEnter") }}</button>
        </form>
        <form class="control-stack" @submit.prevent="handleJoin()">
          <label>
            {{ t("inviteCode") }}
            <input v-model="inviteCode" placeholder="输入 6 位邀请码" />
          </label>
          <button type="submit">{{ t("joinByCode") }}</button>
        </form>
        <p v-if="error" class="error-text">{{ error }}</p>
      </article>

      <article class="panel">
        <div class="section-title">
          <h2>{{ t("roomList") }}</h2>
          <span class="badge">{{ rooms.length }} rooms</span>
        </div>
        <div class="room-list">
          <button v-for="room in rooms" :key="room.id" class="room-card" @click="handleJoin(room.id)">
            <strong>{{ room.name }}</strong>
            <span>{{ room.id }}</span>
            <small>{{ room.mode === 'assistant' ? '辅助模式' : `${room.playerCount}/4 人` }}</small>
          </button>
        </div>
      </article>

      <article class="panel">
        <div class="section-title">
          <h2>{{ t("playerLinks") }}</h2>
          <span class="badge ok">share</span>
        </div>
        <p class="muted">建房或知道邀请码后，可以把下列链接分发给每位玩家，每个玩家在自己的浏览器页中操作。</p>
        <div class="link-list">
          <a v-for="item in sharePreview" :key="item.label" :href="item.url" target="_blank" rel="noreferrer">
            {{ item.label }}: {{ item.url }}
          </a>
        </div>
      </article>
    </section>
  </main>
</template>
