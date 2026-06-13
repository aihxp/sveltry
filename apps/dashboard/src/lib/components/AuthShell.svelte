<script lang="ts">
  import type { Snippet } from 'svelte';
  import Logo from './Logo.svelte';
  let { title, subtitle, children }: { title: string; subtitle?: string; children: Snippet } =
    $props();
</script>

<div class="flex min-h-screen items-center justify-center bg-background px-4 py-12">
  <div class="w-full max-w-sm">
    <a href="/" class="mb-8 flex justify-center"><Logo /></a>
    <div class="rounded-xl border bg-card p-6 shadow-sm">
      <h1 class="text-xl font-semibold tracking-tight">{title}</h1>
      {#if subtitle}<p class="mt-1 text-sm text-muted-foreground">{subtitle}</p>{/if}
      <div class="mt-6">{@render children()}</div>
    </div>
  </div>
</div>
