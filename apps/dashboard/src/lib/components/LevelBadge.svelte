<script lang="ts">
  import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
  let { level }: { level: string } = $props();
  const variant = $derived<BadgeVariant>(
    level === 'fatal' || level === 'error'
      ? 'destructive'
      : level === 'warning'
        ? 'warning'
        : level === 'info'
          ? 'default'
          : 'muted',
  );
</script>

<Badge {variant} class="font-mono text-[10px] uppercase tracking-wide">{level}</Badge>
