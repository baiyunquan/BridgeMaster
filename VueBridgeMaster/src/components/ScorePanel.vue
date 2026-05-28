<script setup lang="ts">
import type { BridgeScore } from "@/types";

defineProps<{
  score: BridgeScore;
}>();
</script>

<template>
  <section class="panel score-panel">
    <div class="section-title">
      <h3>结算结果</h3>
      <span class="badge ok">{{ score.contractResult }}</span>
    </div>
    <div class="score-grid">
      <div>
        <span>NS</span>
        <strong>{{ score.nsPoints }}</strong>
      </div>
      <div>
        <span>EW</span>
        <strong>{{ score.ewPoints }}</strong>
      </div>
      <div>
        <span>赢家</span>
        <strong>{{ score.winnerSide }}</strong>
      </div>
      <div>
        <span>定约</span>
        <strong>{{ score.contractLevel ?? '-' }}{{ score.strain ?? '' }}</strong>
      </div>
      <div>
        <span>定约分</span>
        <strong>{{ score.contractPoints ?? 0 }}</strong>
      </div>
      <div>
        <span>超墩/罚分</span>
        <strong>{{ score.overtrickPoints ?? score.penaltyPoints ?? 0 }}</strong>
      </div>
    </div>
  </section>
</template>
