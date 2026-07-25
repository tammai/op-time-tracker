<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@pinia/colada'
import type { TimeEntry } from '@opentracker/preload'

import { timeEntryQueries } from '@renderer/composables/queries/time-entries'
import { parseHoursToDecimal } from '@shared/utils/time'
import TimeEntryForm from './TimeEntryForm.vue'

/**
 * The day modal: log time against a day (top section) and review what's
 * already logged on it (footer).
 *
 * The entry list is its own single-day query rather than a slice of the
 * calendar's month query — the mutation invalidates the whole
 * `['time-entries']` prefix, so both refresh together after a save, and a
 * dedicated query keeps this modal correct even for a day outside the
 * currently displayed month.
 *
 * Editing and deleting entries are deliberately not here yet; the list is
 * read-only for now.
 *
 * Conventions: no direct `window.openproject.*` calls — data comes from the
 * query composable (`.opencode/rules/conventions-frontend.md`).
 */

const props = defineProps<{
  /** The day, `YYYY-MM-DD`. */
  date: string
}>()

/** Two-way `v-model:open` so the parent owns visibility. */
const open = defineModel<boolean>('open', { required: true })

const {
  data,
  error,
  isLoading,
  refresh
} = useQuery(() =>
  timeEntryQueries.list({
    onlyMine: true,
    spentOn: { on: props.date }
  })
)

const entries = computed<TimeEntry[]>(
  () => data.value?._embedded.elements ?? []
)

/** "Saturday, 25 July 2026" — UTC, matching the grid and `spentOn`. */
const dateLabel = computed(() =>
  new Date(`${props.date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  })
)

/** Decimal hours for one entry; unparseable durations count as 0. */
function entryHours(entry: TimeEntry): number {
  try {
    return parseHoursToDecimal(entry.hours)
  } catch {
    return 0
  }
}

const totalHours = computed(() =>
  entries.value.reduce((sum, e) => sum + entryHours(e), 0)
)

const totalLabel = computed(() => `${totalHours.value.toFixed(2)}h logged`)

/**
 * The comment text. OpenProject's `comment` is a Formattable object, but the
 * schema also tolerates a bare string or null — read all three shapes.
 */
function commentText(entry: TimeEntry): string {
  const c = entry.comment
  if (c === null || c === undefined) return ''
  if (typeof c === 'string') return c
  return c.raw ?? ''
}

/** Work package label from the HAL link title, with an id fallback. */
function workPackageLabel(entry: TimeEntry): string {
  return entry._links.workPackage?.title ?? 'Work package'
}

/**
 * Bridge errors cross IPC as `{ code, message }` (see
 * `src/main/ipc/openproject.ts` → `toIpcError`); read them defensively and
 * never reach into secret-bearing detail.
 */
const errorCode = computed(() => {
  const e = error.value as ({ code?: string } & Error) | null
  return e?.code ?? 'OPENPROJECT_UNKNOWN'
})

const errorMessage = computed(() => {
  const e = error.value as ({ message?: string } & Error) | null
  return (
    e?.message ??
    'An unexpected error occurred while loading this day’s entries.'
  )
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="dateLabel"
    description="Log time against this day and review what's already recorded."
    :ui="{ content: 'max-w-2xl' }"
  >
    <template #body>
      <TimeEntryForm :date="props.date" />
    </template>

    <template #footer>
      <div class="flex w-full flex-col gap-3">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-highlighted">
            Logged entries
          </h3>
          <div class="flex items-center gap-2">
            <UBadge
              v-if="entries.length > 0"
              color="neutral"
              variant="subtle"
              class="tabular-nums"
              :label="totalLabel"
            />
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-refresh-cw"
              aria-label="Refresh entries"
              :loading="isLoading"
              @click="() => refresh()"
            />
          </div>
        </div>

        <!-- Error -->
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-alert-triangle"
          title="Couldn't load this day's entries"
          :description="errorMessage"
        >
          <template #actions>
            <span class="text-muted text-xs">{{ errorCode }}</span>
          </template>
        </UAlert>

        <!-- First load -->
        <div v-else-if="isLoading && entries.length === 0" class="flex flex-col gap-2">
          <USkeleton v-for="i in 2" :key="i" class="h-12 w-full" />
        </div>

        <!-- Empty -->
        <UEmpty
          v-else-if="entries.length === 0"
          icon="i-lucide-clock"
          title="Nothing logged yet"
          description="Time you log for this day will appear here."
          variant="naked"
        />

        <!-- List (read-only for now; edit/delete come later) -->
        <ul v-else class="flex max-h-56 flex-col gap-2 overflow-y-auto">
          <li
            v-for="entry in entries"
            :key="entry.id"
            class="flex items-start justify-between gap-3 rounded-md bg-elevated/50 px-3 py-2"
          >
            <div class="flex min-w-0 flex-col gap-0.5">
              <span class="truncate text-sm font-medium text-highlighted">
                {{ workPackageLabel(entry) }}
              </span>
              <span
                v-if="commentText(entry)"
                class="truncate text-xs text-muted"
              >
                {{ commentText(entry) }}
              </span>
            </div>
            <span
              class="shrink-0 text-sm font-semibold text-primary tabular-nums"
            >
              {{ entryHours(entry).toFixed(2) }}h
            </span>
          </li>
        </ul>
      </div>
    </template>
  </UModal>
</template>
