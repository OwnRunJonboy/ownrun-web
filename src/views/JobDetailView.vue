<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  api,
  type AgentResult,
  type ChatMessage,
  type ImageJobResult,
  type Job,
  type TraceStep,
} from '@/api/client'
import { useAuth } from '@/auth'
import { ApiError, saveSystemPrompt } from '@/composables/useSystemPrompts'

const PHASE_LABELS: Record<string, string> = {
  stopping_ollama: 'Stopping Ollama…',
  starting_stable_diffusion: 'Starting Stable Diffusion…',
  stopping_stable_diffusion: 'Stopping Stable Diffusion…',
  starting_ollama: 'Starting Ollama…',
  generating: 'Generating image…',
  uploading: 'Uploading image…',
}

const route = useRoute()
const router = useRouter()
const auth = useAuth()

const job = ref<Job | null>(null)
const error = ref('')
const actionError = ref('')
const loading = ref(true)
const continuePrompt = ref('')
const continuing = ref(false)
const savePromptName = ref('')
const savePromptError = ref('')
const savePromptOk = ref('')
const savingPrompt = ref(false)
const showSavePrompt = ref(false)
const imageUrls = ref<Record<number, string>>({})
const lightboxId = ref<number | null>(null)

let timer: ReturnType<typeof setInterval> | null = null

const jobId = () => Number(route.params.id)

const isAgent = computed(() => job.value?.type === 'agent.task')
const isImage = computed(() => job.value?.type === 'stablediffusion.txt2img')

const typeLabel = computed(() => {
  if (isAgent.value) return 'agent'
  if (isImage.value) return 'image'
  return 'chat'
})

const systemPrompt = computed(() => {
  const current = job.value
  if (!current || isImage.value) return ''
  if (current.request.system_prompt) return current.request.system_prompt
  const first = current.request.messages?.[0]
  return first?.role === 'system' ? first.content : ''
})

const agentPayload = computed((): AgentResult | null => {
  const current = job.value
  if (!current || !isAgent.value) return null
  if (current.status === 'running' || current.status === 'queued') {
    return (current.progress as AgentResult | null) || (current.result as AgentResult | null)
  }
  return (current.result as AgentResult | null) || (current.progress as AgentResult | null)
})

const imageResult = computed((): ImageJobResult | null => {
  const current = job.value
  if (!current || !isImage.value) return null
  return (current.result as ImageJobResult | null) || null
})

const progressPhase = computed(() => {
  const p = job.value?.progress as { phase?: string } | null
  return p?.phase ? PHASE_LABELS[p.phase] || p.phase : ''
})

const trace = computed((): TraceStep[] => agentPayload.value?.trace ?? [])

const turns = computed((): ChatMessage[] => {
  const current = job.value
  if (!current || isAgent.value || isImage.value) return []

  const history = current.request.messages?.length
    ? current.request.messages.filter((m) => m.role === 'user' || m.role === 'assistant')
    : [{ role: 'user', content: current.request.prompt }]

  if (current.status === 'succeeded' && current.result && 'text' in current.result && current.result.text != null) {
    return [...history, { role: 'assistant', content: current.result.text }]
  }
  return history
})

