<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  api,
  ApiError,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '@/api/client'
import { useAuth } from '@/auth'
import { DEFAULT_TIMEZONE, todayYmd } from '@/tz'

const PROJECT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
const PAGE_SIZE = 50

type StatusChip = 'open' | 'finished' | 'deleted'

const auth = useAuth()
const timeZone = ref(DEFAULT_TIMEZONE)
const projects = ref<string[]>([])
const filter = ref('all')
const statusChip = ref<StatusChip>('open')
const priorityFilter = ref('')
const tasks = ref<Task[]>([])
const truncated = ref(false)
const total = ref(0)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')
const formOpen = ref(false)
const formSaving = ref(false)
const editingId = ref<number | null>(null)
const rowBusyId = ref<number | null>(null)

const name = ref('')
const description = ref('')
const dueDate = ref('')
const project = ref('')
const priority = ref<TaskPriority>('normal')
const status = ref<TaskStatus>('todo')

const today = computed(() => todayYmd(timeZone.value))

const sections = computed(() => {
  if (statusChip.value !== 'open') {
    return [{ title: null as string | null, items: tasks.value }]
  }
  const overdue: Task[] = []
  const dueToday: Task[] = []
  const upcoming: Task[] = []
  const noDate: Task[] = []
  for (const task of tasks.value) {
    if (!task.due_date) noDate.push(task)
    else if (task.due_date < today.value) overdue.push(task)
    else if (task.due_date === today.value) dueToday.push(task)
    else upcoming.push(task)
  }
  return [
    { title: 'Overdue', items: overdue },
    { title: 'Due today', items: dueToday },
    { title: 'Upcoming', items: upcoming },
    { title: 'No date', items: noDate },
  ].filter((s) => s.items.length > 0)
})

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

function statusLabel(s: TaskStatus): string {
  if (s === 'in_progress') return 'In progress'
  if (s === 'todo') return 'To do'
  if (s === 'finished') return 'Finished'
  return 'Deleted'
}

function priorityLabel(p: TaskPriority): string {
  if (p === 'high') return 'High'
  if (p === 'low') return 'Low'
  return 'Normal'
}

function dueLabel(task: Task): string {
  return task.due_date ? formatDate(task.due_date) : 'No date'
}

function listParams(offset: number) {
  const params: {
    project?: string
    status?: string
    priority?: string
    limit: number
    offset: number
  } = { limit: PAGE_SIZE, offset }
  if (filter.value === '_none') params.project = '_none'
  else if (filter.value !== 'all') params.project = filter.value
  if (statusChip.value === 'finished') params.status = 'finished'
  else if (statusChip.value === 'deleted') params.status = 'deleted'
  if (priorityFilter.value) params.priority = priorityFilter.value
  return params
}

async function loadMeta() {
  const token = auth.getAccessToken()
  if (!token) return
  try {
    const res = await api.getModels(token)
    timeZone.value = res.timezone || DEFAULT_TIMEZONE
    projects.value = res.task_projects ?? res.agent_projects ?? []
  } catch {
    // Tasks work with the runner offline.
  }
}

