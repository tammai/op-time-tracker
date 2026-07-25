<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useQuery } from '@pinia/colada'
// Imported explicitly rather than relying on the generated `auto-imports.d.ts`
// globals: those satisfy the type checker but not eslint's `no-undef`, and the
// generated file is gitignored, so a fresh clone would fail lint.
import { useToast } from '@nuxt/ui/composables/useToast'
import { z } from 'zod'

import { useWorkPackagePicker } from '@renderer/composables/useWorkPackagePicker'
import {
  WORK_PACKAGE_SEARCH_MAX_DIGITS,
  WORK_PACKAGE_SEARCH_MIN_DIGITS
} from '@shared/validation/work-package-search'
import { timeEntryActivityQueries } from '@renderer/composables/queries/time-entry-activities'
import { useCreateTimeEntry } from '@renderer/composables/queries/time-entries'

/**
 * Add-a-time-entry form. Rendered in the day modal's top section.
 *
 * Conventions (`.opencode/rules/conventions-frontend.md`):
 * - No direct `window.openproject.*` calls — the work-package list, the
 *   activity list, and the write all go through query/mutation composables,
 *   so the Colada cache and its invalidation stay wired.
 * - Cache invalidation lives in `useCreateTimeEntry()`, not here: after a
 *   successful save the calendar grid, the month total, and this modal's
 *   entry list all refetch without this component knowing about them.
 *
 * OpenProject requires an activity on every entry, and the allowed set is
 * project-scoped — so the activity query is keyed on the selected work
 * package and refetches when it changes.
 *
 * Security: the form sends plain numeric ids. The main process re-validates
 * them and builds the request hrefs itself, so nothing typed here can reach
 * a request path (`.opencode/rules/security.md`).
 */

const props = defineProps<{
  /** The day being logged against, `YYYY-MM-DD`. */
  date: string
}>()

const emit = defineEmits<{
  /** A time entry was created successfully. */
  saved: []
}>()

/** Default entry length — the most common single log. */
const DEFAULT_HOURS = 1

/**
 * Longest single entry the form accepts — a working day. The stepper's `max`
 * and the schema below share it, so the input can't offer a value the
 * validation would then reject. The main process stays authoritative with its
 * own (looser, 24h) cap in `CreateTimeEntryInputSchema`.
 */
const MAX_HOURS = 8

/**
 * Client-side schema for immediate field feedback. The main process
 * re-validates with `CreateTimeEntryInputSchema` and remains authoritative —
 * this one exists so the user sees an inline message instead of a round-trip
 * rejection. Zod 4 takes a single `error` for the type-mismatch message.
 */
const formSchema = z.object({
  workPackageId: z
    .number({ error: 'Choose a work package.' })
    .int()
    .positive('Choose a work package.'),
  activityId: z
    .number({ error: 'Choose an activity.' })
    .int()
    .positive('Choose an activity.'),
  hours: z
    .number({ error: 'Enter the hours worked.' })
    .positive('Hours must be greater than 0.')
    .max(MAX_HOURS, `A single entry cannot exceed ${MAX_HOURS} hours.`),
  comment: z.string().max(2000, 'Comment is too long.').optional()
})

type FormState = z.infer<typeof formSchema>

const state = ref<{
  workPackageId: number | undefined
  activityId: number | undefined
  hours: number
  comment: string
}>({
  workPackageId: undefined,
  activityId: undefined,
  hours: DEFAULT_HOURS,
  comment: ''
})

// ---------------------------------------------------------------------------
// Work packages — the select's options.
// ---------------------------------------------------------------------------

// Suggestions are the user's priority items; typing a full id searches the
// whole instance and replaces them. See `useWorkPackagePicker`.
const {
  items: workPackageItems,
  searchTerm: workPackageSearch,
  isServerSearchActive,
  isLoading: workPackagesLoading,
  error: workPackagesError,
  searchError: workPackageSearchError
} = useWorkPackagePicker({ selectedId: () => state.value.workPackageId })

/**
 * "5 digits" while the minimum equals the cap, "4–5 digits" if the minimum is
 * ever lowered — a hardcoded range would read "5–5 digits" today.
 */
const searchPlaceholder = computed(() =>
  WORK_PACKAGE_SEARCH_MIN_DIGITS === WORK_PACKAGE_SEARCH_MAX_DIGITS
    ? `Search by ID (${WORK_PACKAGE_SEARCH_MAX_DIGITS} digits)…`
    : `Search by ID (${WORK_PACKAGE_SEARCH_MIN_DIGITS}–${WORK_PACKAGE_SEARCH_MAX_DIGITS} digits)…`
)

// ---------------------------------------------------------------------------
// Activities — required by OpenProject, scoped to the selected work package.
// ---------------------------------------------------------------------------

const {
  data: activitiesData,
  status: activitiesStatus,
  error: activitiesError,
  refresh: refreshActivities
} = useQuery(() =>
  timeEntryActivityQueries.list(state.value.workPackageId)
)

const activityItems = computed(() =>
  (activitiesData.value?._embedded.elements ?? []).map((a) => ({
    label: a.name,
    value: a.id
  }))
)

const activitiesLoading = computed(() => activitiesStatus.value === 'pending')

/**
 * Preselect an activity once the list arrives: OpenProject's flagged
 * default if there is one, otherwise the first. Also clears a stale
 * selection when switching to a work package whose project doesn't allow
 * the previously chosen activity — otherwise the server would reject the
 * save with a 422 the user can't see the cause of.
 */
watch(
  () => activitiesData.value,
  (data) => {
    const elements = data?._embedded.elements ?? []
    if (elements.length === 0) {
      state.value.activityId = undefined
      return
    }
    const stillValid = elements.some((a) => a.id === state.value.activityId)
    if (stillValid) return
    state.value.activityId =
      elements.find((a) => a.default === true)?.id ?? elements[0].id
  },
  { immediate: true }
)

