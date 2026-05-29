<script setup lang="ts">
import { computed } from "vue";
import type { Card } from "@/types";

const props = withDefaults(
  defineProps<{
    card: Card;
    size?: "sm" | "md" | "lg";
    dimmed?: boolean;
  }>(),
  {
    size: "md",
    dimmed: false,
  },
);

const fileName = computed(() => `${props.card.rank}${props.card.suit}.svg`);
const src = computed(() => `/cards/vector-cards/cards-svg/${fileName.value}`);
const alt = computed(() => `${props.card.rank}${props.card.suit}`);
</script>

<template>
  <figure class="playing-card" :class="[`size-${size}`, { dimmed }]">
    <img :src="src" :alt="alt" loading="lazy" />
  </figure>
</template>