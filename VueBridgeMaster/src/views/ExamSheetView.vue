<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getExamSheet } from "@/api";

const route = useRoute();
const router = useRouter();
const examName = String(route.params.examName ?? "");

const loading = ref(true);
const error = ref("");
const data = ref<{
  examName: string;
  totalBoards: number;
  completedCount: number;
  boards: { boardNo: number; vulnerability: string; completed: boolean; contractStr: string; resultText: string; nsPoints: number; ewPoints: number }[];
} | null>(null);

onMounted(async () => {
  try {
    data.value = await getExamSheet(examName);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载失败";
  } finally {
    loading.value = false;
  }
});

const totalNS = computed(() => data.value?.boards.reduce((s, b) => s + (b.nsPoints > 0 ? b.nsPoints : 0), 0) ?? 0);
const totalEW = computed(() => data.value?.boards.reduce((s, b) => s + (b.ewPoints > 0 ? b.ewPoints : 0), 0) ?? 0);
</script>

<template>
  <main class="page-shell">
    <header class="hero-panel compact">
      <div>
        <p class="eyebrow">Exam Score Sheet</p>
        <h1>双人赛桥牌期末考试记分表</h1>
        <p class="hero-copy" v-if="data">考试：{{ data.examName }} · {{ data.completedCount }}/{{ data.totalBoards }} 局完成</p>
      </div>
      <div class="top-actions">
        <button @click="router.push('/')">← 返回大厅</button>
      </div>
    </header>

    <section class="layout-grid">
      <article class="panel" style="grid-column: 1 / -1;">
        <p v-if="loading" class="muted">加载中...</p>
        <p v-else-if="error" class="error-text">{{ error }}</p>
        <p v-else-if="!data || data.boards.length === 0" class="muted">暂无考试数据。</p>

        <div v-else class="datasheet-wrapper">
          <table class="datasheet-table">
            <thead>
              <tr>
                <th>轮次</th>
                <th>局况</th>
                <th>定约</th>
                <th>结果</th>
                <th>南北得分</th>
                <th>东西得分</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="board in data.boards"
                :key="board.boardNo"
                :class="{ 'row-done': board.completed }"
              >
                <td>{{ board.boardNo }}</td>
                <td>{{ board.vulnerability }}</td>
                <td>{{ board.contractStr }}</td>
                <td>{{ board.resultText }}</td>
                <td :class="board.nsPoints > 0 ? 'score-pos' : board.nsPoints < 0 ? 'score-neg' : ''">
                  {{ board.nsPoints || '' }}
                </td>
                <td :class="board.ewPoints > 0 ? 'score-pos' : board.ewPoints < 0 ? 'score-neg' : ''">
                  {{ board.ewPoints || '' }}
                </td>
                <td></td>
              </tr>
              <tr class="row-total">
                <td colspan="2"><strong>合计</strong></td>
                <td></td>
                <td></td>
                <td><strong>{{ totalNS || '' }}</strong></td>
                <td><strong>{{ totalEW || '' }}</strong></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
.datasheet-wrapper {
  overflow-x: auto;
}

.datasheet-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.datasheet-table th,
.datasheet-table td {
  padding: 0.45rem 0.65rem;
  border: 1px solid rgba(148, 163, 184, 0.3);
  text-align: center;
}

.datasheet-table thead th {
  background: rgba(15, 23, 42, 0.06);
  font-weight: 600;
}

.datasheet-table .row-done {
  background: rgba(34, 197, 94, 0.06);
}

.datasheet-table .row-total {
  border-top: 2px solid rgba(15, 23, 42, 0.15);
}

.score-pos { color: #16a34a; font-weight: 600; }
.score-neg { color: #dc2626; font-weight: 600; }
</style>
