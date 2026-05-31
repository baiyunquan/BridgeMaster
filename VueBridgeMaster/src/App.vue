<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { getAuthConfig, verifyApiKey } from "@/api";

const authLoading = ref(true);
const authEnabled = ref(false);
const authed = ref(false);
const apiKeyInput = ref("");
const authError = ref("");

function readApiKeyCookie(): string {
  if (typeof document === "undefined") {
    return "";
  }

  for (const chunk of document.cookie.split(";")) {
    const [name, ...rest] = chunk.trim().split("=");
    if (name !== "api_key") {
      continue;
    }
    return decodeURIComponent(rest.join("=")).trim();
  }

  return "";
}

function writeApiKeyCookie(value: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const maxAge = 60 * 60 * 24 * 30;
  document.cookie = `api_key=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function clearApiKeyCookie(): void {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = "api_key=; Path=/; Max-Age=0; SameSite=Lax";
}

async function bootstrapAuth() {
  authLoading.value = true;
  authError.value = "";

  try {
    const config = await getAuthConfig();
    authEnabled.value = Boolean(config.enabled);

    if (!authEnabled.value) {
      authed.value = true;
      return;
    }

    const cookieKey = readApiKeyCookie();
    if (!cookieKey) {
      authed.value = false;
      return;
    }

    await verifyApiKey(cookieKey);
    authed.value = true;
  } catch {
    authed.value = false;
    clearApiKeyCookie();
  } finally {
    authLoading.value = false;
  }
}

async function submitApiKey() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    authError.value = "请输入 api_key";
    return;
  }

  authError.value = "";
  try {
    await verifyApiKey(key);
    writeApiKeyCookie(key);
    authed.value = true;
  } catch (err) {
    authed.value = false;
    clearApiKeyCookie();
    authError.value = err instanceof Error ? err.message : "api_key 校验失败";
  }
}

const showRouter = computed(() => !authEnabled.value || authed.value);

onMounted(() => {
  void bootstrapAuth();
});
</script>

<template>
  <main v-if="authLoading" class="auth-shell">
    <section class="auth-card">
      <h2>正在检查访问权限</h2>
      <p>请稍候...</p>
    </section>
  </main>
  <main v-else-if="!showRouter" class="auth-shell">
    <section class="auth-card">
      <h2>请输入 API Key</h2>
      <p>当前环境已启用鉴权模式，验证通过后才可进入大厅与对局。</p>
      <input v-model="apiKeyInput" type="password" placeholder="api_key" @keyup.enter="submitApiKey" />
      <button @click="submitApiKey">验证并进入</button>
      <p v-if="authError" class="auth-error">{{ authError }}</p>
    </section>
  </main>
  <router-view v-else />
</template>

<style scoped>
.auth-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1rem;
}

.auth-card {
  width: min(480px, 100%);
  display: grid;
  gap: 0.75rem;
  padding: 1.25rem;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(148, 163, 184, 0.35);
}

.auth-card input {
  width: 100%;
}

.auth-error {
  color: #ae2836;
}
</style>
