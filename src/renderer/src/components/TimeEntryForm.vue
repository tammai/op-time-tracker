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
import {
  useCreateTimeEntry,
  useUpdateTimeEntry
} from '@renderer/composables/queries/time-entries'
import type { TimeEntryDraft } from '@renderer/utils/time-entry-draft'

/**
 * The time-entry form, rendered in the day modal's top section. One component
 * serves both modes: with `draft` unset it logs a new entry, with `draft` set
 * it edits that entry in place.
 *
 * Both modes share every field, every validation rule, and the activity
 * scoping — so they share a component. Splitting them would mean maintaining
 * two copies of the work-package/activity wiring that would drift.
 *
 * Conventions (`.opencode/rules/conventions-frontend.md`):
 * - No direct `window.openproject.*` calls — the work-package list, the
 *   activity list, and both writes go through query/mutation composables,
 *   so the Colada cache and its invalidation stay wired.
 * - Cache invalidation lives in the mutation composables, not here: after a
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
  /**
   * The entry being edited. Unset (or `null`) means add mode. Changing it
   * reloads the fields — the parent owns which entry, if any, is under edit.
   */
  draft?: TimeEntryDraft | null
}>()

const emit = defineEmits<{
  /** A time entry was created or updated successfully. */
  saved: []
  /** The user backed out of edit mode. */
  cancelEdit: []
  /** An edit failed because the entry no longer exists on the server. */
  missing: []
}>()

const isEditing = computed(() => props.draft != null)

/** Default entry length — the most common single log. */
const DEFAULT_HOURS = 1

/**
 * Longest *new* entry the form accepts — a working day. The stepper's `max`
 * and the schema below share it, so the input can't offer a value the
 * validation would then reject. The main process stays authoritative with its
 * own (looser, 24h) cap in `CreateTimeEntryInputSchema`.
 */
const MAX_HOURS = 8

/**
 * The cap when editing: the main process's own limit, not the working-day one.
 * An entry longer than 8h can exist (logged in OpenProject's web UI, or before
 * this cap), and the stricter limit would make its comment uneditable without
 * also rewriting its hours — a dead end the user can't resolve from here.
 */
const MAX_HOURS_EDIT = 24

const maxHours = computed(() => (isEditing.value ? MAX_HOURS_EDIT : MAX_HOURS))

/**
 * Client-side schema for immediate field feedback. The main process
 * re-validates with `Create`/`UpdateTimeEntryInputSchema` and remains
 * authoritative — this one exists so the user sees an inline message instead
 * of a round-trip rejection. Zod 4 takes a single `error` for the
 * type-mismatch message.
 *
 * Built by a function rather than declared inline, so the hours cap can vary
 * with the mode (see `maxHours`) while the inferred `FormState` stays one
 * fixed type.
 */
function buildFormSchema(hoursMax: number) {
  return z.object({
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
      .max(hoursMax, `A single entry cannot exceed ${hoursMax} hours.`),
    comment: z.string().max(2000, 'Comment is too long.').optional()
  })
}

const formSchema = computed(() => buildFormSchema(maxHours.value))

type FormState = z.infer<ReturnType<typeof buildFormSchema>>

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

/**
 * The last failed save. Bridge errors cross IPC as `{ code, message }` — read
 * defensively via `toBridgeError` and never reach into secret-bearing detail.
 */
const saveError = ref<{ code: string; message: string } | null>(null)

/**
 * Load the entry under edit into the fields, and reset them when edit mode
 * ends. Add mode keeps the previously chosen work package + activity so
 * logging a second entry against the same item is quick — but leaving edit
 * mode must not leave the edited entry's hours and comment sitting in what is
 * now a "new entry" form, so those two are cleared.
 */