async function loadFirstPage() {
  const token = auth.getAccessToken()
  if (!token) return
  loading.value = true
  error.value = ''
  try {
    const res = await api.listTasks(listParams(0), token)
    tasks.value = res.tasks
    truncated.value = res.truncated
    total.value = res.total
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load tasks'
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  const token = auth.getAccessToken()
  if (!token || !truncated.value || loadingMore.value || loading.value) return
  loadingMore.value = true
  try {
    const res = await api.listTasks(listParams(tasks.value.length), token)
    const seen = new Set(tasks.value.map((t) => t.id))
    for (const task of res.tasks) {
      if (!seen.has(task.id)) tasks.value.push(task)
    }
    truncated.value = res.truncated
    total.value = res.total
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load more'
  } finally {
    loadingMore.value = false
  }
}

function openCreate() {
  editingId.value = null
  name.value = ''
  description.value = ''
  dueDate.value = ''
  project.value = filter.value !== 'all' && filter.value !== '_none' ? filter.value : ''
  priority.value = 'normal'
  status.value = 'todo'
  formOpen.value = true
  error.value = ''
}

function openEdit(task: Task) {
  editingId.value = task.id
  name.value = task.name
  description.value = task.description ?? ''
  dueDate.value = task.due_date ?? ''
  project.value = task.project ?? ''
  priority.value = task.priority
  status.value = task.status
  formOpen.value = true
  error.value = ''
}

function closeForm() {
  formOpen.value = false
  editingId.value = null
}

function formPayload() {
  const proj = project.value.trim()
  return {
    name: name.value.trim(),
    description: description.value.trim() || null,
    due_date: dueDate.value || null,
    project: proj || null,
    priority: priority.value,
    status: status.value,
  }
}

async function saveForm() {
  const token = auth.getAccessToken()
  if (!token) return
  if (!name.value.trim()) {
    error.value = 'Name is required'
    return
  }
  const proj = project.value.trim()
  if (proj && !PROJECT_RE.test(proj)) {
    error.value = 'Invalid project name'
    return
  }
  formSaving.value = true
  error.value = ''
  try {
    if (editingId.value === null) {
      const payload = formPayload()
      if (payload.status === 'deleted') {
        error.value = 'Cannot create a deleted task'
        formSaving.value = false
        return
      }
      await api.createTask(
        { ...payload, status: payload.status as Exclude<TaskStatus, 'deleted'> },
        token,
      )
    } else {
      await api.updateTask(editingId.value, formPayload(), token)
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

async function markAndSave(next: TaskStatus) {
  status.value = next
  await saveForm()
}

async function removeTask() {
  const token = auth.getAccessToken()
  if (!token || editingId.value === null) return
  if (!confirm('Delete this task?')) return
  formSaving.value = true
  error.value = ''
  try {
    await api.deleteTask(editingId.value, token)
    closeForm()
    await loadFirstPage()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Delete failed'
  } finally {
    formSaving.value = false
  }
}

async function patchStatus(task: Task, next: TaskStatus) {
  const token = auth.getAccessToken()
  if (!token) return
  rowBusyId.value = task.id
  error.value = ''
  try {
    if (next === 'deleted') {
      await api.deleteTask(task.id, token)
    } else {
      await api.updateTask(task.id, { status: next }, token)
    }
    await loadFirstPage()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Update failed'
  } finally {
    rowBusyId.value = null
  }
}

watch([filter, statusChip, priorityFilter], () => {
  void loadFirstPage()
})

onMounted(async () => {
  await loadMeta()
  await loadFirstPage()
})
</script>

<template>
  <div class="journal">
    <div class="journal-toolbar">
      <h2 style="margin: 0">Tasks</h2>
      <button type="button" class="btn btn-primary" @click="openCreate">New task</button>
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
      <label class="form-group" style="margin: 0; flex: 1">
        <span class="muted" style="font-size: 0.8rem">Status</span>
        <select v-model="statusChip">
          <option value="open">Open</option>
          <option value="finished">Finished</option>
          <option value="deleted">Deleted</option>
        </select>
      </label>
      <label class="form-group" style="margin: 0; flex: 1">
        <span class="muted" style="font-size: 0.8rem">Priority</span>
        <select v-model="priorityFilter">
          <option value="">All</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </label>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="muted">Loading…</p>
    <p v-else-if="tasks.length === 0" class="muted">
      No tasks here.
      <button type="button" class="btn" style="margin-left: 0.5rem" @click="openCreate">Add one</button>
    </p>

    <template v-else>
      <section v-for="section in sections" :key="section.title ?? 'list'" class="task-group">
        <h3 v-if="section.title" class="task-group-title">{{ section.title }}</h3>
        <div class="journal-list">
          <div
            v-for="task in section.items"
            :key="task.id"
            class="card journal-row"
            role="button"
            tabindex="0"
            @click="openEdit(task)"
            @keydown.enter.prevent="openEdit(task)"
          >
            <div class="journal-row-meta">
              <span :class="{ 'task-due-overdue': section.title === 'Overdue' }">{{ dueLabel(task) }}</span>
              <span class="task-priority" :class="`task-priority-${task.priority}`">{{ priorityLabel(task.priority) }}</span>
              <span class="task-status">{{ statusLabel(task.status) }}</span>
              <span v-if="task.project" class="journal-project">{{ task.project }}</span>
              <span v-if="task.created_by === 'agent'" class="journal-agent">agent</span>
            </div>
            <strong>{{ task.name }}</strong>
            <div class="task-row-actions" @click.stop>
              <button
                v-if="task.status === 'todo'"
                type="button"
                class="btn"
                :disabled="rowBusyId === task.id"
                @click="patchStatus(task, 'in_progress')"
              >
                Start
              </button>
              <button
                v-if="task.status === 'in_progress'"
                type="button"
                class="btn"
                :disabled="rowBusyId === task.id"
                @click="patchStatus(task, 'finished')"
              >
                Finish
              </button>
              <button
                v-if="task.status === 'finished'"
                type="button"
                class="btn"
                :disabled="rowBusyId === task.id"
                @click="patchStatus(task, 'todo')"
              >
                Reopen
              </button>
              <button
                v-if="task.status === 'deleted'"
                type="button"
                class="btn"
                :disabled="rowBusyId === task.id"
                @click="patchStatus(task, 'todo')"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      </section>
      <p v-if="loadingMore" class="muted">Loading more…</p>
      <button
        v-else-if="truncated"
        type="button"
        class="btn"
        style="margin-top: 0.75rem"
        @click="loadMore"
      >
        More
      </button>
      <p v-else class="muted" style="text-align: center; margin-top: 0.75rem">
        {{ total }} task{{ total === 1 ? '' : 's' }}
      </p>
    </template>

    <div v-if="formOpen" class="journal-modal" @click.self="closeForm">
      <div class="card journal-form">
        <h3 style="margin-top: 0">{{ editingId === null ? 'New task' : 'Edit task' }}</h3>
        <label class="form-group">
          Name
          <input v-model="name" type="text" maxlength="200" required />
        </label>
        <label class="form-group">
          Description (optional)
          <textarea v-model="description" rows="6" />
        </label>
        <label class="form-group">
          Due date (optional)
          <input v-model="dueDate" type="date" />
        </label>
        <label class="form-group">
          Priority
          <select v-model="priority">
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label class="form-group">
          Status
          <select v-model="status">
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="finished">Finished</option>
            <option v-if="editingId !== null" value="deleted">Deleted</option>
          </select>
        </label>
        <label class="form-group">
          Project (optional)
          <input v-model="project" type="text" list="task-project-list" placeholder="Blank = global" />
          <datalist id="task-project-list">
            <option v-for="p in projects" :key="p" :value="p" />
          </datalist>
        </label>
        <div class="journal-form-actions">
          <button type="button" class="btn btn-primary" :disabled="formSaving" @click="saveForm">
            {{ formSaving ? 'Saving…' : 'Save' }}
          </button>
          <button
            v-if="editingId !== null && status === 'todo'"
            type="button"
            class="btn"
            :disabled="formSaving"
            @click="markAndSave('in_progress')"
          >
            Mark in progress
          </button>
          <button
            v-if="editingId !== null && status === 'in_progress'"
            type="button"
            class="btn"
            :disabled="formSaving"
            @click="markAndSave('finished')"
          >
            Mark finished
          </button>
          <button type="button" class="btn" :disabled="formSaving" @click="closeForm">Cancel</button>
          <button
            v-if="editingId !== null && status !== 'deleted'"
            type="button"
            class="btn"
            style="margin-left: auto; color: #f87171"
            :disabled="formSaving"
            @click="removeTask"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
