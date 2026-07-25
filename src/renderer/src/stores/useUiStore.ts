import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Client-side UI state for the single-screen shell: which overlay is open,
 * and what the day modal is currently pointed at.
 *
 * This is *client* state, not server state, so it belongs in a Pinia store
 * rather than a Colada query (`.opencode/rules/conventions-frontend.md` —
 * "Global state: Pinia stores. Async data: Pinia Colada"). It lives here
 * rather than in `App.vue` because the overlays and their triggers are
 * siblings: the header's settings action, a calendar cell opening the day
 * modal, and the modals themselves (mounted in `App.vue`). Passing that
 * through props and events would thread state through the whole tree for no
 * benefit.
 */
export const useUiStore = defineStore('ui', () => {
  /** Settings modal. */
  const isSettingsOpen = ref(false)

  /** Day modal. */
  const isDayModalOpen = ref(false)

  /**
   * The day the modal is logging against, as `YYYY-MM-DD`. `null` only
   * before the modal has ever been opened — the modal itself is never
   * rendered without a date.
   */
  const activeDate = ref<string | null>(null)

  function openSettings(): void {
    isSettingsOpen.value = true
  }

  /** Open the day modal for `date` — called from a calendar cell. */
  function openDay(date: string): void {
    activeDate.value = date
    isDayModalOpen.value = true
  }

  /**
   * Close the day modal. `activeDate` is deliberately left in place:
   * clearing it would blank the modal's content for the frame the close
   * transition is still animating.
   */
  function closeDay(): void {
    isDayModalOpen.value = false
  }

  return {
    isSettingsOpen,
    isDayModalOpen,
    activeDate,
    openSettings,
    openDay,
    closeDay
  }
})
