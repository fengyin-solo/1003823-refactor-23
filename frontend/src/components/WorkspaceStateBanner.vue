<template>
  <!-- 遗迹工作区统一边界：读取失败、缺失、空态、提示都在这里收口，三个入口共用 -->
  <div v-if="errorMessage" class="ws-boundary ws-error" role="alert">
    <span class="ws-boundary-text">{{ errorMessage }}</span>
    <span class="ws-boundary-actions">
      <button class="btn" type="button" @click="$emit('retry')">重试加载</button>
      <button class="btn ghost" type="button" @click="$emit('reset')">重置为演示数据</button>
    </span>
  </div>
  <div v-else-if="notice" class="ws-boundary ws-notice" role="status">
    <span class="ws-boundary-text">{{ notice }}</span>
    <button class="link" type="button" @click="$emit('clearNotice')">知道了</button>
  </div>
  <div v-if="isEmpty" class="ws-boundary ws-empty">
    <span class="ws-boundary-text">{{ emptyText }}</span>
    <button class="btn ghost" type="button" @click="$emit('reset')">载入演示数据</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  errorMessage: string
  notice: string
  isEmpty: boolean
  emptyText: string
}>()

defineEmits<{
  retry: []
  reset: []
  clearNotice: []
}>()
</script>
