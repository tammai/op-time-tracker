<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useQuery } from '@pinia/colada'
// Imported explicitly rather than relying on the generated `auto-imports.d.ts`
// globals: those satisfy the type checker but not eslint's `no-undef`, and the
// generated file is gitignored, so a fresh clone would fail lint.
import { useToast } from '@nuxt/ui/composables/useToast'
import type { TimeEntry } from '@opentracker/preload'

import {
  timeEntryQueries,
  useDeleteTimeEntry
} from '@renderer/composables/queries/time-entries'
import {
  timeEntryCommentText,
  timeEntryHours,
  toTimeEntryDraft,
  type TimeEntryDraft
} from '@renderer/utils/time-entry-draft'
import TimeEntryForm from './TimeEntryForm.vue'

/**
 * The day modal: log time against a day (top section) and review, edit, or
 * delete what's already logged on it (footer).
 *
 * The entry list is its own single-day query rather than a slice of the
 * calendar's month query — every mutation invalidates the whole
 * `['time-entries']` prefix, so both refresh together after a write, and a
 * dedicated query keeps this modal correct even for a day outside the
 * currently displayed month.
 *
 * Editing reuses the same `TimeEntryForm` in the top section rather than
 * opening a second modal: it's the same fields with the same validation, and
 * a nested modal would put the entry list out of view while editing it.
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

const totalHours = computed(() =>
  entries.value.reduce((sum, e) => sum + timeEntryHours(e), 0)
)

const totalLabel = computed(() => `${totalHours.value.toFixed(2)}h logged`)

/** Work package label from the HAL link title, with an id fallback. */
function workPackageLabel(entry: TimeEntry): string {
  return entry._links.workPackage?.title ?? 'Work package'
}

const toast = useToast()

// ---------------------------------------------------------------------------
// Row state — which entry is being edited, and which is confirming a delete.
// Declared together because each action clears the other: opening an edit
// dismisses a pending confirm, and deleting the edited entry ends the edit.
// ---------------------------------------------------------------------------

/**
 * The entry currently loaded into the form, or `null` in add mode.
 *
 * A snapshot taken when the pencil is clicked, not a lookup into the live
 * list: a background refetch mid-edit would otherwise overwrite whatever the
 * user has typed. The `id` it carries is what the save is applied to, so a
 * stale snapshot updates the right entry regardless.
 */
const editingDraft = ref<TimeEntryDraft | null>(null)

/** The row showing its inline "Delete this entry?" confirm, if any. */
const confirmingDeleteId = ref<number | null>(null)

/** The row whose delete is in flight — only ever one at a time. */
const deletingId = ref<number | null>(null)

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

/**
 * Entries whose work package href or duration can't be read back into form
 * values (see `toTimeEntryDraft`) have no pencil — the form would have to
 * invent a value and the save would overwrite the entry with it. Deleting
 * them still works; that needs nothing but the id.
 */
const draftsByEntryId = computed(
  () => new Map(entries.value.map((entry) => [entry.id, toTimeEntryDraft(entry)]))
)

function startEditing(entry: TimeEntry): void {
  const draft = draftsByEntryId.value.get(entry.id)
  if (!draft) return
  confirmingDeleteId.value = null
  editingDraft.value = draft
}

function stopEditing(): void {
  editingDraft.value = null
}

/** The edited entry was gone by the time the save landed. */
function onEditTargetMissing(): void {
  stopEditing()
  toast.add({
    title: 'Entry no longer exists',
    description: 'It was removed elsewhere. The list has been refreshed.',
    icon: 'i-lucide-alert-triangle',
    color: 'warning'
  })
  void refresh()
}

// Reopening the modal — on another day, or the same one — must not resume an
// edit the user walked away from.
watch(open, (isOpen) => {
  if (!isOpen) {
    stopEditing()
    confirmingDeleteId.value = null
  }
})

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

const { mutateAsync: deleteTimeEntry } = useDeleteTimeEntry()

function askDelete(entry: TimeEntry): void {
  confirmingDeleteId.value = entry.id
}

function cancelDelete(): void {
  confirmingDeleteId.value = null
}

/**
 * Delete is irreversible and there is no server-side undo, hence the inline
 * confirm above. Failures surface as a toast rather than an inline alert: the
 * row they belong to is gone from the confirm state by then, and on a 404 the
 * row itself is about to disappear from the refreshed list.
 */
async function confirmDelete(entry: TimeEntry): Promise<void> {
  deletingId.value = entry.id
  try {
    await deleteTimeEntry({ id: entry.id })
    // Deleting the entry under edit leaves the form editing something that no
    // longer exists.
    if (editingDraft.value?.id === entry.id) stopEditing()
    confirmingDeleteId.value = null
    toast.add({
      title: 'Entry deleted',
      description: `${timeEntryHours(entry).toFixed(2)}h on ${props.date}.`,
      icon: 'i-lucide-trash-2',
      color: 'success'
    })
  } catch (e) {
    const err = e as ({ code?: string; message?: string } & Error) | null
    toast.add({
      title: 'Couldn’t delete entry',
      description:
        err?.message ?? 'An unexpected error occurred while deleting the entry.',
      icon: 'i-lucide-alert-octagon',
      color: 'error'
    })
  } finally {
    deletingId.value = null
  }
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
      <TimeEntryForm
        :date="props.date"
        :draft="editingDraft"
        @cancel-edit="stopEditing"
        @missing="onEditTargetMissing"
        @saved="stopEditing"
      />
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

        <!-- List. Each row carries edit + delete; delete confirms in place
             rather than in a nested modal, so the entry stays visible while
             the user decides. -->
        <ul v-else class="flex max-h-56 flex-col gap-2 overflow-y-auto">
          <li
            v-for="entry in entries"
            :key="entry.id"
            class="flex flex-col gap-2 rounded-md bg-elevated/50 px-3 py-2"
            :class="{ 'ring-1 ring-primary': editingDraft?.id === entry.id }"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class="truncate text-sm font-medium text-highlighted">
                  {{ workPackageLabel(entry) }}
                </span>
                <span
                  v-if="timeEntryCommentText(entry)"
                  class="truncate text-xs text-muted"
                >
                  {{ timeEntryCommentText(entry) }}
                </span>
              </div>

              <div class="flex shrink-0 items-center gap-1">
                <span class="text-sm font-semibold text-primary tabular-nums">
                  {{ timeEntryHours(entry).toFixed(2) }}h
                </span>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-pencil"
                  :aria-label="`Edit entry #${entry.id}`"
                  :disabled="
                    !draftsByEntryId.get(entry.id) || deletingId === entry.id
                  "
                  @click="startEditing(entry)"
                />
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-trash-2"
                  :aria-label="`Delete entry #${entry.id}`"
                  :disabled="deletingId === entry.id"
                  @click="askDelete(entry)"
                />
              </div>
            </div>

            <div
              v-if="confirmingDeleteId === entry.id"
              class="flex items-center justify-between gap-2 border-t border-default pt-2"
            >
              <span class="text-xs text-muted">
                Delete this entry? This can't be undone.
              </span>
              <div class="flex items-center gap-1">
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  label="Cancel"
                  :disabled="deletingId === entry.id"
                  @click="cancelDelete()"
                />
                <UButton
                  color="error"
                  variant="solid"
                  size="xs"
                  label="Delete"
                  :loading="deletingId === entry.id"
                  @click="confirmDelete(entry)"
                />
              </div>
            </div>
          </li>
        </ul>
      </div>
    </template>
  </UModal>
</template>
