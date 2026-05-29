<script setup lang="ts">
import { useLanguage } from "@/composables/useLanguage";

const { currentLanguage, setLanguage, t } = useLanguage();
</script>

<template>
  <label class="lang-picker">
    {{ t("language") }}
    <select :value="currentLanguage" @change="setLanguage(($event.target as HTMLSelectElement).value as 'zh' | 'en')">
      <option value="zh">{{ t("chinese") }}</option>
      <option value="en">{{ t("english") }}</option>
    </select>
  </label>
</template>
