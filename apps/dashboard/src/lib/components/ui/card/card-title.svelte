<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  let {
    class: className,
    children,
    ...rest
  }: { class?: string; children?: Snippet } & HTMLAttributes<HTMLHeadingElement> = $props();
</script>

<h3 class={cn('font-semibold leading-none tracking-tight', className)} {...rest}>
  {@render children?.()}
</h3>
