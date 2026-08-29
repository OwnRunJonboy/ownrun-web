<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import {
  ApiError,
  saveSystemPrompt,
  useSystemPromptField,
  useSystemPromptLibrary,
  type PromptJobKind,
} from '@/composables/useSystemPrompts'
import type { SystemPrompt } from '@/api/client'

const props = defineProps<{
  jobKind: PromptJobKind
  project?: string
}>()

const systemPrompt = defineModel<string>({ required: true })

const library = useSystemPromptLibrary(props.jobKind)
const projectRef = toRef(() => props.project?.trim() ?? '')
const field = useSystemPromptField(props.jobKind, systemPrompt, projectRef, library)

const selectedLoadId = field.selectedLoadId
const filteredPrompts = computed(() => library.filteredPrompts.value)
const promptsLoading = computed(() => library.loading.value)
const promptsError = computed(() => library.error.value)
const autoFillSource = computed(() => field.autoFillSource.value)
const showApplyDefault = computed(() => field.showApplyDefault.value)
const applyDefaultLabel = computed(() => field.applyDefaultLabel.value)

const saveName = ref('')
const saveAsGlobal = ref(false)
const saveAsProject = ref(false)
const saveError = ref('')
const saveOk = ref('')
const saving = ref(false)

async function init() {
  await library.load()
  field.applyDefault(false)
}

function onInput() {
  field.markDirty()
}

async function saveCurrent() {
  const name = saveName.value.trim()
  const body = systemPrompt.value.trim()
  if (!name || !body) {
    saveError.value = 'Name and system prompt text are required to save'
    return
  }
  saveError.value = ''
  saveOk.value = ''
  saving.value = true
  try {
    const appliesTo: SystemPrompt['applies_to'] = props.jobKind === 'chat' ? 'chat' : 'agent'
    await saveSystemPrompt(name, body, appliesTo, {
      setGlobalDefault: saveAsGlobal.value,
      setProjectDefault: saveAsProject.value && !!props.project?.trim(),
      project: props.project?.trim(),
      jobKind: props.jobKind,
    })
    saveOk.value = 'Saved'
    saveName.value = ''
    saveAsGlobal.value = false
    saveAsProject.value = false
    await library.load()
  } catch (e) {
    saveError.value = e instanceof ApiError ? e.message : 'Failed to save prompt'
  } finally {
    saving.value = false
  }
}

void init()
</script>

<template>
  <div class="form-group">
    <label for="system">System prompt (optional)</label>

    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center">
      <select
        v-model="selectedLoadId"
        :disabled="promptsLoading || filteredPrompts.length === 0"
        @change="field.loadSelectedPrompt()"
      >
        <option value="">Load saved…</option>
        <option v-for="p in filteredPrompts" :key="p.id" :value="String(p.id)">
          {{ p.name }}
        </option>
      </select>
      <button
        v-if="showApplyDefault"
        type="button"
        class="btn"
        @click="field.applyDefault(true)"
      >
        {{ applyDefaultLabel }}
      </button>
    </div>

    <textarea
      id="system"
      :value="systemPrompt"
      :placeholder="jobKind === 'chat' ? 'You are a helpful assistant.' : 'Extra instructions for the agent…'"
      @input="systemPrompt = ($event.target as HTMLTextAreaElement).value; onInput()"
    />

    <p v-if="autoFillSource" class="muted" style="margin-top: 0.35rem">
      Using default for {{ autoFillSource }}
    </p>
    <p v-if="promptsError" class="error">{{ promptsError }}</p>

    <div class="prompt-save-as" style="margin-top: 0.75rem">
      <label class="muted" style="display: block; margin-bottom: 0.35rem">Save as…</label>
      <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center">
        <input
          v-model="saveName"
          type="text"
          maxlength="80"
          placeholder="Prompt name"
          autocomplete="off"
          style="flex: 1; min-width: 10rem"
        />
        <button type="button" class="btn" :disabled="saving" @click="saveCurrent">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 0.5rem">
        <label style="display: flex; align-items: center; gap: 0.35rem; font-weight: normal">
          <input v-model="saveAsGlobal" type="checkbox" />
          Set as global {{ jobKind }} default
        </label>
        <label
          v-if="project?.trim()"
          style="display: flex; align-items: center; gap: 0.35rem; font-weight: normal"
        >
          <input v-model="saveAsProject" type="checkbox" />
          Set as default for project {{ project }}
        </label>
      </div>
      <p v-if="saveError" class="error" style="margin-top: 0.35rem">{{ saveError }}</p>
      <p v-if="saveOk" class="muted" style="margin-top: 0.35rem">{{ saveOk }}</p>
    </div>
  </div>
</template>
