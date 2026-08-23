<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { api, type ChatMessage, type Job } from '@/api/client'
import { useAuth } from '@/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuth()

const job = ref<Job | null>(null)
const error = ref('')
const actionError = ref('')
const loading = ref(true)
const continuePrompt = ref('')
const continuing = ref(false)

let timer: ReturnType<typeof setInterval> | null = null

const jobId = () => Number(route.params.id)

const systemPrompt = computed(() => {
  const current = job.value
  if (!current) return ''
  if (current.request.system_prompt) return current.request.system_prompt
  const first = current.request.messages?.[0]
  return first?.role === 'system' ? first.content : ''
})

const turns = computed((): ChatMessage[] => {
  const current = job.value
  if (!current) return []

  const history = current.request.messages?.length
    ? current.request.messages.filter((m) => m.role === 'user' || m.role === 'assistant')
    : [{ role: 'user', content: current.request.prompt }]

  if (current.status === 'succeeded' && current.result?.text != null) {
    return [...history, { role: 'assistant', content: current.result.text }]
  }
  return history
})

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

async function continueChat() {
  const token = auth.getAccessToken()
  if (!token || !job.value) return
  const prompt = continuePrompt.value.trim()
  if (!prompt) return

  actionError.value = ''
  continuing.value = true
  try {
    const next = await api.continueJob(job.value.id, prompt, token)
    continuePrompt.value = ''
    await router.push(`/jobs/${next.id}`)
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Continue failed'
  } finally {
    continuing.value = false
  }
}

function formatTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function resetAndLoad() {
  loading.value = true
  job.value = null
  error.value = ''
  actionError.value = ''
  continuePrompt.value = ''
  load()
}

onMounted(() => {
  load()
  timer = setInterval(() => {
    if (job.value?.status === 'queued' || job.value?.status === 'running') {
      load()
    }
  }, 4000)
})

watch(() => route.params.id, resetAndLoad)

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

      <p v-if="job.request.parent_job_id" class="muted">
        Continued from
        <RouterLink :to="`/jobs/${job.request.parent_job_id}`">
          job #{{ job.request.parent_job_id }}
        </RouterLink>
      </p>

      <div class="card">
        <p><strong>Model:</strong> {{ job.request.model }}</p>
        <p v-if="systemPrompt" class="muted" style="white-space: pre-wrap">
          <strong>System:</strong> {{ systemPrompt }}
        </p>
      </div>

      <div class="chat">
        <div
          v-for="(turn, index) in turns"
          :key="index"
          class="chat-turn"
          :class="`chat-turn-${turn.role}`"
        >
          <div class="chat-role">{{ turn.role }}</div>
          <div class="chat-body">{{ turn.content }}</div>
        </div>
        <p
          v-if="job.status === 'queued' || job.status === 'running'"
          class="muted"
        >
          Waiting for the runner…
        </p>
      </div>

      <dl class="muted" style="display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem">
        <dt>Created</dt><dd>{{ formatTime(job.created_at) }}</dd>
        <dt>Queued</dt><dd>{{ formatTime(job.queued_at) }}</dd>
        <dt>Started</dt><dd>{{ formatTime(job.claimed_at) }}</dd>
        <dt>Finished</dt><dd>{{ formatTime(job.finished_at) }}</dd>
      </dl>

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

      <form
        v-if="job.status === 'succeeded'"
        class="continue-form"
        @submit.prevent="continueChat"
      >
        <div class="form-group">
          <label for="continue">Continue this chat</label>
          <textarea
            id="continue"
            v-model="continuePrompt"
            required
            placeholder="Send a follow-up…"
          />
        </div>
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="continuing || !continuePrompt.trim()"
        >
          {{ continuing ? 'Submitting…' : 'Continue chat' }}
        </button>
      </form>
    </template>
  </div>
</template>
