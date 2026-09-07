<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, ApiError } from '@/api/client'
import { useAuth } from '@/auth'

const SIZE_PRESETS = [
  { label: '512 × 512', width: 512, height: 512 },
  { label: '768 × 768', width: 768, height: 768 },
  { label: '1024 × 1024', width: 1024, height: 1024 },
  { label: '1024 × 768', width: 1024, height: 768 },
  { label: '768 × 1024', width: 768, height: 1024 },
]

const auth = useAuth()
const router = useRouter()

const sdModels = ref<string[]>([])
const sdAvailable = ref(false)
const runnerOnline = ref(false)
const backendState = ref<string | null>(null)
const model = ref('')
const prompt = ref('')
const negativePrompt = ref('')
const sizeKey = ref('1024x1024')
const steps = ref(30)
const cfgScale = ref(7)
const seed = ref(-1)
const batchSize = ref(1)
const error = ref('')
const loading = ref(false)
const modelsLoading = ref(true)

const sizePreset = computed(() => {
  const found = SIZE_PRESETS.find((p) => `${p.width}x${p.height}` === sizeKey.value)
  return found ?? SIZE_PRESETS[2]
})

const backendHint = computed(() => {
  switch (backendState.value) {
    case 'switching':
      return 'Runner is switching GPU backends…'
    case 'active_sd':
      return 'GPU: Stable Diffusion'
    case 'active_ollama':
      return 'GPU: Ollama'
    case 'failed':
      return 'Backend gate failed — check runner logs'
    default:
      return ''
  }
})

async function loadModels() {
  const token = auth.getAccessToken()
  if (!token) return

  try {
    const res = await api.getModels(token)
    runnerOnline.value = res.runner_online
    sdAvailable.value = !!res.sd_available
    sdModels.value = res.sd_models ?? []
    backendState.value = res.backend_state ?? null
    if (sdModels.value.length && !model.value) {
      model.value = sdModels.value[0]
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load models'
  } finally {
    modelsLoading.value = false
  }
}

async function submit() {
  const token = auth.getAccessToken()
  if (!token) return

  error.value = ''
  if (!sdAvailable.value) {
    error.value = 'Stable Diffusion is not available on the runner'
    return
  }

  loading.value = true
  try {
    const job = await api.createJob(
      {
        type: 'stablediffusion.txt2img',
        prompt: prompt.value,
        negative_prompt: negativePrompt.value || undefined,
        model: model.value || undefined,
        width: sizePreset.value.width,
        height: sizePreset.value.height,
        steps: steps.value,
        cfg_scale: cfgScale.value,
        seed: seed.value,
        batch_size: batchSize.value,
      },
      token,
    )
    router.push(`/jobs/${job.id}`)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to create job'
  } finally {
    loading.value = false
  }
}

onMounted(loadModels)
</script>

<template>
  <div>
    <p><a href="#" @click.prevent="router.push('/')">← Jobs</a></p>
    <h2>New image job</h2>

    <p
      class="runner-badge"
      :class="runnerOnline ? 'runner-online' : 'runner-offline'"
      style="display: inline-block; margin-bottom: 0.5rem"
    >
      Runner {{ runnerOnline ? 'online' : 'offline' }}
    </p>
    <p v-if="backendHint" class="muted" style="margin-bottom: 1rem">{{ backendHint }}</p>
    <p v-if="!runnerOnline" class="muted">
      The runner is offline. Jobs will queue until it comes back.
    </p>
    <p v-else-if="!sdAvailable" class="error">
      Stable Diffusion is not configured on the runner. Set OWNRUN_SD_ENABLED=1 and the four
      start/stop script paths, then restart the runner.
    </p>

    <form v-if="sdAvailable" @submit.prevent="submit">
      <div class="form-group">
        <label for="sd-model">Checkpoint</label>
        <select
          id="sd-model"
          v-model="model"
          :disabled="modelsLoading || sdModels.length === 0"
        >
          <option v-if="modelsLoading" value="">Loading checkpoints…</option>
          <option v-else-if="sdModels.length === 0" value="">
            No checkpoints reported yet (will use Forge default)
          </option>
          <option v-for="m in sdModels" :key="m" :value="m">{{ m }}</option>
        </select>
        <p v-if="!modelsLoading && sdModels.length === 0" class="muted">
          Checkpoint list appears after the runner has started Forge at least once.
        </p>
      </div>

      <div class="form-group">
        <label for="prompt">Prompt</label>
        <textarea
          id="prompt"
          v-model="prompt"
          required
          maxlength="2048"
          placeholder="Describe the image…"
        />
      </div>

      <div class="form-group">
        <label for="negative">Negative prompt</label>
        <textarea
          id="negative"
          v-model="negativePrompt"
          maxlength="2048"
          placeholder="Optional — what to avoid"
        />
      </div>

      <div class="form-group">
        <label for="size">Size</label>
        <select id="size" v-model="sizeKey">
          <option
            v-for="p in SIZE_PRESETS"
            :key="`${p.width}x${p.height}`"
            :value="`${p.width}x${p.height}`"
          >
            {{ p.label }}
          </option>
        </select>
      </div>

      <div class="form-group">
        <label for="steps">Steps (1–50)</label>
        <input id="steps" v-model.number="steps" type="number" min="1" max="50" required />
      </div>

      <div class="form-group">
        <label for="cfg">CFG scale</label>
        <input
          id="cfg"
          v-model.number="cfgScale"
          type="number"
          min="1"
          max="30"
          step="0.5"
          required
        />
      </div>

      <div class="form-group">
        <label for="seed">Seed (−1 = random)</label>
        <input id="seed" v-model.number="seed" type="number" required />
      </div>

      <div class="form-group">
        <label for="batch">Batch size (1–4)</label>
        <input id="batch" v-model.number="batchSize" type="number" min="1" max="4" required />
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <button
        type="submit"
        class="btn btn-primary"
        :disabled="loading || !prompt.trim() || !runnerOnline"
      >
        {{ loading ? 'Submitting…' : 'Generate' }}
      </button>
    </form>
  </div>
</template>
