<script lang="ts">
  import CopyIcon from '@lucide/svelte/icons/copy';
  import CheckIcon from '@lucide/svelte/icons/check';
  import { Button } from '$lib/components/ui/button';

  let { text, label = 'Copy' }: { text: string; label?: string } = $props();
  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
</script>

<Button variant="outline" size="sm" onclick={copy} aria-label={label}>
  {#if copied}<CheckIcon class="size-4 text-success" />{:else}<CopyIcon class="size-4" />{/if}
  {copied ? 'Copied' : label}
</Button>
