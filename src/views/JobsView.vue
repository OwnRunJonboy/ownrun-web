<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { api, type Job, type JournalEntry, type Task } from '@/api/client'
import { useAuth } from '@/auth'

const auth = useAuth()
const router = useRouter()
const jobs = ref<Job[]>([])
const runnerOnline = ref(false)
const backendState = ref<string | null>(null)
const error = ref('')
const loading = ref(true)
const memoryEntry = ref<JournalEntry | null>(null)
const memoryLabel = ref<string | null>(null)
const dueOverdue = ref(0)
const dueTodayCount = ref(0)
const dueTasks = ref<Task[]>([])

let timer: ReturnType<typeof setInterval> | null = null

const MEMORY_EXCERPT = 280

function memoryExcerpt(body: string): string {
  const text = body.replace(/\s+/g, ' ').trim()
  if (text.length <= MEMORY_EXCERPT) return text
  return text.slice(0, MEMORY_EXCERPT) + '…'
}

function formatMemoryDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

const backendHint = computed(() => {
  switch (backendState.value) {
    case 'switching':
      return 'Switching GPU backends…'
    case 'active_sd':
      return 'GPU: Stable Diffusion'
    case 'failed':
      return 'Backend gate failed'
    default:
      return ''
  }
})

async function load() {
  const token = auth.getAccessToken()
  if (!token) return

  try {
    const [jobsRes, modelsRes, memoryRes, dueRes] = await Promise.all([
      api.listJobs(token),
      api.getModels(token),
      api.getJournalMemory(token).catch(() => null),
      api.getTasksDue(token).catch(() => null),
    ])
    jobs.value = jobsRes.jobs
    runnerOnline.value = modelsRes.runner_online
    backendState.value = modelsRes.backend_state ?? null
    if (memoryRes?.entry) {
      memoryEntry.value = memoryRes.entry
      memoryLabel.value = memoryRes.memory_label
    } else {
      memoryEntry.value = null
      memoryLabel.value = null
    }
    if (dueRes && (dueRes.overdue > 0 || dueRes.due_today > 0)) {
      dueOverdue.value = dueRes.overdue
      dueTodayCount.value = dueRes.due_today
      dueTasks.value = dueRes.tasks
    } else {
      dueOverdue.value = 0
      dueTodayCount.value = 0
      dueTasks.value = []
    }
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load jobs'
  } finally {
    loading.value = false
  }
}

function openMemory() {
  if (!memoryEntry.value) return
  void router.push({ name: 'journal', query: { highlight: String(memoryEntry.value.id) } })
}

function dueCountLabel(): string {
  const parts: string[] = []
  if (dueOverdue.value > 0) {
    parts.push(`${dueOverdue.value} overdue`)
  }
  if (dueTodayCount.value > 0) {
    parts.push(`${dueTodayCount.value} due today`)
  }
  return parts.join(' · ')
}

function formatTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function typeLabel(type: string) {
  if (type === 'agent.task') return 'agent'
  if (type === 'stablediffusion.txt2img') return 'image'
  if (type.startsWith('kb.')) return 'kb'
  return 'chat'
}

onMounted(() => {
  load()
  timer = setInterval(load, 8000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem">
      <h2 style="margin: 0">Jobs</h2>
      <span
        class="runner-badge"
        :class="runnerOnline ? 'runner-online' : 'runner-offline'"
      >
        Runner {{ runnerOnline ? 'online' : 'offline' }}
      </span>
    </div>
    <p v-if="backendHint" class="muted" style="margin-top: -0.5rem; margin-bottom: 1rem">
      {{ backendHint }}
    </p>

    <RouterLink
      v-if="dueOverdue > 0 || dueTodayCount > 0"
      to="/tasks"
      class="card journal-memory"
    >
      <div class="journal-memory-label">Tasks</div>
      <strong style="display: block; margin-top: 0.15rem">{{ dueCountLabel() }}</strong>
      <p
        v-for="task in dueTasks.slice(0, 3)"
        :key="task.id"
        class="muted"
        style="margin: 0.35rem 0 0"
      >
        {{ task.name }}
      </p>
      <span class="muted" style="font-size: 0.8rem">Open Tasks →</span>
    </RouterLink>

    <button
      v-if="memoryEntry"
      type="button"
      class="card journal-memory"
      @click="openMemory"
    >
      <div class="journal-memory-label">{{ memoryLabel || 'From your journal' }}</div>
      <div class="muted" style="font-size: 0.85rem">{{ formatMemoryDate(memoryEntry.entry_date) }}</div>
      <strong v-if="memoryEntry.title" style="display: block; margin-top: 0.35rem">
        {{ memoryEntry.title }}
      </strong>
      <p style="margin: 0.35rem 0 0">{{ memoryExcerpt(memoryEntry.body) }}</p>
      <span class="muted" style="font-size: 0.8rem">Open in Journal →</span>
    </button>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="muted">Loading…</p>
    <p v-else-if="jobs.length === 0" class="muted">
      No jobs yet.
      <RouterLink to="/jobs/new">Create a chat</RouterLink>
      or
      <RouterLink to="/jobs/new-agent">an agent task</RouterLink>.
    </p>

    <RouterLink
      v-for="job in jobs"
      :key="job.id"
      :to="`/jobs/${job.id}`"
      class="card"
      style="display: block; color: inherit; text-decoration: none"
    >
      <div style="display: flex; justify-content: space-between; align-items: start; gap: 1rem">
        <div>
          <strong>#{{ job.id }}</strong>
          <span class="job-type">{{ typeLabel(job.type) }}</span>
          <span class="status" :class="`status-${job.status}`" style="margin-left: 0.5rem">
            {{ job.status }}
          </span>
          <p class="muted" style="margin: 0.35rem 0 0">
            {{ job.request?.model }}
            <template v-if="job.request?.profile"> · {{ job.request.profile }}</template>
            <template v-if="job.request?.project"> · {{ job.request.project }}</template>
            — {{ job.request?.prompt?.slice(0, 80) }}
            <template v-if="(job.request?.prompt?.length ?? 0) > 80">…</template>
            <template v-if="job.request?.parent_job_id"> · continued</template>
          </p>
        </div>
        <span class="muted">{{ formatTime(job.created_at) }}</span>
      </div>
    </RouterLink>
  </div>
</template>
