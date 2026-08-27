<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api, ApiError, type JournalEntry } from '@/api/client'
import { useAuth } from '@/auth'
import { DEFAULT_TIMEZONE, todayYmd } from '@/tz'

const PROJECT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
const PAGE_SIZE = 30
const EXCERPT_LEN = 160

const auth = useAuth()
const route = useRoute()
const timeZone = ref(DEFAULT_TIMEZONE)
const projects = ref<string[]>([])
const filter = ref('all')
const searchQ = ref('')
const appliedQ = ref('')
const entries = ref<JournalEntry[]>([])
const truncated = ref(false)
const nextCursor = ref<{ before_date: string; before_id: number } | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')
const formOpen = ref(false)
const formSaving = ref(false)
const editingId = ref<number | null>(null)
const highlightId = ref<number | null>(null)

const title = ref('')
const body = ref('')
const entryDate = ref('')
const project = ref('')

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function preview(entry: JournalEntry): string {
  const text = entry.body.replace(/\s+/g, ' ').trim()
  if (text.length <= EXCERPT_LEN) return text
  return text.slice(0, EXCERPT_LEN) + '…'
}

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

async function loadMeta() {
  const token = auth.getAccessToken()
  if (!token) return
  try {
    const res = await api.getModels(token)
    timeZone.value = res.timezone || DEFAULT_TIMEZONE
    projects.value = res.journal_projects ?? res.agent_projects ?? []
  } catch {
    // Journal works with the runner offline.
  }
}

function listParams(cursor?: { before_date: string; before_id: number } | null) {
  const params: {
    project?: string
    q?: string
    limit: number
    before_date?: string
    before_id?: number
  } = { limit: PAGE_SIZE }
  if (filter.value === '_none') params.project = '_none'
  else if (filter.value !== 'all') params.project = filter.value
  if (appliedQ.value) params.q = appliedQ.value
  if (cursor) {
    params.before_date = cursor.before_date
    params.before_id = cursor.before_id
  }
  return params
}

