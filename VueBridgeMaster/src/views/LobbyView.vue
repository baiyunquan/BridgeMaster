<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { createRoom, getLobbyRooms, joinRoom } from "@/api";
import type { RoomSummary } from "@/types";

const router = useRouter();
const rooms = ref<RoomSummary[]>([]);
const error = ref("");
const roomName = ref("晨雾桥牌桌");
const playerName = ref("玩家A");
const playerId = ref(`player-${Math.random().toString(36).slice(2, 8)}`);
const inviteCode = ref("");

const sharePreview = computed(() => {
  const room = inviteCode.value.trim().toUpperCase();
  if (!room) {
    return [];
  }

  return [1, 2, 3, 4].map((index) => ({
    label: `玩家${index}`,
    url: `${window.location.origin}/player/p${index}?name=${encodeURIComponent(`玩家${index}`)}&room=${room}`,
  }));
});

async function loadRooms() {
  rooms.value = await getLobbyRooms();
}

async function handleCreate() {
  try {
    error.value = "";
    const room = await createRoom(roomName.value, playerId.value, playerName.value);
    inviteCode.value = room.id;
    await router.push({
      name: "player",
      params: { playerId: playerId.value },
      query: { room: room.id, name: playerName.value },
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "创建房间失败";
  }
}

async function handleJoin(targetCode?: string) {
  try {
    const code = (targetCode ?? inviteCode.value).trim().toUpperCase();
    error.value = "";
    await joinRoom(code, playerId.value, playerName.value);
    await router.push({
      name: "player",
      params: { playerId: playerId.value },
      query: { room: code, name: playerName.value },
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加入房间失败";
  }
}

onMounted(() => {
  void loadRooms();
});
</script>

<template>
  <main class="page-shell">
    <section class="hero-panel">
      <p class="eyebrow">Vue BridgeMaster</p>
      <h1>四位玩家，四个独立网页，同步一局桥牌。</h1>
      <p class="hero-copy">
        每个玩家使用独立 URL 进入自己的页面。大厅页负责建房、加入和分享入口，房间页负责坐下、叫牌、出牌与结算同步。
      </p>
    </section>

    <section class="layout-grid">
      <article class="panel tall-panel">
        <div class="section-title">
          <h2>进入游戏</h2>
          <button @click="loadRooms">刷新大厅</button>
        </div>
        <label>
          你的名字
          <input v-model="playerName" />
        </label>
        <label>
          你的 ID
          <input v-model="playerId" />
        </label>
        <label>
          房间名称
          <input v-model="roomName" />
        </label>
        <button class="accent" @click="handleCreate">创建房间并进入</button>
        <label>
          邀请码
          <input v-model="inviteCode" placeholder="输入 6 位邀请码" />
        </label>
        <button @click="handleJoin()">通过邀请码加入</button>
        <p v-if="error" class="error-text">{{ error }}</p>
      </article>

      <article class="panel">
        <div class="section-title">
          <h2>大厅房间</h2>
          <span class="badge">{{ rooms.length }} rooms</span>
        </div>
        <div class="room-list">
          <button v-for="room in rooms" :key="room.id" class="room-card" @click="handleJoin(room.id)">
            <strong>{{ room.name }}</strong>
            <span>{{ room.id }}</span>
            <small>{{ room.playerCount }}/4 人</small>
          </button>
        </div>
      </article>

      <article class="panel">
        <div class="section-title">
          <h2>玩家独立页面</h2>
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
