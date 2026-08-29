<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, ApiError, type ProjectPromptDefaults, type SystemPrompt, type SystemPromptAppliesTo } from '@/api/client'
import { useAuth } from '@/auth'
import { promptAppliesTo, unionProjects } from '@/composables/useSystemPrompts'

const PROJECT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
const EXCERPT_LEN = 120

const auth = useAuth()

const prompts = ref<SystemPrompt[]>([])
const defaults = ref({ chat_prompt_id: null as number | null, agent_prompt_id: null as number | null })
const projectDefaults = ref<ProjectPromptDefaults[]>([])
const knownProjects = ref<string[]>([])

const loading = ref(true)
const error = ref('')
const actionError = ref('')

const formOpen = ref(false)
const editingId = ref<number | null>(null)
const formName = ref('')
const formBody = ref('')
const formAppliesTo = ref<SystemPromptAppliesTo>('both')
const formSaving = ref(false)

const addProjectMode = ref<'existing' | 'new'>('new')
const addProjectExisting = ref('')
const addProjectNew = ref('')
const extraProjects = ref<string[]>([])

const allProjects = computed(() =>
  unionProjects(knownProjects.value, projectDefaults.value).concat(
    extraProjects.value.filter((p) => !unionProjects(knownProjects.value, projectDefaults.value).includes(p)),
  ),
)

function excerpt(body: string): string {
  const text = body.replace(/\s+/g, ' ').trim()
  if (text.length <= EXCERPT_LEN) return text
  return text.slice(0, EXCERPT_LEN) + '…'
}

function chatOptions() {
  return prompts.value.filter((p) => promptAppliesTo('chat', p.applies_to))
}

function agentOptions() {
  return prompts.value.filter((p) => promptAppliesTo('agent', p.applies_to))
}

function projectRow(project: string): ProjectPromptDefaults {
  return (
    projectDefaults.value.find((r) => r.project === project) ?? {
      project,
      chat_prompt_id: null,
      agent_prompt_id: null,
    }
  )
}

async function load() {
  const token = auth.getAccessToken()
  if (!token) return
  loading.value = true
  error.value = ''
  try {
    const [bundle, models] = await Promise.all([
      api.listSystemPrompts(token),
      api.getModels(token).catch(() => null),
    ])
    prompts.value = bundle.prompts
    defaults.value = bundle.defaults
    projectDefaults.value = bundle.project_defaults
    knownProjects.value = models?.agent_projects ?? []
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load prompts'
  } finally {
    loading.value = false
  }
}

function openNew() {
  editingId.value = null
  formName.value = ''
  formBody.value = ''
  formAppliesTo.value = 'both'
  formOpen.value = true
  actionError.value = ''
}

function openEdit(prompt: SystemPrompt) {
  editingId.value = prompt.id
  formName.value = prompt.name
  formBody.value = prompt.body
  formAppliesTo.value = prompt.applies_to
  formOpen.value = true
  actionError.value = ''
}

function closeForm() {
  formOpen.value = false
  editingId.value = null
}

async function saveForm() {
  const token = auth.getAccessToken()
  if (!token) return
  formSaving.value = true
  actionError.value = ''
  try {
    const payload = {
      name: formName.value,
      body: formBody.value,
      applies_to: formAppliesTo.value,
    }
    if (editingId.value) {
      await api.updateSystemPrompt(editingId.value, payload, token)
    } else {
      await api.createSystemPrompt(payload, token)
    }
    closeForm()
    await load()
  } catch (e) {
    actionError.value = e instanceof ApiError ? e.message : 'Failed to save prompt'
  } finally {
    formSaving.value = false
  }
}

async function deletePrompt(prompt: SystemPrompt) {
  if (!window.confirm(`Delete “${prompt.name}”?`)) return
  const token = auth.getAccessToken()
  if (!token) return
  actionError.value = ''
  try {
    await api.deleteSystemPrompt(prompt.id, token)
    await load()
  } catch (e) {
    actionError.value = e instanceof ApiError ? e.message : 'Failed to delete prompt'
  }
}

async function setGlobalDefault(slot: 'chat_prompt_id' | 'agent_prompt_id', id: number | null) {
  const token = auth.getAccessToken()
  if (!token) return
  actionError.value = ''
  try {
    const res = await api.setSystemPromptDefaults({ [slot]: id }, token)
    defaults.value = res
    await load()
  } catch (e) {
    actionError.value = e instanceof ApiError ? e.message : 'Failed to update default'
  }
}

