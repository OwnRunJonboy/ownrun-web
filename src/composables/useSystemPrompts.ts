import { computed, ref, watch, type Ref } from 'vue'
import { api, ApiError, type ProjectPromptDefaults, type SystemPrompt, type SystemPromptBundle } from '@/api/client'
import { useAuth } from '@/auth'

export type PromptJobKind = 'chat' | 'agent'

export function promptAppliesTo(kind: PromptJobKind, appliesTo: SystemPrompt['applies_to']): boolean {
  if (appliesTo === 'both') return true
  return appliesTo === kind
}

export function useSystemPromptLibrary(jobKind: PromptJobKind) {
  const auth = useAuth()
  const bundle = ref<SystemPromptBundle | null>(null)
  const loading = ref(false)
  const error = ref('')

  const prompts = computed(() => bundle.value?.prompts ?? [])
  const filteredPrompts = computed(() =>
    prompts.value.filter((p) => promptAppliesTo(jobKind, p.applies_to)),
  )

  async function load() {
    const token = auth.getAccessToken()
    if (!token) return
    loading.value = true
    error.value = ''
    try {
      bundle.value = await api.listSystemPrompts(token)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load prompts'
    } finally {
      loading.value = false
    }
  }

  function bodyForDefault(project: string | null): { body: string; source: string | null } {
    const data = bundle.value
    if (!data) return { body: '', source: null }

    const slot = jobKind === 'chat' ? 'chat_prompt_id' : 'agent_prompt_id'
    const globalLabel = jobKind === 'chat' ? 'default chat prompt' : 'default agent prompt'

    if (project) {
      const row = data.project_defaults.find((r) => r.project === project)
      const id = row?.[slot]
      if (id != null) {
        const prompt = data.prompts.find((p) => p.id === id)
        if (prompt) {
          return { body: prompt.body, source: `project \`${project}\`` }
        }
      }
    }

    const globalId = data.defaults[slot]
    if (globalId != null) {
      const prompt = data.prompts.find((p) => p.id === globalId)
      if (prompt) {
        return { body: prompt.body, source: globalLabel }
      }
    }

    return { body: '', source: null }
  }

  function applicableDefaultBody(project: string | null): string {
    return bodyForDefault(project).body
  }

  return {
    bundle,
    prompts,
    filteredPrompts,
    loading,
    error,
    load,
    bodyForDefault,
    applicableDefaultBody,
  }
}

export function useSystemPromptField(
  jobKind: PromptJobKind,
  systemPrompt: Ref<string>,
  project: Ref<string>,
  library: ReturnType<typeof useSystemPromptLibrary>,
) {
  const dirty = ref(false)
  const autoFillSource = ref<string | null>(null)
  const selectedLoadId = ref('')

  function markDirty() {
    dirty.value = true
    autoFillSource.value = null
  }

  function applyDefault(force = false) {
    const projectName = project.value.trim() || null
    const { body, source } = library.bodyForDefault(projectName)
    if (force || !dirty.value) {
      systemPrompt.value = body
      dirty.value = false
      autoFillSource.value = body ? source : null
    }
  }

  function loadSelectedPrompt() {
    const id = Number(selectedLoadId.value)
    if (!id) return
    const prompt = library.filteredPrompts.value.find((p) => p.id === id)
    if (!prompt) return
    systemPrompt.value = prompt.body
    dirty.value = true
    autoFillSource.value = null
    selectedLoadId.value = ''
  }

  const showApplyDefault = computed(() => {
    if (!dirty.value) return false
    const projectName = project.value.trim() || null
    const defaultBody = library.applicableDefaultBody(projectName)
    return defaultBody !== '' && systemPrompt.value !== defaultBody
  })

  const applyDefaultLabel = computed(() => {
    const projectName = project.value.trim()
    if (projectName) return `Apply project default for ${projectName}`
    return jobKind === 'chat' ? 'Apply chat default' : 'Apply agent default'
  })

  watch(
    () => project.value,
    () => {
      applyDefault(false)
    },
  )

  return {
    dirty,
    autoFillSource,
    selectedLoadId,
    markDirty,
    applyDefault,
    loadSelectedPrompt,
    showApplyDefault,
    applyDefaultLabel,
  }
}

export async function saveSystemPrompt(
  name: string,
  body: string,
  appliesTo: SystemPrompt['applies_to'],
  options?: {
    setGlobalDefault?: boolean
    setProjectDefault?: boolean
    project?: string
    jobKind?: PromptJobKind
  },
): Promise<SystemPrompt> {
  const auth = useAuth()
  const token = auth.getAccessToken()
  if (!token) throw new Error('Not signed in')

  const row = await api.createSystemPrompt({ name, body, applies_to: appliesTo }, token)

  if (options?.setGlobalDefault && options.jobKind) {
    const key = options.jobKind === 'chat' ? 'chat_prompt_id' : 'agent_prompt_id'
    await api.setSystemPromptDefaults({ [key]: row.id }, token)
  }

  if (options?.setProjectDefault && options.project && options.jobKind) {
    const key = options.jobKind === 'chat' ? 'chat_prompt_id' : 'agent_prompt_id'
    await api.setProjectPromptDefaults(options.project, { [key]: row.id }, token)
  }

  return row
}

export function unionProjects(
  agentProjects: string[],
  projectDefaults: ProjectPromptDefaults[],
  toolPolicies: { project: string }[] = [],
): string[] {
  const merged = [...agentProjects]
  for (const row of projectDefaults) {
    if (row.project && !merged.includes(row.project)) {
      merged.push(row.project)
    }
  }
  for (const row of toolPolicies) {
    if (row.project && !merged.includes(row.project)) {
      merged.push(row.project)
    }
  }
  merged.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return merged
}

export { ApiError }
