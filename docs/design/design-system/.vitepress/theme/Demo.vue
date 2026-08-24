<script setup lang="ts">
// Live demo island. Mounts a real React DS component (client-only) inside the
// MUI theme, and re-renders it when the docs light/dark toggle changes. The
// React tree is created in ../demos/mount.tsx (transpiled by esbuild's automatic
// JSX runtime — see config.ts `vite.esbuild`).
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import { useData } from "vitepress";

const props = defineProps<{ name: string }>();
const host = ref<HTMLElement | null>(null);
const { isDark } = useData();

let root: { unmount: () => void } | null = null;
let mod: typeof import("../demos/mount") | null = null;
let disposed = false;

onMounted(async () => {
  mod = await import("../demos/mount");
  if (disposed || !host.value) return;
  root = mod.mountDemo(host.value, props.name, isDark.value);
});

watch(isDark, (dark) => {
  if (root && mod) mod.updateDemo(root as never, props.name, dark);
});

onBeforeUnmount(() => {
  disposed = true;
  root?.unmount();
  root = null;
});
</script>

<template>
  <ClientOnly>
    <div class="tfds-demo">
      <div class="tfds-demo__label">Live demo</div>
      <div ref="host" class="tfds-demo__stage" />
    </div>
  </ClientOnly>
</template>
