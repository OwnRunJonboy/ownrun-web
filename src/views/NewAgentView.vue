<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useAuth } from '@/auth'
import { ApiError } from '@/api/client'

const auth = useAuth()
const router = useRouter()

const models = ref<string[]>([])
const profiles = ref<string[]>([])
const runnerOnline = ref(false)
const model = ref('')
const profile = ref('workspace')
const prompt = ref('')
const systemPrompt = ref('')
const maxIterations = ref(8)
const showAdvanced = ref(false)
const error = ref('')
const loading = ref(false)
const modelsLoading = ref(true)

async function loadModels() {
  const token = auth.getAccessToken()
  if (!token) return

  try {
    const res = await api.getModels(token)
    runnerOnline.value = res.runner_online
    profiles.value = res.agent_profiles.length
      ? res.agent_profiles
      : ['workspace', 'web', 'workspace_web']
    if (!profiles.value.includes(profile.value)) {
      profile.value = profiles.value[0] || 'workspace'
    }
    models.value = res.agent_models.length ? res.agent_models : res.models
    if (models.value.length && !model.value) {
      model.value = models.value[0]
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
        type: 'agent.task',
        model: model.value,
        prompt: prompt.value,
        profile: profile.value,
        system_prompt: systemPrompt.value || undefined,
        max_tool_iterations: maxIterations.value,
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
    <h2>New agent task</h2>

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
    <p v-if="!modelsLoading && profiles.length === 0" class="muted">
      No agent profiles reported. Update and restart the runner with agent support.
    </p>

    <form @submit.prevent="submit">
      <div class="form-group">
        <label for="model">Model</label>
        <select id="model" v-model="model" required :disabled="modelsLoading || models.length === 0">
          <option v-if="modelsLoading" value="">Loading models…</option>
          <option v-else-if="models.length === 0" value="">No models reported yet</option>
          <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
        </select>
        <p class="muted">Prefer a tools-capable Ollama model (e.g. llama3.2, qwen2.5).</p>
      </div>

      <div class="form-group">
        <label for="profile">Profile</label>
        <select id="profile" v-model="profile" required>
          <option v-for="p in profiles" :key="p" :value="p">{{ p }}</option>
        </select>
        <p class="muted">
          <code>workspace</code> — files in the runner sandbox ·
          <code>web</code> — public HTTP GET ·
          <code>workspace_web</code> — both
        </p>
      </div>

      <div class="form-group">
        <label for="prompt">Task</label>
        <textarea
          id="prompt"
          v-model="prompt"
          required
          placeholder="Read notes.md and draft a summary in summary.md"
        />
      </div>

      <div class="form-group">
        <label for="system">System prompt (optional)</label>
        <textarea id="system" v-model="systemPrompt" placeholder="Extra instructions for the agent…" />
      </div>

      <p>
        <a href="#" class="muted" @click.prevent="showAdvanced = !showAdvanced">
          {{ showAdvanced ? 'Hide' : 'Show' }} advanced
        </a>
      </p>
      <div v-if="showAdvanced" class="form-group">
        <label for="iters">Max tool iterations (1–20)</label>
        <input id="iters" v-model.number="maxIterations" type="number" min="1" max="20" />
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <button
        type="submit"
        class="btn btn-primary"
        :disabled="loading || !model || !prompt || !profile"
      >
        {{ loading ? 'Submitting…' : 'Submit agent task' }}
      </button>
    </form>
  </div>
</template>
