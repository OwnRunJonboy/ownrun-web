<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useAuth } from '@/auth'
import { ApiError } from '@/api/client'

const PROJECT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

const auth = useAuth()
const router = useRouter()

const models = ref<string[]>([])
const profiles = ref<string[]>([])
const knownProjects = ref<string[]>([])
const runnerOnline = ref(false)
const model = ref('')
const profile = ref('workspace')
const projectMode = ref<'existing' | 'new'>('new')
const projectExisting = ref('')
const projectNew = ref('')
const prompt = ref('')
const systemPrompt = ref('')
const maxIterations = ref(8)
const showAdvanced = ref(false)
const error = ref('')
const loading = ref(false)
const modelsLoading = ref(true)

const needsProject = computed(() => profile.value === 'workspace' || profile.value === 'workspace_web')

const selectedProject = computed(() => {
  if (!needsProject.value) return ''
  if (projectMode.value === 'existing') return projectExisting.value.trim()
  return projectNew.value.trim()
})

const projectValid = computed(() => {
  if (!needsProject.value) return true
  const name = selectedProject.value
  return name !== '' && PROJECT_RE.test(name)
})

watch(needsProject, (needed) => {
  if (!needed) return
  if (knownProjects.value.length && !projectExisting.value) {
    projectExisting.value = knownProjects.value[0]
    projectMode.value = 'existing'
  }
})

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
    knownProjects.value = res.agent_projects ?? []
    if (knownProjects.value.length) {
      projectExisting.value = knownProjects.value[0]
      projectMode.value = 'existing'
    } else {
      projectMode.value = 'new'
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
  if (needsProject.value && !projectValid.value) {
    error.value =
      "Invalid project name: use 1–64 chars starting with a letter or digit; only letters, digits, '.', '_', and '-' allowed"
    return
  }

  loading.value = true
  try {
    const job = await api.createJob(
      {
        type: 'agent.task',
        model: model.value,
        prompt: prompt.value,
        profile: profile.value,
        project: needsProject.value ? selectedProject.value : undefined,
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
          <code>workspace</code> — files in a project ·
          <code>web</code> — public HTTP GET ·
          <code>workspace_web</code> — both
        </p>
      </div>

      <div v-if="needsProject" class="form-group">
        <label>Project</label>
        <div style="display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 0.5rem">
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
          required
          :disabled="knownProjects.length === 0"
        >
          <option v-if="knownProjects.length === 0" value="">No projects yet</option>
          <option v-for="p in knownProjects" :key="p" :value="p">{{ p }}</option>
        </select>
        <input
          v-else
          id="project-new"
          v-model="projectNew"
          type="text"
          required
          maxlength="64"
          pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}"
          placeholder="e.g. notes"
          autocomplete="off"
        />
        <p class="muted">
          Agent file tools only touch
          <code>~/ownrun-workspace/&lt;project&gt;/</code>.
          New names are created on the runner when the job starts.
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
        :disabled="loading || !model || !prompt || !profile || !projectValid"
      >
        {{ loading ? 'Submitting…' : 'Submit agent task' }}
      </button>
    </form>
  </div>
</template>
