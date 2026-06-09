<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { getGameRecords } from "@/api";

const router = useRouter();
const records = ref<Record<string, unknown>[]>([]);
const loading = ref(true);
const error = ref("");

type SortField = "endedAt" | "mode" | "status" | "roomName";
const sortField = ref<SortField>("endedAt");
const sortDesc = ref(true);

onMounted(async () => {
  try {
    records.value = await getGameRecords();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载记录失败";
  } finally {
    loading.value = false;
  }
});

const sorted = computed(() => {
  const list = [...records.value];
  const dir = sortDesc.value ? -1 : 1;

  list.sort((a, b) => {
    const aVal = a[sortField.value];
    const bVal = b[sortField.value];
    if (typeof aVal === "string" && typeof bVal === "string") {
      return aVal.localeCompare(bVal) * dir;
    }
    if (typeof aVal === "number" && typeof bVal === "number") {
      return (aVal - bVal) * dir;
    }
    return 0;
  });

  return list;
});

function toggleSort(field: SortField) {
  if (sortField.value === field) {
    sortDesc.value = !sortDesc.value;
  } else {
    sortField.value = field;
    sortDesc.value = true;
  }
}

function sortIcon(field: SortField): string {
  if (sortField.value !== field) return "↕";
  return sortDesc.value ? "↓" : "↑";
}

function fmtTime(ts: unknown): string {
  if (typeof ts !== "number") {
    return "-";
  }
  return new Date(ts).toLocaleString("zh-CN");
}

function shortResult(record: Record<string, unknown>): string {
  const r = record as { contractResult?: string; winnerSide?: string; assistantResult?: { completed?: boolean; strain?: string }; status?: string };
  if (r.status === "aborted") {
    return "终止";
  }
  if (r.contractResult) {
    return `${r.contractResult} ${r.winnerSide ?? ""}`;
  }
  if (r.assistantResult) {
    return r.assistantResult.completed ? "完成" : "终止";
  }
  return "完成";
}

function modeLabel(mode: unknown): string {
  if (mode === "normal") return "普通";
  if (mode === "assistant") return "辅助";
  if (mode === "exam") return "考试";
  return String(mode ?? "-");
}

function statusClass(status: unknown): string {
  return status === "completed" ? "badge ok" : "badge";
}
</script>

<template>
  <main class="page-shell">
    <header class="hero-panel compact">
      <div>
        <p class="eyebrow">Game Records</p>
        <h1>对局记录</h1>
        <p class="hero-copy">查看所有已完成的普通对局、辅助模式与考试模式记录。</p>
      </div>
      <div class="top-actions">
        <button @click="router.push('/')">← 返回大厅</button>
        <button @click="router.go(0)">刷新</button>
      </div>
    </header>

    <section class="layout-grid">
      <article class="panel" style="grid-column: 1 / -1;">
        <div class="section-title">
          <h2>记录列表</h2>
          <span class="badge">{{ records.length }} 条</span>
        </div>

        <p v-if="loading" class="muted">加载中...</p>
        <p v-else-if="error" class="error-text">{{ error }}</p>
        <p v-else-if="records.length === 0" class="muted">暂无记录。</p>

        <div v-else class="records-table-wrapper">
          <table class="records-table">
            <thead>
              <tr>
                <th @click="toggleSort('roomName')">房间名 {{ sortIcon('roomName') }}</th>
                <th @click="toggleSort('mode')">模式 {{ sortIcon('mode') }}</th>
                <th @click="toggleSort('status')">状态 {{ sortIcon('status') }}</th>
                <th>结果</th>
                <th @click="toggleSort('endedAt')">结束时间 {{ sortIcon('endedAt') }}</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(record, idx) in sorted" :key="idx">
                <td>{{ (record as Record<string, string>).roomName ?? '-' }}</td>
                <td><span class="badge">{{ modeLabel(record.mode) }}</span></td>
                <td><span :class="statusClass(record.status)">{{ record.status }}</span></td>
                <td>{{ shortResult(record) }}</td>
                <td>{{ fmtTime(record.endedAt) }}</td>
                <td class="detail-cell">
                  <details>
                    <summary>查看</summary>
                    <pre class="record-json">{{ JSON.stringify(record, null, 2) }}</pre>
                  </details>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
.records-table-wrapper {
  overflow-x: auto;
}

.records-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.records-table th,
.records-table td {
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.3);
  text-align: left;
  white-space: nowrap;
}

.records-table th {
  cursor: pointer;
  user-select: none;
  background: rgba(15, 23, 42, 0.04);
  font-weight: 600;
}

.records-table th:hover {
  background: rgba(37, 99, 235, 0.06);
}

.detail-cell details {
  cursor: pointer;
}

.record-json {
  font-size: 0.7rem;
  max-height: 300px;
  overflow: auto;
  background: rgba(15, 23, 42, 0.04);
  padding: 0.5rem;
  border-radius: 4px;
  white-space: pre;
}
</style>
