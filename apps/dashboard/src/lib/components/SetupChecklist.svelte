<script lang="ts">
  import { useQuery, useConvexClient, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import CheckCircleIcon from '@lucide/svelte/icons/circle-check-big';
  import CircleIcon from '@lucide/svelte/icons/circle';
  import XIcon from '@lucide/svelte/icons/x';

  const auth = useAuth();
  const client = useConvexClient();
  const status = useQuery(api.organizations.onboardingStatus, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );

  const hasProject = $derived(status.data?.hasProject ?? false);
  const hasEvent = $derived(status.data?.hasEvent ?? false);
  const dismissed = $derived(status.data?.dismissed ?? false);
  const complete = $derived(hasProject && hasEvent);
  // Show only once we know the state, while onboarding is incomplete and not dismissed.
  const show = $derived(!!status.data && !dismissed && !complete);

  async function dismiss() {
    await client.mutation(api.organizations.dismissOnboarding, {});
  }
</script>

{#if show}
  <Card.Root>
    <Card.Header class="flex-row items-start justify-between space-y-0">
      <div>
        <Card.Title>Get started with Sveltry</Card.Title>
        <Card.Description>Two steps to your first tracked error.</Card.Description>
      </div>
      <Button variant="ghost" size="icon" onclick={dismiss} aria-label="Dismiss setup checklist">
        <XIcon class="size-4" />
      </Button>
    </Card.Header>
    <Card.Content class="space-y-3">
      <!-- Step 1: create a project -->
      <div class="flex items-center gap-3">
        {#if hasProject}
          <CheckCircleIcon class="text-success size-5 shrink-0" />
        {:else}
          <CircleIcon class="text-muted-foreground size-5 shrink-0" />
        {/if}
        <p
          class="flex-1 text-sm font-medium {hasProject
            ? 'text-muted-foreground line-through'
            : ''}"
        >
          Create a project
        </p>
        {#if !hasProject}
          <Button size="sm" href="/projects/new">New project</Button>
        {/if}
      </div>

      <!-- Step 2: send the first event (gated on having a project) -->
      <div class="flex items-center gap-3">
        {#if hasEvent}
          <CheckCircleIcon class="text-success size-5 shrink-0" />
        {:else}
          <CircleIcon
            class="size-5 shrink-0 {hasProject
              ? 'text-muted-foreground'
              : 'text-muted-foreground/40'}"
          />
        {/if}
        <div class="flex-1">
          <p
            class="text-sm font-medium {hasEvent
              ? 'text-muted-foreground line-through'
              : hasProject
                ? ''
                : 'text-muted-foreground/60'}"
          >
            Send your first event
          </p>
          {#if hasProject && !hasEvent}
            <p class="text-muted-foreground text-xs">
              Install a Sentry SDK and trigger an error. The project page confirms when it lands.
            </p>
          {/if}
        </div>
        {#if hasProject && !hasEvent}
          <Button size="sm" variant="outline" href="/projects">Open a project</Button>
        {/if}
      </div>
    </Card.Content>
  </Card.Root>
{/if}