function formatArgs(args: Record<string, unknown> | undefined) {
  if (!args) return ''
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

function revokeImageUrls() {
  for (const url of Object.values(imageUrls.value)) {
    URL.revokeObjectURL(url)
  }
  imageUrls.value = {}
}

async function loadImages(current: Job) {
  const token = auth.getAccessToken()
  if (!token || current.type !== 'stablediffusion.txt2img') return
  const result = current.result as ImageJobResult | null
  const images = result?.images || []
  if (!images.length) return

  const next: Record<number, string> = { ...imageUrls.value }
  for (const img of images) {
    if (next[img.artifact_id]) continue
    try {
      const blob = await api.fetchArtifactBlob(current.id, img.artifact_id, token)
      next[img.artifact_id] = URL.createObjectURL(blob)
    } catch (e) {
      console.warn('Failed to load artifact', img.artifact_id, e)
    }
  }
  imageUrls.value = next
}

async function downloadImage(artifactId: number, filename: string) {
  const token = auth.getAccessToken()
  if (!token || !job.value) return
  try {
    const blob = await api.fetchArtifactBlob(job.value.id, artifactId, token)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Download failed'
  }
}

async function load() {
  const token = auth.getAccessToken()
  if (!token) return

  try {
    job.value = await api.getJob(jobId(), token)
    error.value = ''
    if (job.value?.type === 'stablediffusion.txt2img' && job.value.status === 'succeeded') {
      await loadImages(job.value)
    }
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

async function savePromptToLibrary() {
  const name = savePromptName.value.trim()
  const body = systemPrompt.value.trim()
  if (!name || !body) {
    savePromptError.value = 'Name is required'
    return
  }
  savePromptError.value = ''
  savePromptOk.value = ''
  savingPrompt.value = true
  try {
    const applies = isAgent.value ? 'agent' : 'chat'
    await saveSystemPrompt(name, body, applies === 'agent' ? 'agent' : 'chat')
    savePromptOk.value = 'Saved to library'
    savePromptName.value = ''
    showSavePrompt.value = false
  } catch (e) {
    savePromptError.value = e instanceof ApiError ? e.message : 'Failed to save prompt'
  } finally {
    savingPrompt.value = false
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
  lightboxId.value = null
  revokeImageUrls()
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
  revokeImageUrls()
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
        <span class="job-type">{{ typeLabel }}</span>
        <span class="status" :class="`status-${job.status}`">{{ job.status }}</span>
      </h2>

      <p v-if="job.request.parent_job_id" class="muted">
        Continued from
        <RouterLink :to="`/jobs/${job.request.parent_job_id}`">
          job #{{ job.request.parent_job_id }}
        </RouterLink>
      </p>

      <div class="card">
        <p v-if="job.request.model"><strong>Model:</strong> {{ job.request.model }}</p>
        <p v-if="job.request.profile"><strong>Profile:</strong> {{ job.request.profile }}</p>
        <p v-if="job.request.project"><strong>Project:</strong> {{ job.request.project }}</p>
        <p v-if="job.request.max_tool_iterations != null" class="muted">
          Max tool iterations: {{ job.request.max_tool_iterations }}
        </p>
        <p
          v-if="isAgent && (job.request.profile === 'web' || job.request.profile === 'workspace_web')"
          class="muted"
        >
          HTTP fetch: {{ job.request.allow_http_fetch ? 'allowed' : 'off' }}
        </p>
        <template v-if="isImage">
          <p style="white-space: pre-wrap"><strong>Prompt:</strong> {{ job.request.prompt }}</p>
          <p v-if="job.request.negative_prompt" class="muted" style="white-space: pre-wrap">
            <strong>Negative:</strong> {{ job.request.negative_prompt }}
          </p>
          <p class="muted">
            {{ job.request.width }}×{{ job.request.height }}
            · {{ job.request.steps }} steps
            · CFG {{ job.request.cfg_scale }}
            · seed {{ job.request.seed }}
            · batch {{ job.request.batch_size }}
          </p>
          <p v-if="imageResult?.duration_ms != null" class="muted">
            Generate {{ imageResult.duration_ms }} ms
            <template v-if="imageResult.backend_switch_ms">
              · switch {{ imageResult.backend_switch_ms }} ms
            </template>
          </p>
        </template>
        <p v-if="agentPayload?.stop_reason && agentPayload.stop_reason !== 'completed'" class="muted">
          Stopped: {{ agentPayload.stop_reason }}
          <template v-if="agentPayload.iterations != null">
            · {{ agentPayload.iterations }} tool call(s)
          </template>
        </p>
        <p v-if="systemPrompt" class="muted" style="white-space: pre-wrap">
          <strong>System:</strong> {{ systemPrompt }}
        </p>
        <div v-if="systemPrompt" style="margin-top: 0.5rem">
          <button
            v-if="!showSavePrompt"
            type="button"
            class="btn"
            @click="showSavePrompt = true"
          >
            Save to library
          </button>
          <div v-else class="prompt-save-as">
            <input
              v-model="savePromptName"
              type="text"
              maxlength="80"
              placeholder="Prompt name"
              autocomplete="off"
              style="margin-right: 0.5rem"
            />
            <button type="button" class="btn" :disabled="savingPrompt" @click="savePromptToLibrary">
              {{ savingPrompt ? 'Saving…' : 'Save' }}
            </button>
            <button type="button" class="btn" @click="showSavePrompt = false">Cancel</button>
            <p v-if="savePromptError" class="error" style="margin-top: 0.35rem">{{ savePromptError }}</p>
            <p v-if="savePromptOk" class="muted" style="margin-top: 0.35rem">{{ savePromptOk }}</p>
          </div>
        </div>
      </div>

      <!-- Image gallery -->
      <div v-if="isImage" class="image-job">
        <p
          v-if="job.status === 'queued' || job.status === 'running'"
          class="muted"
        >
          {{ progressPhase || 'Waiting for the runner…' }}
        </p>
        <div v-if="imageResult?.images?.length" class="image-gallery">
          <figure
            v-for="img in imageResult.images"
            :key="img.artifact_id"
            class="image-thumb"
          >
            <button
              v-if="imageUrls[img.artifact_id]"
              type="button"
              class="image-thumb-btn"
              @click="lightboxId = img.artifact_id"
            >
              <img :src="imageUrls[img.artifact_id]" :alt="img.filename" />
            </button>
            <p v-else class="muted">Loading {{ img.filename }}…</p>
            <figcaption>
              <button
                type="button"
                class="btn"
                @click="downloadImage(img.artifact_id, img.filename)"
              >
                Download
              </button>
            </figcaption>
          </figure>
        </div>
        <div
          v-if="lightboxId != null && imageUrls[lightboxId]"
          class="image-lightbox"
          @click.self="lightboxId = null"
        >
          <img :src="imageUrls[lightboxId]" alt="" />
        </div>
      </div>

      <!-- Chat transcript -->
      <div v-else-if="!isAgent" class="chat">
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

      <!-- Agent trace -->
      <div v-else class="trace">
        <h3 style="font-size: 1rem; margin: 1rem 0 0.5rem">Trace</h3>
        <div
          v-for="(step, index) in trace"
          :key="index"
          class="trace-step"
          :class="`trace-${step.kind}`"
        >
          <div class="chat-role">
            <template v-if="step.kind === 'tool_call'">tool · {{ step.name }}</template>
            <template v-else-if="step.kind === 'tool_result'">
              result · {{ step.name }}
              <span v-if="step.ok === false" class="error"> (error)</span>
            </template>
            <template v-else-if="step.kind === 'user'">user</template>
            <template v-else>{{ step.source || 'assistant' }}</template>
          </div>
          <div class="chat-body">
            <pre v-if="step.kind === 'tool_call'" class="trace-args">{{ formatArgs(step.args) }}</pre>
            <template v-else>{{ step.content }}</template>
          </div>
        </div>
        <p
          v-if="(job.status === 'queued' || job.status === 'running') && trace.length === 0"
          class="muted"
        >
          Waiting for the runner…
        </p>
        <div v-if="agentPayload?.text && job.status === 'succeeded'" class="result-text" style="margin-top: 1rem">
          <strong>Final answer</strong>
          <div style="margin-top: 0.5rem">{{ agentPayload.text }}</div>
        </div>
        <p v-if="agentPayload?.trace_truncated" class="muted">Trace was truncated to fit storage limits.</p>
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
          v-if="job.status === 'queued' || job.status === 'running'"
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
        v-if="job.status === 'succeeded' && !isImage"
        class="continue-form"
        @submit.prevent="continueChat"
      >
        <div class="form-group">
          <label for="continue">{{ isAgent ? 'Continue this task' : 'Continue this chat' }}</label>
          <textarea
            id="continue"
            v-model="continuePrompt"
            required
            :placeholder="isAgent ? 'Send a follow-up task…' : 'Send a follow-up…'"
          />
        </div>
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="continuing || !continuePrompt.trim()"
        >
          {{ continuing ? 'Submitting…' : isAgent ? 'Continue task' : 'Continue chat' }}
        </button>
      </form>
    </template>
  </div>
</template>