watch(
  () => props.draft,
  (draft) => {
    saveError.value = null
    if (draft) {
      state.value = {
        workPackageId: draft.workPackageId,
        activityId: draft.activityId,
        hours: draft.hours,
        comment: draft.comment
      }
      return
    }
    state.value.hours = DEFAULT_HOURS
    state.value.comment = ''
  }
)

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

/**
 * Props for the select's search box. Not inline in the template: `InputProps`
 * marks its `InputHTMLAttributes` base `@vue-ignore`, so `inputmode` and
 * `maxlength` are missing from the resolved prop type though the `<input>`
 * still honours them. Excess property checking only fires on fresh literals,
 * so passing a variable keeps the behaviour without a cast.
 */
const searchInputProps = computed(() => ({
  placeholder: searchPlaceholder.value,
  icon: 'i-lucide-search',
  inputmode: 'numeric',
  maxlength: WORK_PACKAGE_SEARCH_MAX_DIGITS
}))

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

const { mutateAsync: createTimeEntry, isLoading: creating } = useCreateTimeEntry()
const { mutateAsync: updateTimeEntry, isLoading: updating } = useUpdateTimeEntry()

const saving = computed(() => creating.value || updating.value)

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

  // An empty comment is sent as an absent one. On create that means "no
  // comment"; on update the main process reads it as "clear the stored
  // comment" (the update is a full replacement) — which is exactly what
  // emptying the field should do.
  const comment = event.data.comment?.trim()
  const fields = {
    workPackageId: event.data.workPackageId,
    activityId: event.data.activityId,
    spentOn: props.date,
    hours: event.data.hours,
    ...(comment !== undefined && comment !== '' ? { comment } : {})
  }

  const editingId = props.draft?.id

  try {
    if (editingId !== undefined) {
      await updateTimeEntry({ id: editingId, ...fields })
      toast.add({
        title: 'Entry updated',
        description: `${event.data.hours}h on ${props.date}.`,
        icon: 'i-lucide-check-circle',
        color: 'success'
      })
    } else {
      await createTimeEntry(fields)
      toast.add({
        title: 'Time logged',
        description: `${event.data.hours}h on ${props.date}.`,
        icon: 'i-lucide-check-circle',
        color: 'success'
      })
      // Keep the work package + activity so logging a second entry against
      // the same item is quick; reset only what's entry-specific. In edit
      // mode the parent clears `draft` instead, which resets these via the
      // watch above.
      state.value.hours = DEFAULT_HOURS
      state.value.comment = ''
    }
    emit('saved')
  } catch (e) {
    const error = toBridgeError(e)
    // The entry vanished under the form — editing it is no longer meaningful,
    // so hand the situation to the parent (which drops edit mode and refreshes
    // the list) rather than showing an alert against a form that can't succeed.
    if (editingId !== undefined && error.code === 'OPENPROJECT_NOT_FOUND') {
      emit('missing')
      return
    }
    saveError.value = error
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
    <!-- Edit mode is a different action on the same fields, so say so up
         front — otherwise "Save changes" is the only thing distinguishing it
         from the add form. -->
    <div
      v-if="isEditing"
      class="flex items-center justify-between gap-2 rounded-md bg-elevated/50 px-3 py-2"
    >
      <span class="flex items-center gap-1.5 text-sm text-highlighted">
        <UIcon name="i-lucide-pencil" class="size-4 shrink-0 text-primary" />
        <span>Editing entry #{{ props.draft?.id }}</span>
      </span>
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-x"
        label="Cancel"
        :disabled="saving"
        @click="emit('cancelEdit')"
      />
    </div>

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
        :search-input="searchInputProps"
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
          :max="maxHours"
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
      :title="isEditing ? 'Couldn’t save changes' : 'Couldn’t log time'"
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
        :icon="isEditing ? 'i-lucide-save' : 'i-lucide-plus'"
        :label="isEditing ? 'Save changes' : 'Log time'"
        :loading="saving"
        :disabled="saving || hasNoActivities"
      />
    </div>
  </UForm>
</template>
