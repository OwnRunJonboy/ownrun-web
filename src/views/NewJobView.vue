<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useAuth } from '@/auth'
import { ApiError } from '@/api/client'
import SystemPromptField from '@/components/SystemPromptField.vue'
import { unionProjects } from '@/composables/useSystemPrompts'

const PROJECT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

const auth = useAuth()
const router = useRouter()

const models = ref<string[]>([])
const knownProjects = ref<string[]>([])
const runnerOnline = ref(false)
const ollamaModelsStale = ref(false)
const model = ref('')
const prompt = ref('')
const systemPrompt = ref('')
const projectMode = ref<'none' | 'existing' | 'new'>('none')
const projectExisting = ref('')
const projectNew = ref('')
const error = ref('')
const loading = ref(false)
const modelsLoading = ref(true)

const selectedProject = computed(() => {
  if (projectMode.value === 'existing') return projectExisting.value.trim()
  if (projectMode.value === 'new') return projectNew.value.trim()
  return ''
})

const projectValid = computed(() => {
  if (projectMode.value === 'none') return true
  const name = selectedProject.value
  return name !== '' && PROJECT_RE.test(name)
})

async function loadModels() {
  const token = auth.getAccessToken()
  if (!token) return

  try {
    const [res, promptsRes] = await Promise.all([
      api.getModels(token),
      api.listSystemPrompts(token).catch(() => null),
    ])
    models.value = res.models
    runnerOnline.value = res.runner_online
    ollamaModelsStale.value = !!res.ollama_models_stale
    knownProjects.value = unionProjects(
      res.agent_projects ?? [],
      promptsRes?.project_defaults ?? [],
    )
    if (res.models.length && !model.value) {
      model.value = res.models[0]
    }
    if (knownProjects.value.length) {
      projectExisting.value = knownProjects.value[0]
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
  if (!projectValid.value) {
    error.value =
      "Invalid project name: use 1–64 chars starting with a letter or digit; only letters, digits, '.', '_', and '-' allowed"
    return
  }

  loading.value = true
  try {
    const job = await api.createJob(
      {
        model: model.value,
        prompt: prompt.value,
        system_prompt: systemPrompt.value || undefined,
        project: selectedProject.value || undefined,
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
    <p v-else-if="ollamaModelsStale" class="muted">
      Ollama model list may be stale (GPU is on Stable Diffusion).
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
        <label>Project (optional)</label>
        <div style="display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 0.5rem">
          <label style="display: flex; align-items: center; gap: 0.35rem; font-weight: normal">
            <input v-model="projectMode" type="radio" value="none" />
            None
          </label>
          <label style="display: flex; align-items: center; gap: 0.35rem; font-weight: normal">
            <input v-model="projectMode" type="radio" value="existing" :disabled="knownProjects.length === 0" />
            Existing
          </label>
          <label style="display: flex; align-items: center; gap: 0.35rem; font-weight: normal">
            <input v-model="projectMode" type="radio" value="new" />
            New
          </label>
        </div>
        <select
          v-if="projectMode === 'existing'"
          id="project-existing"
          v-model="projectExisting"
          :disabled="knownProjects.length === 0"
        >
          <option v-if="knownProjects.length === 0" value="">No projects yet</option>
          <option v-for="p in knownProjects" :key="p" :value="p">{{ p }}</option>
        </select>
        <input
          v-else-if="projectMode === 'new'"
          id="project-new"
          v-model="projectNew"
          type="text"
          maxlength="64"
          pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}"
          placeholder="e.g. notes"
          autocomplete="off"
        />
        <p class="muted">Label only — used for default system prompts, not file access.</p>
      </div>

      <div class="form-group">
        <label for="prompt">Prompt</label>
        <textarea id="prompt" v-model="prompt" required placeholder="Ask Ollama something…" />
      </div>

      <SystemPromptField v-model="systemPrompt" job-kind="chat" :project="selectedProject || undefined" />

      <p v-if="error" class="error">{{ error }}</p>

      <button
        type="submit"
        class="btn btn-primary"
        :disabled="loading || !model || !prompt || !projectValid"
      >
        {{ loading ? 'Submitting…' : 'Submit job' }}
      </button>
    </form>
  </div>
</template>
