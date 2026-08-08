<script setup lang="ts">
import type { WorkPackage } from '@opentracker/preload'

import {
  NO_DUE_DATE_LABEL,
  NO_START_DATE_LABEL,
  formatSpentHours,
  formatWorkPackageDate,
  workPackageAssigneeLabel,
  workPackageProjectLabel,
  workPackageStatusColorClass,
  workPackageStatusLabel,
  workPackageTypeLabel
} from '@renderer/utils/work-package-display'

/**
 * The read-only detail view of one work package — the right-hand half of the
 * browse screen's master-detail layout.
 *
 * Its own component, taking a `WorkPackage` and owning no state, for a reason
 * that outlives stage 1: stage 2 makes these fields editable (PATCH, with
 * `lockVersion` conflict handling) and stage 3 reuses the same field set for a
 * create form. Both replace this component's *body* and add a mutation. The
 * modal that composes it and the list beside it don't have to change, because
 * neither knows anything about what happens in here.
 *
 * A required, non-null prop is part of that: the "nothing selected" case is the
 * modal's to render, so this component never has to reason about a half-state,
 * and stage 2's form can bind straight to `props.workPackage` without a guard
 * on every field.
 *
 * Every value is rendered through the pure helpers in
 * `utils/work-package-display.ts`, so the null/duration/unassigned fallbacks
 * are unit-tested rather than living in this template.
 */

const props = defineProps<{
  workPackage: WorkPackage
  /** True while *this* work package's open-in-browser call is in flight. */
  opening?: boolean
}>()

const emit = defineEmits<{
  /**
   * Open this work package in the system browser. The panel emits rather than
   * calling the composable itself: the action is shared with the list rows, and
   * one owner for the in-flight state and the failure toast beats two.
   */
  openInBrowser: [workPackageId: number]
}>()
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Header: the id leads, as it does everywhere else in this app — it is
         what a user looks up in OpenProject itself. -->
    <div class="flex min-w-0 flex-col gap-1 p-4">
      <span class="text-muted text-xs font-normal tabular-nums">
        #{{ props.workPackage.id }}
      </span>
      <h2 class="text-base font-semibold text-highlighted break-words">
        {{ props.workPackage.subject }}
      </h2>
    </div>

    <!-- Fields. A description list rather than a table: these are label/value
         pairs, and `dl` is what a screen reader expects for them. -->
    <!-- No top padding: with the header's rule gone, its own `pb-4` is the only
         separation these fields need — two stacked paddings would read as a gap
         where a divider used to be. -->
    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-3 text-sm">
        <dt class="text-muted">Type</dt>
        <dd class="text-highlighted">{{ workPackageTypeLabel(props.workPackage) }}</dd>

        <dt class="text-muted">Status</dt>
        <dd
          class="font-medium"
          :class="workPackageStatusColorClass(props.workPackage)"
        >
          {{ workPackageStatusLabel(props.workPackage) }}
        </dd>

        <dt class="text-muted">Project</dt>
        <dd class="text-highlighted">
          {{ workPackageProjectLabel(props.workPackage) }}
        </dd>

        <dt class="text-muted">Assignee</dt>
        <dd class="text-highlighted">
          {{ workPackageAssigneeLabel(props.workPackage) }}
        </dd>

        <dt class="text-muted">Start date</dt>
        <dd class="text-highlighted tabular-nums">
          {{
            formatWorkPackageDate(
              props.workPackage.startDate,
              undefined,
              NO_START_DATE_LABEL
            )
          }}
        </dd>

        <dt class="text-muted">Due date</dt>
        <dd class="text-highlighted tabular-nums">
          {{
            formatWorkPackageDate(
              props.workPackage.dueDate,
              undefined,
              NO_DUE_DATE_LABEL
            )
          }}
        </dd>

        <dt class="text-muted">Spent time</dt>
        <dd class="text-highlighted tabular-nums">
          {{ formatSpentHours(props.workPackage.spentHours) }}
        </dd>
      </dl>
    </div>

    <!-- Actions, pinned to the bottom of the pane rather than sitting in the
         header: it is where stage 2's Save/Cancel land, so establishing the bar
         now means adding a button there later instead of moving this one. The
         `shrink-0` keeps it visible while the field list above scrolls. -->
    <div class="flex shrink-0 items-center justify-end gap-2 border-t border-default p-4">
      <UButton
        color="neutral"
        icon="i-lucide-external-link"
        label="Open in OpenProject"
        :loading="props.opening"
        @click="emit('openInBrowser', props.workPackage.id)"
      />
    </div>
  </div>
</template>
