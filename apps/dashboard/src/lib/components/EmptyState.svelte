<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    title,
    description,
    children,
  }: { title: string; description?: string; children?: Snippet } = $props();
</script>

<div
  class="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center"
>
  <svg viewBox="0 0 32 32" class="mb-4 size-10 opacity-40" aria-hidden="true">
    <path
      d="M16 4 L28 10.5 V21.5 L16 28 L4 21.5 V10.5 Z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
    />
  </svg>
  <h3 class="text-base font-semibold">{title}</h3>
  {#if description}<p class="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>{/if}
  {#if children}<div class="mt-5">{@render children()}</div>{/if}
</div>
