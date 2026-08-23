<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api, ApiError, type CalendarEntry } from '@/api/client'
import { useAuth } from '@/auth'
import {
  DEFAULT_TIMEZONE,
  addDaysYmd,
  monthGrid,
  monthLabel,
  shiftMonth,
  todayYmd,
  utcIsoToLocal,
  zonedLocalToUtcIso,
} from '@/tz'

const PROJECT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CELL_CAP = 4

const auth = useAuth()
const timeZone = ref(DEFAULT_TIMEZONE)
const projects = ref<string[]>([])
const filter = ref('all')
const year = ref(2026)
const month = ref(8)
const entries = ref<CalendarEntry[]>([])
const upcoming = ref<CalendarEntry[]>([])
const truncated = ref(false)
const loading = ref(true)
const error = ref('')
const formOpen = ref(false)
const formSaving = ref(false)
const editingId = ref<number | null>(null)

const title = ref('')
const allDay = ref(true)
const startDate = ref('')
const endDate = ref('')
const startTime = ref('09:00')
const endTime = ref('')
const description = ref('')
const project = ref('')

const today = computed(() => todayYmd(timeZone.value))
const days = computed(() => monthGrid(year.value, month.value))
const monthYm = computed(() => `${year.value}-${String(month.value).padStart(2, '0')}`)

function isOutside(ymd: string) {
  return !ymd.startsWith(monthYm.value)
}

function entryOverlapsDay(entry: CalendarEntry, ymd: string): boolean {
  const dayStart = zonedLocalToUtcIso(ymd, '00:00', timeZone.value)
  const dayEnd = zonedLocalToUtcIso(addDaysYmd(ymd, 1), '00:00', timeZone.value)
  const start = entry.starts_at
  const end = entry.ends_at ?? entry.starts_at
  return start < dayEnd && end >= dayStart
}

function entriesForDay(ymd: string): CalendarEntry[] {
  return entries.value.filter((e) => entryOverlapsDay(e, ymd))
}

function eventLabel(entry: CalendarEntry): string {
  if (entry.all_day) return entry.title
  const local = utcIsoToLocal(entry.starts_at, timeZone.value)
  return `${local.hm} ${entry.title}`
}

async function loadMeta() {
  const token = auth.getAccessToken()
  if (!token) return
  try {
    const res = await api.getModels(token)
    timeZone.value = res.timezone || DEFAULT_TIMEZONE
    projects.value = res.calendar_projects ?? res.agent_projects ?? []
  } catch {
    // Calendar still works offline from the runner; keep defaults.
  }
}

async function loadMonth() {
  const token = auth.getAccessToken()
  if (!token) return
  const grid = monthGrid(year.value, month.value)
  const from = zonedLocalToUtcIso(grid[0], '00:00', timeZone.value)
  const to = zonedLocalToUtcIso(addDaysYmd(grid[grid.length - 1], 1), '00:00', timeZone.value)
  const params: { from: string; to: string; project?: string } = { from, to }
  if (filter.value === '_none') params.project = '_none'
  else if (filter.value !== 'all') params.project = filter.value

  const upcomingFrom = zonedLocalToUtcIso(todayYmd(timeZone.value), '00:00', timeZone.value)
  const upcomingTo = zonedLocalToUtcIso(addDaysYmd(todayYmd(timeZone.value), 14), '00:00', timeZone.value)
  const upcomingParams = { ...params, from: upcomingFrom, to: upcomingTo }

  try {
    const [monthRes, upcomingRes] = await Promise.all([
      api.listCalendar(params, token),
      api.listCalendar(upcomingParams, token),
    ])
    entries.value = monthRes.entries
    truncated.value = monthRes.truncated
    upcoming.value = upcomingRes.entries
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load calendar'
  } finally {
    loading.value = false
  }
}

async function reload() {
  loading.value = true
  await loadMeta()
  await loadMonth()
}

function goToday() {
  const t = todayYmd(timeZone.value)
  const [y, m] = t.split('-').map(Number)
  year.value = y
  month.value = m
}

function prevMonth() {
  const next = shiftMonth(year.value, month.value, -1)
  year.value = next.year
  month.value = next.month
}

function nextMonth() {
  const next = shiftMonth(year.value, month.value, 1)
  year.value = next.year
  month.value = next.month
}

function resetForm() {
  title.value = ''
  allDay.value = true
  startDate.value = today.value
  endDate.value = ''
  startTime.value = '09:00'
  endTime.value = ''
  description.value = ''
  project.value = ''
  editingId.value = null
  error.value = ''
}