async function setProjectDefault(
  project: string,
  slot: 'chat_prompt_id' | 'agent_prompt_id',
  id: number | null,
) {
  const token = auth.getAccessToken()
  if (!token) return
  actionError.value = ''
  try {
    await api.setProjectPromptDefaults(project, { [slot]: id }, token)
    await load()
  } catch (e) {
    actionError.value = e instanceof ApiError ? e.message : 'Failed to update project default'
  }
}

async function addProjectRow() {
  const name =
    addProjectMode.value === 'existing'
      ? addProjectExisting.value.trim()
      : addProjectNew.value.trim()
  if (!name || !PROJECT_RE.test(name)) {
    actionError.value =
      "Invalid project name: use 1–64 chars starting with a letter or digit; only letters, digits, '.', '_', and '-' allowed"
    return
  }
  if (allProjects.value.includes(name)) {
    actionError.value = 'That project is already listed'
    return
  }
  extraProjects.value.push(name)
  addProjectNew.value = ''
  actionError.value = ''
}

async function removeProjectDefaults(project: string) {
  if (!projectDefaults.value.some((r) => r.project === project)) {
    extraProjects.value = extraProjects.value.filter((p) => p !== project)
    return
  }
  if (!window.confirm(`Remove defaults for project “${project}”?`)) return
  const token = auth.getAccessToken()
  if (!token) return
  actionError.value = ''
  try {
    await api.deleteProjectPromptDefaults(project, token)
    await load()
  } catch (e) {
    actionError.value = e instanceof ApiError ? e.message : 'Failed to remove project defaults'
  }
}

function toggleDefault(slot: 'chat_prompt_id' | 'agent_prompt_id', prompt: SystemPrompt) {
  const current = defaults.value[slot]
  void setGlobalDefault(slot, current === prompt.id ? null : prompt.id)
}

onMounted(load)
</script>

