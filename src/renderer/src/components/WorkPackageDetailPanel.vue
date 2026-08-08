<script setup lang="ts">
import { computed } from 'vue'
import type { WorkPackage } from '@opentracker/preload'

import type { useWorkPackageEditor } from '@renderer/composables/useWorkPackageEditor'
import {
  NO_DUE_DATE_LABEL,
  NO_START_DATE_LABEL,
  formatWorkPackageDate,
  workPackageAssigneeLabel,
  workPackagePriorityLabel,
  workPackageProjectLabel,
  workPackageStatusColorClass,
  workPackageStatusLabel,
  workPackageTypeLabel
} from '@renderer/utils/work-package-display'
import WorkPackageFields from './WorkPackageFields.vue'

/**
 * The detail view of one work package — the right-hand half of the browse
 * screen's master-detail layout. Reading by default; editing on request.
 *
 * The read view is deliberately still the resting state. A screen that opens
 * seven controls the moment a row is selected makes browsing feel like data
 * entry, and every field would be one stray keystroke from an accidental edit.
 * Editing is entered explicitly and left explicitly, and the fields themselves
 * live in `WorkPackageFields.vue` so stage 3's create form can mount them
 * against an empty draft without copying this layout.
 *
 * The editor is passed in as a single object rather than a dozen props and a
 * matching set of events. It is owned by `useWorkPackagesBrowser()` because the
 * *list* has to consult it too: switching rows with unsaved edits is the
 * browser's decision to guard, not this component's. Splitting the state across
 * both would give the same question two answers.
 *
 * Display fallbacks in the read view stay in the pure helpers in
 * `utils/work-package-display.ts`, so the null/duration/unassigned cases are
 * unit-tested rather than living in this template.
 */

type WorkPackageEditor = ReturnType<typeof useWorkPackageEditor>

const props = defineProps<{
  workPackage: WorkPackage
  /** True while *this* work package's open-in-browser call is in flight. */
  opening?: boolean
  editor: WorkPackageEditor
  /**
   * An action the user asked for that unsaved edits are holding up — switching
   * rows, or closing the screen.
   *
   * Owned by `useWorkPackagesBrowser()`, not the editor, because the *list*
   * raises it. It is rendered here because the actions bar is where the
   * decision belongs: a second strip below the bar asked the question in one
   * place while Cancel and Save still offered contradictory answers in another.
   */
  pendingAction?: { kind: 'select' | 'close' } | null
}>()

const emit = defineEmits<{
  /**
   * Open this work package in the system browser. The panel emits rather than
   * calling the composable itself: the action is shared with the list rows, and
   * one owner for the in-flight state and the failure toast beats two.
   */
  openInBrowser: [workPackageId: number]
  /** Answers to the pending action above — the browser owns what they mean. */
  keepEditing: []
  discardPending: []
}>()

/**
 * The one line of status the actions bar shows, in priority order.
 *
 * A pending action outranks everything: it is a direct question to the user,
 * and the two buttons beside it are its only answers. A conflict comes next —
 * while the panel holds a revision the server has moved past, a validation hint
 * about a draft that cannot be saved is noise. Below that, a failed save
 * outranks a draft problem for the same reason: the server's objection is the
 * more specific one.
 *
 * The draft issue appears only while editing, and only once something is
 * actually wrong: it is the reason Save is greyed out, which is otherwise
 * unguessable. Nothing here restates what the UI already shows.
 */
const statusMessage = computed<string | null>(() => {
  if (props.pendingAction) {
    return props.pendingAction.kind === 'close'
      ? 'You have unsaved changes. Close anyway and discard them?'
      : 'You have unsaved changes. Switch work package and discard them?'
  }
  if (props.editor.isConflicted.value) {
    return 'Changed in OpenProject since you opened it — reload to continue.'
  }
  if (props.editor.saveError.value) return props.editor.saveError.value
  if (props.editor.isEditing.value && props.editor.draftIssue.value) {
    return props.editor.draftIssue.value
  }
  return null
})

const statusClass = computed(() =>
  props.pendingAction || props.editor.isConflicted.value
    ? 'text-warning'
    : 'text-error'
)
</script>

