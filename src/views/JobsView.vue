<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { api, type Job } from '@/api/client'
import { useAuth } from '@/auth'

const auth = useAuth()
const jobs = ref<Job[]>([])
const runnerOnline = ref(false)
const error = ref('')
const loading = ref(true)

let timer: ReturnType<typeof setInterval> | null = null

async function load() {
  const token = auth.getAccessToken()
  if (!token) return

  try {
    const [jobsRes, modelsRes] = await Promise.all([
      api.listJobs(token),
      api.getModels(token),
    ])
    jobs.value = jobsRes.jobs
    runnerOnline.value = modelsRes.runner_online
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load jobs'
  } finally {
    loading.value = false
  }
}

function formatTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function typeLabel(type: string) {
  return type === 'agent.task' ? 'agent' : 'chat'
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