<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem">
      <h2 style="margin: 0">Prompts</h2>
      <button type="button" class="btn btn-primary" @click="openNew">New prompt</button>
    </div>

    <p v-if="loading" class="muted">Loading…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-if="actionError" class="error">{{ actionError }}</p>

    <section v-if="!loading && !error" class="card" style="margin-bottom: 1rem">
      <h3 style="margin-top: 0; font-size: 1rem">Global defaults</h3>
      <div class="form-group">
        <label for="global-chat">Chat default</label>
        <select
          id="global-chat"
          :value="defaults.chat_prompt_id ?? ''"
          @change="setGlobalDefault('chat_prompt_id', ($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : null)"
        >
          <option value="">None</option>
          <option v-for="p in chatOptions()" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div class="form-group">
        <label for="global-agent">Agent default</label>
        <select
          id="global-agent"
          :value="defaults.agent_prompt_id ?? ''"
          @change="setGlobalDefault('agent_prompt_id', ($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : null)"
        >
          <option value="">None</option>
          <option v-for="p in agentOptions()" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
    </section>

    <section v-if="!loading && !error" class="card" style="margin-bottom: 1rem">
      <h3 style="margin-top: 0; font-size: 1rem">Per-project defaults</h3>

      <div
        v-for="proj in allProjects"
        :key="proj"
        class="card"
        style="margin-bottom: 0.75rem; padding: 0.75rem"
      >
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem">
          <strong>{{ proj }}</strong>
          <button
            v-if="projectDefaults.some((r) => r.project === proj) || extraProjects.includes(proj)"
            type="button"
            class="btn btn-danger"
            style="font-size: 0.85rem"
            @click="removeProjectDefaults(proj)"
          >
            Remove
          </button>
        </div>
        <div class="form-group" style="margin-top: 0.5rem">
          <label :for="`proj-chat-${proj}`">Chat</label>
          <select
            :id="`proj-chat-${proj}`"
            :value="projectRow(proj).chat_prompt_id ?? ''"
            @change="setProjectDefault(proj, 'chat_prompt_id', ($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : null)"
          >
            <option value="">None</option>
            <option v-for="p in chatOptions()" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div class="form-group">
          <label :for="`proj-agent-${proj}`">Agent</label>
          <select
            :id="`proj-agent-${proj}`"
            :value="projectRow(proj).agent_prompt_id ?? ''"
            @change="setProjectDefault(proj, 'agent_prompt_id', ($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : null)"
          >
            <option value="">None</option>
            <option v-for="p in agentOptions()" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
      </div>

      <p v-if="allProjects.length === 0" class="muted">No projects yet. Add one below or run an agent task.</p>

      <div style="margin-top: 1rem; border-top: 1px solid var(--border, #333); padding-top: 1rem">
        <label>Add project</label>
        <div style="display: flex; flex-wrap: wrap; gap: 1rem; margin: 0.5rem 0">
          <label style="display: flex; align-items: center; gap: 0.35rem; font-weight: normal">
            <input v-model="addProjectMode" type="radio" value="existing" :disabled="knownProjects.length === 0" />
            Existing
          </label>
          <label style="display: flex; align-items: center; gap: 0.35rem; font-weight: normal">
            <input v-model="addProjectMode" type="radio" value="new" />
            New
          </label>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center">
          <select
            v-if="addProjectMode === 'existing'"
            v-model="addProjectExisting"
            :disabled="knownProjects.length === 0"
          >
            <option v-if="knownProjects.length === 0" value="">No projects yet</option>
            <option v-for="p in knownProjects" :key="p" :value="p">{{ p }}</option>
          </select>
          <input
            v-else
            v-model="addProjectNew"
            type="text"
            maxlength="64"
            placeholder="e.g. blog"
            autocomplete="off"
          />
          <button type="button" class="btn" @click="addProjectRow">Add</button>
        </div>
      </div>
    </section>

    <section v-if="!loading && !error">
      <h3 style="font-size: 1rem">Library</h3>
      <p v-if="prompts.length === 0" class="muted">No saved prompts yet.</p>

      <article
        v-for="prompt in prompts"
        :key="prompt.id"
        class="card"
        style="margin-bottom: 0.75rem"
      >
        <div style="display: flex; justify-content: space-between; gap: 1rem; align-items: start">
          <div>
            <strong>{{ prompt.name }}</strong>
            <span class="job-type" style="margin-left: 0.5rem">{{ prompt.applies_to }}</span>
            <p class="muted" style="margin: 0.35rem 0 0; white-space: pre-wrap">{{ excerpt(prompt.body) }}</p>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.35rem; align-items: flex-end">
            <button type="button" class="btn" @click="openEdit(prompt)">Edit</button>
            <button type="button" class="btn btn-danger" @click="deletePrompt(prompt)">Delete</button>
          </div>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.75rem">
          <button
            v-if="promptAppliesTo('chat', prompt.applies_to)"
            type="button"
            class="btn"
            :class="{ 'btn-primary': defaults.chat_prompt_id === prompt.id }"
            @click="toggleDefault('chat_prompt_id', prompt)"
          >
            {{ defaults.chat_prompt_id === prompt.id ? 'Chat default ✓' : 'Set as default chat' }}
          </button>
          <button
            v-if="promptAppliesTo('agent', prompt.applies_to)"
            type="button"
            class="btn"
            :class="{ 'btn-primary': defaults.agent_prompt_id === prompt.id }"
            @click="toggleDefault('agent_prompt_id', prompt)"
          >
            {{ defaults.agent_prompt_id === prompt.id ? 'Agent default ✓' : 'Set as default agent' }}
          </button>
        </div>
      </article>
    </section>

    <div v-if="formOpen" class="card" style="margin-top: 1.5rem">
      <h3 style="margin-top: 0">{{ editingId ? 'Edit prompt' : 'New prompt' }}</h3>
      <form @submit.prevent="saveForm">
        <div class="form-group">
          <label for="prompt-name">Name</label>
          <input id="prompt-name" v-model="formName" type="text" required maxlength="80" />
        </div>
        <div class="form-group">
          <label for="prompt-applies">Applies to</label>
          <select id="prompt-applies" v-model="formAppliesTo">
            <option value="both">Chat and agent</option>
            <option value="chat">Chat only</option>
            <option value="agent">Agent only</option>
          </select>
        </div>
        <div class="form-group">
          <label for="prompt-body">Body</label>
          <textarea id="prompt-body" v-model="formBody" required rows="8" />
        </div>
        <div class="actions">
          <button type="submit" class="btn btn-primary" :disabled="formSaving">
            {{ formSaving ? 'Saving…' : 'Save' }}
          </button>
          <button type="button" class="btn" @click="closeForm">Cancel</button>
        </div>
      </form>
    </div>
  </div>
</template>