function openCreate(ymd: string) {
  resetForm()
  startDate.value = ymd
  allDay.value = true
  formOpen.value = true
}

function openEdit(entry: CalendarEntry) {
  editingId.value = entry.id
  title.value = entry.title
  allDay.value = entry.all_day
  description.value = entry.description ?? ''
  project.value = entry.project ?? ''
  const start = utcIsoToLocal(entry.starts_at, timeZone.value)
  startDate.value = start.ymd
  startTime.value = start.hm
  if (entry.ends_at) {
    const end = utcIsoToLocal(entry.ends_at, timeZone.value)
    endDate.value = end.ymd
    endTime.value = entry.all_day ? '' : end.hm
  } else {
    endDate.value = ''
    endTime.value = ''
  }
  formOpen.value = true
  error.value = ''
}

function closeForm() {
  formOpen.value = false
  editingId.value = null
}

function buildPayload() {
  const name = project.value.trim()
  if (name !== '' && !PROJECT_RE.test(name)) {
    throw new Error(
      "Invalid project name: use 1–64 chars starting with a letter or digit; only letters, digits, '.', '_', and '-' allowed",
    )
  }
  if (!title.value.trim()) {
    throw new Error('Title is required')
  }
  if (!startDate.value) {
    throw new Error('Start date is required')
  }

  let startsAt: string
  let endsAt: string | null = null
  if (allDay.value) {
    startsAt = zonedLocalToUtcIso(startDate.value, '00:00', timeZone.value)
    if (endDate.value && endDate.value !== startDate.value) {
      endsAt = zonedLocalToUtcIso(endDate.value, '00:00', timeZone.value)
    }
  } else {
    startsAt = zonedLocalToUtcIso(startDate.value, startTime.value || '00:00', timeZone.value)
    if (endDate.value && endTime.value) {
      endsAt = zonedLocalToUtcIso(endDate.value, endTime.value, timeZone.value)
    } else if (endTime.value) {
      endsAt = zonedLocalToUtcIso(startDate.value, endTime.value, timeZone.value)
    }
  }

  return {
    title: title.value.trim(),
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: allDay.value,
    description: description.value.trim() || null,
    project: name === '' ? null : name,
  }
}

async function save() {
  const token = auth.getAccessToken()
  if (!token) return
  formSaving.value = true
  error.value = ''
  try {
    const payload = buildPayload()
    if (editingId.value) {
      await api.updateCalendarEntry(editingId.value, payload, token)
    } else {
      await api.createCalendarEntry(payload, token)
    }
    closeForm()
    await loadMonth()
    await loadMeta()
  } catch (e) {
    error.value = e instanceof ApiError || e instanceof Error ? e.message : 'Failed to save'
  } finally {
    formSaving.value = false
  }
}

async function removeEntry() {
  const token = auth.getAccessToken()
  if (!token || !editingId.value) return
  if (!window.confirm('Delete this calendar entry?')) return
  formSaving.value = true
  try {
    await api.deleteCalendarEntry(editingId.value, token)
    closeForm()
    await loadMonth()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to delete'
  } finally {
    formSaving.value = false
  }
}

watch([year, month, filter, timeZone], () => {
  if (!loading.value) {
    loadMonth()
  }
})

