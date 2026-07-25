<script setup lang="ts">
import { computed } from 'vue'

import { useMonthTimeEntries } from '@renderer/composables/queries/time-entries'
import {
  formatYmd,
  getCalendarGridDays,
  type CalendarCell
} from '@renderer/utils/calendar-dates'
import { useUiStore } from '@renderer/stores/useUiStore'

/**
 * The month grid — the app's only screen.
 *
 * A Sunday-first 6×7 grid that fills all available space (like the macOS
 * Calendar app): the weekday row is fixed height and the grid takes the rest,
 * so cells grow with the window instead of scrolling. Each in-month cell
 * shows that day's total hours and entry count, and clicking one opens the
 * day modal to log time.
 *
 * The month title, month total, and prev/today/next controls are **not**
 * here — they live in the shell's single header row (`App.vue`). Both read
 * the same `useMonthTimeEntries()` instance, so the header and the grid can't
 * disagree about which month is displayed.
 *
 * Conventions (`.opencode/rules/conventions-frontend.md`):
 * - No direct `window.openproject.*` calls — data comes from the query
 *   composable, so the Colada cache stays wired.
 * - Grid maths and aggregation live in pure, unit-tested helpers
 *   (`calendar-dates.ts`, `calendar-aggregation.ts`), not in this component.
 */

const ui = useUiStore()

const {
  year,
  month,
  aggregate,
  isInitialLoading,
  error,
  isLoading,
  refresh
} = useMonthTimeEntries()

/** `YYYY-MM-DD` for today — used to mark the current day in the grid. */
const todayYmd = formatYmd(new Date())

/** The 42-cell calendar grid (Sun-first, 6 rows × 7 cols). */
const grid = computed<CalendarCell[]>(() =>
  getCalendarGridDays(year.value, month.value)
)

/** Weekday header labels, Sunday-first (matches the grid). */
const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Formatted hours (1 decimal, e.g. `1.5h`). */
function formatHours(h: number): string {
  return `${h.toFixed(1)}h`
}

/**
 * Bridge errors cross IPC as `{ code, message }` (see
 * `src/main/ipc/openproject.ts` → `toIpcError`); read them defensively and
 * never reach into secret-bearing detail.
 */
const bridgeError = computed<{ code: string; message: string } | null>(() => {
  const e = error.value as ({ code?: string; message?: string } & Error) | null
  if (!e) return null
  return {
    code: e.code ?? 'OPENPROJECT_UNKNOWN',
    message:
      e.message ?? 'An unexpected error occurred while contacting OpenProject.'
  }
})

/**
 * Open the day modal. Only in-month cells are actionable — logging against a
 * leading/trailing cell would silently write to the adjacent month the grid
 * isn't showing totals for.
 */
function onCellClick(cell: CalendarCell): void {
  if (!cell.inMonth) return
  ui.openDay(cell.ymd)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Error state replaces the grid entirely — there's nothing to show. -->
    <div v-if="bridgeError" class="flex flex-1 items-center justify-center p-6">
      <UAlert
        color="error"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        title="Couldn't load time entries"
        :description="bridgeError.message"
        class="max-w-lg"
      >
        <template #actions>
          <div class="flex items-center gap-2">
            <UButton
              color="error"
              variant="outline"
              size="sm"
              icon="i-lucide-refresh-cw"
              label="Retry"
              :loading="isLoading"
              @click="() => refresh()"
            />
            <span class="text-muted text-xs">{{ bridgeError.code }}</span>
          </div>
        </template>
      </UAlert>
    </div>

    <template v-else>
      <!-- Weekday header -->
      <div class="grid shrink-0 grid-cols-7 border-b border-default">
        <div
          v-for="label in weekdayLabels"
          :key="label"
          class="text-muted py-2 text-center text-xs font-medium uppercase tracking-wide"
        >
          {{ label }}
        </div>
      </div>

      <!-- 6×7 grid, filling the remaining height -->
      <div class="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        <button
          v-for="cell in grid"
          :key="cell.ymd"
          type="button"
          :disabled="!cell.inMonth"
          :aria-label="`Log time on ${cell.ymd}`"
          class="flex min-w-0 flex-col items-start gap-1 border-b border-r border-default p-2 text-left transition-colors"
          :class="[
            cell.inMonth
              ? 'bg-default hover:bg-elevated cursor-pointer'
              : 'bg-muted/30 cursor-default',
            cell.ymd === todayYmd ? 'ring-1 ring-inset ring-primary' : ''
          ]"
          @click="() => onCellClick(cell)"
        >
          <span
            class="text-sm tabular-nums"
            :class="[
              cell.inMonth ? 'text-default' : 'text-dimmed',
              cell.ymd === todayYmd ? 'font-bold text-primary' : ''
            ]"
          >
            {{ cell.dayNumber }}
          </span>

          <!-- Initial load: placeholder so the layout doesn't jump. -->
          <USkeleton v-if="isInitialLoading && cell.inMonth" class="h-4 w-10" />

          <!-- Logged totals for the day. -->
          <template v-else-if="cell.inMonth">
            <template v-if="aggregate.days.get(cell.ymd)">
              <span class="text-sm font-semibold text-primary tabular-nums">
                {{ formatHours(aggregate.days.get(cell.ymd)?.hours ?? 0) }}
              </span>
              <span class="text-muted text-[11px]">
                {{ aggregate.days.get(cell.ymd)?.entryCount }}
                {{
                  aggregate.days.get(cell.ymd)?.entryCount === 1
                    ? 'entry'
                    : 'entries'
                }}
              </span>
            </template>
            <span v-else class="text-dimmed text-xs tabular-nums">0h</span>
          </template>
        </button>
      </div>
    </template>
  </div>
</template>
