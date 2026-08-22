<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type Job } from '@/api/client'
import { useAuth } from '@/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuth()

const job = ref<Job | null>(null)
const error = ref('')
const actionError = ref('')
const loading = ref(true)

let timer: ReturnType<typeof setInterval> | null = null

const jobId = () => Number(route.params.id)

async function load() {
  const token = auth.getAccessToken()
  if (!token) return

  try {
    job.value = await api.getJob(jobId(), token)
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load job'
  } finally {
    loading.value = false
  }
}

async function cancelJob() {
  const token = auth.getAccessToken()
  if (!token || !job.value) return
  actionError.value = ''
  try {
    job.value = await api.cancelJob(job.value.id, token)
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Cancel failed'
  }
}

async function requeueJob() {
  const token = auth.getAccessToken()
  if (!token || !job.value) return
  actionError.value = ''
  try {
    job.value = await api.requeueJob(job.value.id, token)
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Requeue failed'
  }
}

function formatTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

onMounted(() => {
  load()
  timer = setInterval(() => {
    if (job.value?.status === 'queued' || job.value?.status === 'running') {
      load()
    }
  }, 4000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div>
    <p><a href="#" @click.prevent="router.push('/')">← Jobs</a></p>

    <p v-if="loading" class="muted">Loading…</p>
    <p v-else-if="error" class="error">{{ error }}</p>

    <template v-else-if="job">
      <h2>
        Job #{{ job.id }}
        <span class="status" :class="`status-${job.status}`">{{ job.status }}</span>
      </h2>

      <div class="card">
        <p><strong>Model:</strong> {{ job.request.model }}</p>
        <p><strong>Prompt:</strong></p>
        <p style="white-space: pre-wrap; margin: 0">{{ job.request.prompt }}</p>
        <p v-if="job.request.system_prompt" class="muted">
          <strong>System:</strong> {{ job.request.system_prompt }}
        </p>
      </div>

      <dl class="muted" style="display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem">
        <dt>Created</dt><dd>{{ formatTime(job.created_at) }}</dd>
        <dt>Queued</dt><dd>{{ formatTime(job.queued_at) }}</dd>
        <dt>Started</dt><dd>{{ formatTime(job.claimed_at) }}</dd>
        <dt>Finished</dt><dd>{{ formatTime(job.finished_at) }}</dd>
      </dl>

      <div v-if="job.status === 'succeeded' && job.result?.text" class="result-text">
        {{ job.result.text }}
      </div>

      <p v-if="job.status === 'failed' && job.error_message" class="error">
        {{ job.error_message }}
      </p>

      <p v-if="actionError" class="error">{{ actionError }}</p>

      <div class="actions">
        <button
          v-if="job.status === 'queued'"
          type="button"
          class="btn btn-danger"
          @click="cancelJob"
        >
          Cancel
        </button>
        <button
          v-if="job.status === 'failed'"
          type="button"
          class="btn btn-primary"
          @click="requeueJob"
        >
          Requeue
        </button>
      </div>
    </template>
  </div>
</template>
