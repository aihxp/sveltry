<script lang="ts">
  import { cn } from '$lib/utils';
  let { class: className, showWordmark = true }: { class?: string; showWordmark?: boolean } =
    $props();
</script>

<span class={cn('inline-flex items-center gap-2', className)}>
  <svg viewBox="0 0 32 32" class="size-6 shrink-0" aria-hidden="true">
    <path
      d="M16 4 L28 10.5 V21.5 L16 28 L4 21.5 V10.5 Z"
      fill="none"
      stroke="var(--color-primary)"
      stroke-width="2"
      stroke-linejoin="round"
    />
    <path d="M16 10 v7" stroke="var(--color-primary)" stroke-width="2.6" stroke-linecap="round" />
    <circle cx="16" cy="21.5" r="1.6" fill="var(--color-primary)" />
  </svg>
  {#if showWordmark}
    <span class="text-lg font-semibold tracking-tight">Sveltry</span>
  {/if}
</span>