/** No activity can be chosen → saving would 422. Block submit instead. */
const hasNoActivities = computed(
  () => !activitiesLoading.value && activityItems.value.length === 0
)

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

const { mutateAsync: createTimeEntry, isLoading: saving } = useCreateTimeEntry()

/** Bridge errors cross IPC as `{ code, message }`; read defensively. */
const saveError = ref<{ code: string; message: string } | null>(null)

function toBridgeError(e: unknown): { code: string; message: string } {
  const err = e as ({ code?: string; message?: string } & Error) | null
  return {
    code: err?.code ?? 'OPENPROJECT_UNKNOWN',
    message:
      err?.message ?? 'An unexpected error occurred while saving the entry.'
  }
}

const toast = useToast()

async function onSubmit(event: { data: FormState }): Promise<void> {
  saveError.value = null
  try {
    await createTimeEntry({
      workPackageId: event.data.workPackageId,
      activityId: event.data.activityId,
      spentOn: props.date,
      hours: event.data.hours,
      ...(event.data.comment !== undefined && event.data.comment.trim() !== ''
        ? { comment: event.data.comment.trim() }
        : {})
    })
    toast.add({
      title: 'Time logged',
      description: `${event.data.hours}h on ${props.date}.`,
      icon: 'i-lucide-check-circle',
      color: 'success'
    })
    // Keep the work package + activity so logging a second entry against the
    // same item is quick; reset only what's entry-specific.
    state.value.hours = DEFAULT_HOURS
    state.value.comment = ''
    emit('saved')
  } catch (e) {
    saveError.value = toBridgeError(e)
  }
}
</script>

<template>
  <UForm
    :schema="formSchema"
    :state="state"
    class="flex flex-col gap-4"
    @submit="onSubmit"
  >
    <UFormField name="workPackageId">
      <USelectMenu
        v-model="state.workPackageId"
        v-model:search-term="workPackageSearch"
        :items="workPackageItems"
        value-key="value"
        :loading="workPackagesLoading"
        :disabled="saving"
        icon="i-lucide-package"
        placeholder="Select a work package"
        aria-label="Work package"
        :search-input="{
          placeholder: searchPlaceholder,
          icon: 'i-lucide-search',
          inputmode: 'numeric',
          maxlength: WORK_PACKAGE_SEARCH_MAX_DIGITS
        }"
        :ignore-filter="isServerSearchActive"
        class="w-full"
      >
        <!-- The default empty text ("No matching data") reads as "no such work
             package" while a search is still in flight, so say which it is. -->
        <template #empty>
          <span v-if="workPackagesLoading">Searching…</span>
          <span v-else-if="workPackageSearch">
            No work package matches “{{ workPackageSearch }}”.
          </span>
          <span v-else>No work packages.</span>
        </template>
      </USelectMenu>
      <template v-if="workPackagesError || workPackageSearchError" #help>
        <span class="text-error">
          {{
            workPackagesError
              ? "Couldn't load your work packages."
              : "Couldn't search work packages."
          }}
        </span>
      </template>
    </UFormField>

    <div class="flex items-start gap-3">
      <UFormField name="activityId" class="flex-1">
        <USelectMenu
          v-model="state.activityId"
          :items="activityItems"
          value-key="value"
          :loading="activitiesLoading"
          :disabled="saving || hasNoActivities"
          icon="i-lucide-tag"
          placeholder="Select an activity"
          aria-label="Activity"
          class="w-full"
        />
      </UFormField>

      <UFormField name="hours" class="w-32">
        <UInputNumber
          v-model="state.hours"
          :min="0.25"
          :max="MAX_HOURS"
          :step="0.25"
          :disabled="saving"
          aria-label="Hours"
          class="w-full"
        />
      </UFormField>
    </div>

    <UFormField name="comment">
      <UTextarea
        v-model="state.comment"
        :rows="2"
        :maxrows="4"
        :disabled="saving"
        autoresize
        placeholder="What did you work on? (optional)"
        aria-label="Comment"
        class="w-full"
      />
    </UFormField>

    <!-- Activities are required by OpenProject — saving without one 422s. -->
    <UAlert
      v-if="activitiesError"
      color="error"
      variant="subtle"
      icon="i-lucide-alert-triangle"
      title="Couldn't load activities"
      description="OpenProject requires an activity on every time entry, so saving is disabled until this loads."
    >
      <template #actions>
        <UButton
          color="error"
          variant="outline"
          size="sm"
          icon="i-lucide-refresh-cw"
          label="Retry"
          :loading="activitiesLoading"
          @click="() => refreshActivities()"
        />
      </template>
    </UAlert>
    <!-- Save failure — includes OpenProject's own 422 message. -->
    <UAlert
      v-if="saveError"
      color="error"
      variant="subtle"
      icon="i-lucide-alert-octagon"
      title="Couldn't log time"
      :description="saveError.message"
    />

    <div class="flex items-center justify-end gap-3">
      <!-- Why the button is disabled, on the button's own row: it's a state of
           the submit, not an event worth its own alert block. Suppressed when
           the activities alert above is already explaining the same gap. -->
      <p
        v-if="hasNoActivities && !activitiesError"
        class="text-warning flex items-center gap-1.5 text-xs"
      >
        <UIcon name="i-lucide-alert-triangle" class="size-4 shrink-0" />
        <span>No activities in this project.</span>
      </p>

      <UButton
        type="submit"
        color="primary"
        icon="i-lucide-plus"
        label="Log time"
        :loading="saving"
        :disabled="saving || hasNoActivities"
      />
    </div>
  </UForm>
</template>