<template>
  <!-- `flex-1`, not `h-full`. The detail pane is a flex column that may also
       hold the unsaved-changes strip below this panel; `h-full` would claim the
       pane's whole height regardless and push that strip out of view. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Header: the id leads, as it does everywhere else in this app — it is
         what a user looks up in OpenProject itself. The subject stays here in
         both modes; while editing it is also a field below, which is the one
         duplication worth keeping — the heading is how you know which work
         package you are renaming. -->
    <div class="flex min-w-0 flex-col gap-1 p-4">
      <!-- The open-in-OpenProject action sits with the id rather than in the
           actions bar: it is a property of *this work package* — the same thing
           the id identifies — not a decision about the edit in progress, which
           is what the bar below is for. -->
      <div class="flex items-center gap-1">
        <span class="text-muted text-xs font-normal tabular-nums">
          #{{ props.workPackage.id }}
        </span>
        <UTooltip text="Open in OpenProject">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-square-arrow-out-up-right"
            :loading="props.opening"
            :aria-label="`Open work package #${props.workPackage.id} in OpenProject`"
            @click="emit('openInBrowser', props.workPackage.id)"
          />
        </UTooltip>
      </div>
      <h2 class="text-base font-semibold text-highlighted break-words">
        {{ props.workPackage.subject }}
      </h2>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <!-- Fields. A description list rather than a table: these are label/value
           pairs, and `dl` is what a screen reader expects for them. The grid
           mirrors the edit form exactly — same four columns, same field order,
           label above value — so switching modes moves nothing under the user's
           eyes. Project and Spent time have no editable counterpart, so they
           take the two columns the date range leaves free on its row. -->
      <WorkPackageFields
        v-if="props.editor.isEditing.value"
        v-model:draft="props.editor.draft.value"
        :fields="props.editor.fields.value"
        :status-options="props.editor.statusOptions.value"
        :type-options="props.editor.typeOptions.value"
        :priority-options="props.editor.priorityOptions.value"
        :assignee-options="props.editor.assigneeOptions.value"
        :project-label="workPackageProjectLabel(props.workPackage)"
        :busy="props.editor.isSaving.value || props.editor.isConflicted.value"
      />

      <!-- Each value sits on its own dimmed tile: in a four-column grid of bare
           label/value pairs there is nothing to say where one field ends and
           the next begins, and the tile does that without a rule per cell.
           Label and value stack flush inside it — the tile is already one unit,
           so a gap between its two lines only loosens what the padding just
           bound together. -->
      <dl v-else class="grid grid-cols-4 items-start gap-2 text-sm">
        <div class="col-span-2 flex min-w-0 flex-col rounded-md bg-elevated p-2">
          <dt class="text-muted text-xs">Project</dt>
          <dd class="text-highlighted">
            {{ workPackageProjectLabel(props.workPackage) }}
          </dd>
        </div>

        <div class="flex min-w-0 flex-col rounded-md bg-elevated p-2">
          <dt class="text-muted text-xs">Type</dt>
          <dd class="text-highlighted">
            {{ workPackageTypeLabel(props.workPackage) }}
          </dd>
        </div>

        <div class="flex min-w-0 flex-col rounded-md bg-elevated p-2">
          <dt class="text-muted text-xs">Priority</dt>
          <dd class="text-highlighted">
            {{ workPackagePriorityLabel(props.workPackage) }}
          </dd>
        </div>

        <div class="flex min-w-0 flex-col rounded-md bg-elevated p-2">
          <dt class="text-muted text-xs">Assignee</dt>
          <dd class="text-highlighted">
            {{ workPackageAssigneeLabel(props.workPackage) }}
          </dd>
        </div>

        <div class="flex min-w-0 flex-col rounded-md bg-elevated p-2">
          <dt class="text-muted text-xs">Status</dt>
          <dd
            class="font-medium"
            :class="workPackageStatusColorClass(props.workPackage)"
          >
            {{ workPackageStatusLabel(props.workPackage) }}
          </dd>
        </div>

        <div class="flex min-w-0 flex-col rounded-md bg-elevated p-2">
          <dt class="text-muted text-xs">Start date</dt>
          <dd class="text-highlighted tabular-nums">
            {{
              formatWorkPackageDate(
                props.workPackage.startDate,
                undefined,
                NO_START_DATE_LABEL
              )
            }}
          </dd>
        </div>

        <div class="flex min-w-0 flex-col rounded-md bg-elevated p-2">
          <dt class="text-muted text-xs">Due date</dt>
          <dd class="text-highlighted tabular-nums">
            {{
              formatWorkPackageDate(
                props.workPackage.dueDate,
                undefined,
                NO_DUE_DATE_LABEL
              )
            }}
          </dd>
        </div>

      </dl>
    </div>

    <!-- Actions, pinned to the bottom of the pane. `shrink-0` keeps the bar
         visible while the fields above it scroll.

         Status on the left, buttons on the right: the message and the button
         that answers it belong on the same line, and a notice stacked above the
         bar pushed the whole bar down as it appeared and vanished. `min-w-0`
         plus `truncate` so a long server message can't shove the buttons off
         the edge. -->
    <div
      class="flex shrink-0 items-center justify-between gap-3 border-t border-default p-4"
    >
      <p v-if="statusMessage" class="min-w-0 truncate text-xs" :class="statusClass">
        {{ statusMessage }}
      </p>
      <span v-else />

      <div class="flex shrink-0 items-center gap-2">
        <!-- A pending action replaces the bar's usual buttons rather than
             joining them: while the question "discard your changes?" is on
             screen, Cancel and Save are two more answers to it that mean
             something else, and offering four buttons for a two-way choice is
             what made this confusing. -->
        <template v-if="props.pendingAction">
          <UButton
            color="neutral"
            variant="ghost"
            label="Keep editing"
            @click="emit('keepEditing')"
          />
          <UButton
            color="warning"
            label="Discard"
            @click="emit('discardPending')"
          />
        </template>
        <!-- Conflict outranks the edit/read split: neither Save nor Edit is
             honest while the panel is showing a revision the server has moved
             past, so the only offer is to take the current version. -->
        <template v-else-if="props.editor.isConflicted.value">
          <UButton
            color="primary"
            icon="i-lucide-refresh-cw"
            label="Get latest version"
            :loading="props.editor.isRefreshing.value"
            @click="props.editor.refreshFromServer()"
          />
        </template>
        <template v-else-if="props.editor.isEditing.value">
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancel"
            :disabled="props.editor.isSaving.value"
            @click="props.editor.cancelEditing()"
          />
          <UButton
            color="primary"
            icon="i-lucide-square-check-big"
            label="Save"
            :loading="props.editor.isSaving.value"
            :disabled="!props.editor.canSave.value"
            @click="props.editor.save()"
          />
        </template>
        <template v-else>
          <UButton
            color="primary"
            icon="i-lucide-square-pen"
            label="Edit"
            @click="props.editor.startEditing()"
          />
        </template>
      </div>
    </div>
  </div>
</template>
