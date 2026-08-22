<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useAuth } from '@/auth'
import { ApiError } from '@/api/client'

const auth = useAuth()
const router = useRouter()

const models = ref<string[]>([])
const runnerOnline = ref(false)
const model = ref('')
const prompt = ref('')
const systemPrompt = ref('')
const error = ref('')
const loading = ref(false)
const modelsLoading = ref(true)

async function loadModels() {
  const token = auth.getAccessToken()
  if (!token) return

  try {
    const res = await api.getModels(token)
    models.value = res.models
    runnerOnline.value = res.runner_online
    if (res.models.length && !model.value) {
      model.value = res.models[0]
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
  loading.value = true
  try {
    const job = await api.createJob(
      {
        model: model.value,
        prompt: prompt.value,
        system_prompt: systemPrompt.value || undefined,
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
    <h2>New text job</h2>

    <p
      class="runner-badge"
      :class="runnerOnline ? 'runner-online' : 'runner-offline'"
      style="display: inline-block; margin-bottom: 1rem"
    >
      Runner {{ runnerOnline ? 'online' : 'offline' }}
    </p>
    <p v-if="!runnerOnline" class="muted">
      The runner is offline. Jobs will queue until it comes back.
    </p>

    <form @submit.prevent="submit">
      <div class="form-group">
        <label for="model">Model</label>
        <select id="model" v-model="model" required :disabled="modelsLoading || models.length === 0">
          <option v-if="modelsLoading" value="">Loading models…</option>
          <option v-else-if="models.length === 0" value="">No models reported yet</option>
          <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
        </select>
        <p v-if="!modelsLoading && models.length === 0" class="muted">
          Start the runner with Ollama running to populate models.
        </p>
      </div>

      <div class="form-group">
        <label for="prompt">Prompt</label>
        <textarea id="prompt" v-model="prompt" required placeholder="Ask Ollama something…" />
      </div>

      <div class="form-group">
        <label for="system">System prompt (optional)</label>
        <textarea id="system" v-model="systemPrompt" placeholder="You are a helpful assistant." />
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <button
        type="submit"
        class="btn btn-primary"
        :disabled="loading || !model || !prompt"
      >
        {{ loading ? 'Submitting…' : 'Submit job' }}
      </button>
    </form>
  </div>
</template>