let timer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  goToday()
  await reload()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadMonth()
    }
  }, 45000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="calendar-page">
    <div class="cal-toolbar">
      <h2 style="margin: 0">Calendar</h2>
      <div class="cal-nav">
        <button type="button" class="btn" @click="prevMonth">Prev</button>
        <strong>{{ monthLabel(year, month) }}</strong>
        <button type="button" class="btn" @click="nextMonth">Next</button>
        <button type="button" class="btn" @click="goToday">Today</button>
      </div>
    </div>
    <p class="muted" style="margin-top: 0.35rem">
      Times in {{ timeZone }}. Click a day to add an all-day entry.
    </p>

    <div class="form-group" style="max-width: 16rem">
      <label for="cal-filter">Project</label>
      <select id="cal-filter" v-model="filter">
        <option value="all">All</option>
        <option value="_none">No project</option>
        <option v-for="p in projects" :key="p" :value="p">{{ p }}</option>
      </select>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="muted">Loading…</p>
    <p v-if="truncated" class="muted">Too many entries in this range — filter by project to see more.</p>

    <div v-if="formOpen" class="card cal-form">
      <h3 style="margin-top: 0">{{ editingId ? 'Edit entry' : 'New entry' }}</h3>
      <form @submit.prevent="save">
        <div class="form-group">
          <label for="cal-title">Title</label>
          <input id="cal-title" v-model="title" type="text" required maxlength="200" />
        </div>
        <div class="form-group">
          <label style="display: flex; align-items: center; gap: 0.4rem">
            <input v-model="allDay" type="checkbox" />
            All day
          </label>
        </div>
        <div class="cal-form-row">
          <div class="form-group">
            <label for="cal-start-date">Start date</label>
            <input id="cal-start-date" v-model="startDate" type="date" required />
          </div>
          <div v-if="!allDay" class="form-group">
            <label for="cal-start-time">Start time</label>
            <input id="cal-start-time" v-model="startTime" type="time" required />
          </div>
        </div>
        <div class="cal-form-row">
          <div class="form-group">
            <label for="cal-end-date">End date (optional)</label>
            <input id="cal-end-date" v-model="endDate" type="date" />
          </div>
          <div v-if="!allDay" class="form-group">
            <label for="cal-end-time">End time (optional)</label>
            <input id="cal-end-time" v-model="endTime" type="time" />
          </div>
        </div>
        <div class="form-group">
          <label for="cal-desc">Description</label>
          <textarea id="cal-desc" v-model="description" />
        </div>
        <div class="form-group">
          <label for="cal-project">Project (optional)</label>
          <input
            id="cal-project"
            v-model="project"
            type="text"
            list="cal-projects"
            maxlength="64"
            placeholder="Leave blank for all agents"
            autocomplete="off"
          />
          <datalist id="cal-projects">
            <option v-for="p in projects" :key="p" :value="p" />
          </datalist>
        </div>
        <div class="actions" style="margin-top: 0">
          <button type="submit" class="btn btn-primary" :disabled="formSaving">
            {{ formSaving ? 'Saving…' : 'Save' }}
          </button>
          <button type="button" class="btn" :disabled="formSaving" @click="closeForm">Cancel</button>
          <button
            v-if="editingId"
            type="button"
            class="btn btn-danger"
            :disabled="formSaving"
            @click="removeEntry"
          >
            Delete
          </button>
        </div>
      </form>
    </div>

    <div class="cal-weekdays">
      <span v-for="d in WEEKDAYS" :key="d">{{ d }}</span>
    </div>
    <div class="cal-grid">
      <button
        v-for="ymd in days"
        :key="ymd"
        type="button"
        class="cal-day"
        :class="{
          'cal-day-today': ymd === today,
          'cal-day-outside': isOutside(ymd),
        }"
        @click="openCreate(ymd)"
      >
        <span class="cal-day-num">{{ Number(ymd.slice(8)) }}</span>
        <span
          v-for="entry in entriesForDay(ymd).slice(0, CELL_CAP)"
          :key="entry.id"
          class="cal-event"
          :class="{ 'cal-event-agent': entry.created_by === 'agent' }"
          @click.stop="openEdit(entry)"
        >
          {{ eventLabel(entry) }}
        </span>
        <span v-if="entriesForDay(ymd).length > CELL_CAP" class="cal-more">
          +{{ entriesForDay(ymd).length - CELL_CAP }}
        </span>
      </button>
    </div>

    <h3>Upcoming</h3>
    <p v-if="upcoming.length === 0" class="muted">Nothing in the next 14 days.</p>
    <button
      v-for="entry in upcoming"
      :key="'up-' + entry.id"
      type="button"
      class="card cal-upcoming"
      @click="openEdit(entry)"
    >
      <strong>{{ entry.title }}</strong>
      <span v-if="entry.created_by === 'agent'" class="job-type">agent</span>
      <span v-if="entry.project" class="muted"> · {{ entry.project }}</span>
      <p class="muted" style="margin: 0.25rem 0 0">
        <template v-if="entry.all_day">
          {{ utcIsoToLocal(entry.starts_at, timeZone).ymd }}
          <template v-if="entry.ends_at && utcIsoToLocal(entry.ends_at, timeZone).ymd !== utcIsoToLocal(entry.starts_at, timeZone).ymd">
            – {{ utcIsoToLocal(entry.ends_at, timeZone).ymd }}
          </template>
        </template>
        <template v-else>
          {{ utcIsoToLocal(entry.starts_at, timeZone).ymd }}
          {{ utcIsoToLocal(entry.starts_at, timeZone).hm }}
        </template>
      </p>
    </button>
  </div>
</template>
