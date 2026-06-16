<script lang="ts">
  import { cn, buildRepoFileUrl, type RepoConfig } from '$lib/utils';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';

  type Frame = {
    filename?: string;
    abs_path?: string;
    function?: string;
    module?: string;
    lineno?: number;
    colno?: number;
    in_app?: boolean;
    context_line?: string;
    pre_context?: string[];
    post_context?: string[];
    sveltry_resolved?: boolean;
  };
  type ExceptionValue = {
    type?: string;
    value?: string;
    stacktrace?: { frames?: Frame[] };
  };

  let {
    payload,
    repoConfig = null,
    repoRef = null,
  }: { payload: unknown; repoConfig?: RepoConfig | null; repoRef?: string | null } = $props();

  function exceptionValues(p: unknown): ExceptionValue[] {
    const ex = (p as { exception?: unknown } | null | undefined)?.exception;
    if (!ex) return [];
    if (Array.isArray(ex)) return ex as ExceptionValue[];
    return (ex as { values?: ExceptionValue[] }).values ?? [];
  }

  const values = $derived(exceptionValues(payload));

  function frameLocation(f: Frame): string {
    const where = f.filename ?? f.abs_path ?? f.module ?? '<unknown>';
    const line = f.lineno != null ? `:${f.lineno}` : '';
    const col = f.colno != null ? `:${f.colno}` : '';
    return `${where}${line}${col}`;
  }

  type SourceLine = { lineno: number | null; code: string; current: boolean };

  /** Assemble pre_context + context_line + post_context into numbered source lines. */
  function sourceContext(f: Frame): SourceLine[] {
    const pre = f.pre_context ?? [];
    const post = f.post_context ?? [];
    const base = f.lineno ?? null;
    const lines: SourceLine[] = [];
    pre.forEach((code, idx) => {
      lines.push({ lineno: base != null ? base - (pre.length - idx) : null, code, current: false });
    });
    if (f.context_line != null) {
      lines.push({ lineno: base, code: f.context_line, current: true });
    }
    post.forEach((code, idx) => {
      lines.push({ lineno: base != null ? base + idx + 1 : null, code, current: false });
    });
    return lines;
  }
</script>

{#if values.length === 0}
  <p class="text-sm text-muted-foreground">No stack trace on this event.</p>
{:else}
  <div class="space-y-6">
    {#each values as exc, i (i)}
      <div class="overflow-hidden rounded-lg border">
        <div class="border-b bg-muted/40 px-4 py-2.5">
          <span class="font-mono text-sm font-semibold text-destructive">{exc.type ?? 'Error'}</span
          >
          {#if exc.value}<span class="ml-2 font-mono text-sm text-foreground/80">{exc.value}</span
            >{/if}
        </div>
        <ol class="divide-y">
          {#each [...(exc.stacktrace?.frames ?? [])].reverse() as frame, fi (fi)}
            {@const ctx = sourceContext(frame)}
            <li class={cn('px-4 py-2', frame.in_app ? 'bg-background' : 'bg-muted/20 opacity-70')}>
              <div class="flex items-baseline justify-between gap-3">
                <span class="font-mono text-sm">
                  <span class="text-foreground">{frame.function ?? '?'}</span>
                  <span class="text-muted-foreground"> in {frameLocation(frame)}</span>
                </span>
                <div class="flex shrink-0 items-center gap-1.5">
                  {#if repoConfig && frame.in_app}
                    {@const repoUrl = buildRepoFileUrl(repoConfig, {
                      filename: frame.filename ?? frame.abs_path,
                      lineno: frame.lineno,
                      ref: repoRef ?? undefined,
                    })}
                    {#if repoUrl}
                      <a
                        href={repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open in repository"
                        aria-label="Open this frame in the source repository"
                        class="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLinkIcon class="size-3.5" />
                      </a>
                    {/if}
                  {/if}
                  {#if frame.sveltry_resolved}
                    <span
                      class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                      title="Resolved from an uploaded source map"
                    >
                      source-mapped
                    </span>
                  {/if}
                  {#if frame.in_app}
                    <span
                      class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                    >
                      in-app
                    </span>
                  {/if}
                </div>
              </div>
              {#if ctx.length > 0}
                <div
                  class="mt-1.5 overflow-hidden rounded border bg-muted/30 font-mono text-xs leading-relaxed"
                >
                  {#each ctx as ln, li (li)}
                    <div
                      class={cn(
                        'flex gap-3 px-2 py-0.5',
                        ln.current ? 'bg-destructive/10 text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      <span
                        class="w-10 shrink-0 select-none text-right tabular-nums text-muted-foreground/60"
                        >{ln.lineno ?? ''}</span
                      >
                      <span class="overflow-x-auto whitespace-pre">{ln.code}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </li>
          {/each}
        </ol>
      </div>
    {/each}
  </div>
{/if}