async function loadFirstPage() {
  const token = auth.getAccessToken()
  if (!token) return
  loading.value = true
  error.value = ''
  try {
    const res = await api.listJournal(listParams(null), token)
    entries.value = res.entries
    truncated.value = res.truncated
    nextCursor.value = res.next ?? null
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load journal'
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  const token = auth.getAccessToken()
  if (!token || !truncated.value || !nextCursor.value || loadingMore.value || loading.value) return
  loadingMore.value = true
  try {
    const res = await api.listJournal(listParams(nextCursor.value), token)
    const seen = new Set(entries.value.map((e) => e.id))
    for (const entry of res.entries) {
      if (!seen.has(entry.id)) entries.value.push(entry)
    }
    truncated.value = res.truncated
    nextCursor.value = res.next ?? null
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load more'
  } finally {
    loadingMore.value = false
  }
}

function applySearch() {
  appliedQ.value = searchQ.value.trim()
}

function openCreate() {
  editingId.value = null
  title.value = ''
  body.value = ''
  entryDate.value = todayYmd(timeZone.value)
  project.value = filter.value !== 'all' && filter.value !== '_none' ? filter.value : ''
  formOpen.value = true
  error.value = ''
}

function openEdit(entry: JournalEntry) {
  editingId.value = entry.id
  title.value = entry.title ?? ''
  body.value = entry.body
  entryDate.value = entry.entry_date
  project.value = entry.project ?? ''
  formOpen.value = true
  error.value = ''
}

function closeForm() {
  formOpen.value = false
  editingId.value = null
}

async function saveForm() {
  const token = auth.getAccessToken()
  if (!token) return
  const trimmedBody = body.value
  if (!trimmedBody.trim()) {
    error.value = 'Body is required'
    return
  }
  const proj = project.value.trim()
  if (proj && !PROJECT_RE.test(proj)) {
    error.value = 'Invalid project name'
    return
  }
  formSaving.value = true
  error.value = ''
  const payload = {
    body: trimmedBody,
    title: title.value.trim() || null,
    entry_date: entryDate.value || null,
    project: proj || null,
  }
  try {
    if (editingId.value === null) {
      await api.createJournalEntry(payload, token)
    } else {
      await api.updateJournalEntry(editingId.value, payload, token)
    }
    closeForm()
    await loadMeta()
    await loadFirstPage()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Save failed'
  } finally {
    formSaving.value = false
  }
}

async function removeEntry() {
  const token = auth.getAccessToken()
  if (!token || editingId.value === null) return
  if (!confirm('Delete this journal entry?')) return
  formSaving.value = true
  error.value = ''
  try {
    await api.deleteJournalEntry(editingId.value, token)
    closeForm()
    await loadFirstPage()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Delete failed'
  } finally {
    formSaving.value = false
  }
}

function setupObserver() {
  observer?.disconnect()
  observer = new IntersectionObserver(
    (items) => {
      if (items.some((i) => i.isIntersecting)) {
        void loadMore()
      }
    },
    { rootMargin: '200px' },
  )
  if (sentinel.value) observer.observe(sentinel.value)
}

watch([filter, appliedQ], () => {
  void loadFirstPage()
})

watch(sentinel, () => {
  setupObserver()
})

onMounted(async () => {
  const raw = route.query.highlight
  if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    highlightId.value = Number(raw)
  }
  await loadMeta()
  await loadFirstPage()
  await nextTick()
  setupObserver()
  if (highlightId.value !== null) {
    await nextTick()
    document.getElementById(`journal-entry-${highlightId.value}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }
})

onUnmounted(() => {
  observer?.disconnect()
})
</script>

<template>
  <div class="journal">
    <div class="journal-toolbar">
      <h2 style="margin: 0">Journal</h2>
      <button type="button" class="btn btn-primary" @click="openCreate">New entry</button>
    </div>

    <div class="journal-filters">
      <label class="form-group" style="margin: 0; flex: 1">
        <span class="muted" style="font-size: 0.8rem">Filter</span>
        <select v-model="filter">
          <option value="all">All</option>
          <option value="_none">Global</option>
          <option v-for="p in projects" :key="p" :value="p">{{ p }}</option>
        </select>
      </label>
      <label class="form-group" style="margin: 0; flex: 2">
        <span class="muted" style="font-size: 0.8rem">Search</span>
        <div class="journal-search-row">
          <input v-model="searchQ" type="search" placeholder="Title or body…" @keydown.enter.prevent="applySearch" />
          <button type="button" class="btn" @click="applySearch">Search</button>
        </div>
      </label>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="muted">Loading…</p>
    <p v-else-if="entries.length === 0" class="muted">
      No journal entries yet.
      <button type="button" class="btn" style="margin-left: 0.5rem" @click="openCreate">Add one</button>
    </p>

    <div v-else class="journal-list">
      <button
        v-for="entry in entries"
        :id="`journal-entry-${entry.id}`"
        :key="entry.id"
        type="button"
        class="card journal-row"
        :class="{ 'journal-row-highlight': highlightId === entry.id }"
        @click="openEdit(entry)"
      >
        <div class="journal-row-meta">
          <span>{{ formatDate(entry.entry_date) }}</span>
          <span v-if="entry.project" class="journal-project">{{ entry.project }}</span>
          <span v-if="entry.created_by === 'agent'" class="journal-agent">agent</span>
        </div>
        <strong v-if="entry.title">{{ entry.title }}</strong>
        <p class="muted" style="margin: 0.35rem 0 0">{{ preview(entry) }}</p>
      </button>
      <div ref="sentinel" class="journal-sentinel" aria-hidden="true" />
      <p v-if="loadingMore" class="muted">Loading more…</p>
      <p v-else-if="!truncated" class="muted" style="text-align: center">End of journal</p>
    </div>

    <div v-if="formOpen" class="journal-modal" @click.self="closeForm">
      <div class="card journal-form">
        <h3 style="margin-top: 0">{{ editingId === null ? 'New entry' : 'Edit entry' }}</h3>
        <label class="form-group">
          Date
          <input v-model="entryDate" type="date" required />
        </label>
        <label class="form-group">
          Title (optional)
          <input v-model="title" type="text" maxlength="200" />
        </label>
        <label class="form-group">
          Body
          <textarea v-model="body" rows="10" required />
        </label>
        <label class="form-group">
          Project (optional)
          <input v-model="project" type="text" list="journal-project-list" placeholder="Blank = global" />
          <datalist id="journal-project-list">
            <option v-for="p in projects" :key="p" :value="p" />
          </datalist>
        </label>
        <div class="journal-form-actions">
          <button type="button" class="btn btn-primary" :disabled="formSaving" @click="saveForm">
            {{ formSaving ? 'Saving…' : 'Save' }}
          </button>
          <button type="button" class="btn" :disabled="formSaving" @click="closeForm">Cancel</button>
          <button
            v-if="editingId !== null"
            type="button"
            class="btn"
            style="margin-left: auto; color: #f87171"
            :disabled="formSaving"
            @click="removeEntry"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
