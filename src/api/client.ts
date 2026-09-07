function apiBase(): string {
  if (typeof window !== 'undefined' && window.OWNRUN_API_BASE) {
    return window.OWNRUN_API_BASE
  }
  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE
  }
  if (typeof window !== 'undefined') {
    const { pathname } = window.location
    const marker = '/ownrun-web'
    const idx = pathname.indexOf(marker)
    if (idx !== -1) {
      // /ownrun-web → /ownrun-server/api/index.php
      // /~jonboy/ownrun-web → /~jonboy/ownrun-server/api/index.php
      return `${pathname.slice(0, idx)}/ownrun-server/api/index.php`
    }
  }
  return '/api/index.php'
}

const API_BASE = apiBase()

export interface AuthTokens {
  access_token: string
  refresh_token: string
  expires_in: number
}

export interface AuthSessionHooks {
  getRefreshToken: () => string | null
  applyTokens: (tokens: AuthTokens) => void
  onAuthLost: () => void
}

let sessionHooks: AuthSessionHooks | null = null
let refreshInFlight: Promise<string | null> | null = null

export function registerAuthSession(hooks: AuthSessionHooks): void {
  sessionHooks = hooks
}

function isAuthPath(path: string): boolean {
  return path === '/auth/login' || path === '/auth/refresh' || path === '/auth/logout'
}

export async function refreshAccessToken(): Promise<string | null> {
  if (!sessionHooks) {
    return null
  }
  if (refreshInFlight) {
    return refreshInFlight
  }

  refreshInFlight = (async () => {
    const refresh = sessionHooks!.getRefreshToken()
    if (!refresh) {
      return null
    }
    try {
      const tokens = await request<AuthTokens>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refresh }),
      })
      sessionHooks!.applyTokens(tokens)
      return tokens.access_token
    } catch {
      sessionHooks!.onAuthLost()
      return null
    }
  })().finally(() => {
    refreshInFlight = null
  })

  return refreshInFlight
}

async function fetchWithAuthRetry(
  url: string,
  init: RequestInit,
  accessToken: string,
): Promise<Response> {
  const headersFor = (token: string): Record<string, string> => ({
    ...((init.headers as Record<string, string> | undefined) ?? {}),
    Authorization: `Bearer ${token}`,
    'X-OwnRun-Authorization': `Bearer ${token}`,
  })

  let res = await fetch(url, { ...init, headers: headersFor(accessToken) })
  if (res.status === 401) {
    const next = await refreshAccessToken()
    if (next) {
      res = await fetch(url, { ...init, headers: headersFor(next) })
    }
  }
  return res
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | string
  content: string
}

export interface TraceStep {
  kind: 'user' | 'tool_call' | 'tool_result' | 'message' | string
  content?: string
  name?: string
  args?: Record<string, unknown>
  ok?: boolean
  source?: string
}

export interface AgentResult {
  text?: string
  model?: string
  profile?: string
  project?: string
  duration_ms?: number
  stop_reason?: string
  iterations?: number
  trace?: TraceStep[]
  trace_truncated?: boolean
}

export interface Job {
  id: number
  type: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  request: {
    model?: string
    prompt: string
    system_prompt?: string
    messages?: ChatMessage[]
    parent_job_id?: number
    profile?: string
    project?: string
    max_tool_iterations?: number
    disabled_tools?: string[]
    allow_http_fetch?: boolean
    negative_prompt?: string
    width?: number
    height?: number
    steps?: number
    cfg_scale?: number
    seed?: number
    batch_size?: number
  }
  result:
    | AgentResult
    | { text?: string; model?: string; duration_ms?: number }
    | ImageJobResult
    | null
  progress: (AgentResult & { phase?: string }) | { phase?: string } | null
  error_message: string | null
  created_at: string
  queued_at: string
  claimed_at: string | null
  finished_at: string | null
}

export interface ImageJobResult {
  seed?: number
  model?: string
  width?: number
  height?: number
  steps?: number
  cfg_scale?: number
  duration_ms?: number
  backend_switch_ms?: number
  images?: Array<{
    artifact_id: number
    filename: string
    content_type: string
  }>
}

export interface JobArtifact {
  id: number
  job_id: number
  kind: string
  filename: string
  content_type: string
  size_bytes: number
  created_at?: string | null
}

export interface ModelsResponse {
  models: string[]
  runner_online: boolean
  runner_last_seen_at: string | null
  agent_profiles: string[]
  agent_models: string[]
  agent_projects: string[]
  calendar_projects?: string[]
  journal_projects?: string[]
  task_projects?: string[]
  kb_projects?: string[]
  timezone?: string
  web_search_available?: boolean
  agent_tool_ids?: string[]
  project_tool_policies?: ProjectToolPolicy[]
  backend_state?: string | null
  sd_available?: boolean
  sd_models?: string[]
  ollama_models_stale?: boolean
}

export interface ProjectToolPolicy {
  project: string
  disabled_tools: string[]
  updated_at?: string
}

export type KbDocStatus = 'pending' | 'queued' | 'running' | 'ready' | 'failed' | 'deleting'

export interface KnowledgeBase {
  id: number
  name: string
  slug: string
  project: string | null
  description: string | null
  document_count: number
  ready_count: number
  pending_count: number
  failed_count: number
  created_at?: string | null
  updated_at?: string | null
}

export interface KbDocument {
  id: number
  kb_id: number
  filename: string
  content_type: string
  format: 'pdf' | 'docx' | 'epub' | string
  size_bytes: number
  status: KbDocStatus
  error_message: string | null
  chunk_count: number | null
  page_count: number | null
  chapter_count: number | null
  content_hash: string
  ingest_job_id: number | null
  embedding_model: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface CalendarEntry {
  id: number
  title: string
  description?: string | null
  starts_at: string
  ends_at: string | null
  all_day: boolean
  project: string | null
  created_by?: 'user' | 'agent' | string
  created_job_id?: number | null
  updated_job_id?: number | null
  created_at?: string
  updated_at?: string
}

export interface CalendarListResponse {
  entries: CalendarEntry[]
  truncated: boolean
}

export interface JournalEntry {
  id: number
  title: string | null
  body: string
  entry_date: string
  project: string | null
  created_by?: 'user' | 'agent' | string
  created_job_id?: number | null
  updated_job_id?: number | null
  created_at?: string
  updated_at?: string
  body_truncated?: boolean
}

export interface JournalListResponse {
  entries: JournalEntry[]
  truncated: boolean
  next?: { before_date: string; before_id: number }
}

export interface JournalMemoryResponse {
  entry: JournalEntry | null
  memory_kind: 'anniversary_10y' | 'anniversary_1y' | 'anniversary_1m' | 'random' | null
  memory_label: string | null
}

export type TaskPriority = 'high' | 'normal' | 'low'
export type TaskStatus = 'todo' | 'in_progress' | 'finished' | 'deleted'

export interface Task {
  id: number
  name: string
  description: string | null
  due_date: string | null
  project: string | null
  priority: TaskPriority
  status: TaskStatus
  created_by?: 'user' | 'agent' | string
  created_job_id?: number | null
  updated_job_id?: number | null
  created_at?: string
  updated_at?: string
  description_truncated?: boolean
}

export interface TaskListResponse {
  tasks: Task[]
  truncated: boolean
  total: number
}

export interface TaskDueResponse {
  today: string
  overdue: number
  due_today: number
  open: number
  tasks: Task[]
}

export type SystemPromptAppliesTo = 'chat' | 'agent' | 'both'

export interface SystemPrompt {
  id: number
  name: string
  body: string
  applies_to: SystemPromptAppliesTo
  created_at: string
  updated_at: string
}

export interface SystemPromptDefaults {
  chat_prompt_id: number | null
  agent_prompt_id: number | null
}

export interface ProjectPromptDefaults {
  project: string
  chat_prompt_id: number | null
  agent_prompt_id: number | null
}

export interface SystemPromptBundle {
  prompts: SystemPrompt[]
  defaults: SystemPromptDefaults
  project_defaults: ProjectPromptDefaults[]
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: number,
  ) {
    super(message)
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null,
  retried = false,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  if (accessToken) {
    const bearer = `Bearer ${accessToken}`
    headers['Authorization'] = bearer
    headers['X-OwnRun-Authorization'] = bearer
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })

  if (res.status === 401 && !retried && !isAuthPath(path)) {
    const next = await refreshAccessToken()
    if (next) {
      return request<T>(path, options, next, true)
    }
  }

  if (!res.ok) {
    let message = res.statusText
    let retryAfter: number | undefined
    try {
      const body = await res.json()
      if (body.error) message = body.error
      if (typeof body.retry_after === 'number' && body.retry_after > 0) {
        retryAfter = body.retry_after
      }
    } catch {
      // ignore
    }
    throw new ApiError(message, res.status, retryAfter)
  }

  if (res.status === 204) {
    return undefined as T
  }

  return res.json() as Promise<T>
}

export const api = {
  login(username: string, password: string, rememberMe: boolean) {
    return request<AuthTokens>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, remember_me: rememberMe }),
    })
  },

  refresh(refreshToken: string) {
    return request<AuthTokens>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
  },

  logout(refreshToken: string) {
    return request<{ ok: boolean }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
  },

  listJobs(accessToken: string) {
    return request<{ jobs: Job[] }>('/jobs', {}, accessToken)
  },

  getJob(id: number, accessToken: string) {
    return request<Job>(`/jobs/${id}`, {}, accessToken)
  },

  createJob(
    data: {
      type?: 'ollama.chat' | 'agent.task' | 'stablediffusion.txt2img'
      model?: string
      prompt: string
      system_prompt?: string
      profile?: string
      project?: string
      max_tool_iterations?: number
      disabled_tools?: string[]
      allow_http_fetch?: boolean
      negative_prompt?: string
      width?: number
      height?: number
      steps?: number
      cfg_scale?: number
      seed?: number
      batch_size?: number
    },
    accessToken: string,
  ) {
    return request<Job>('/jobs', {
      method: 'POST',
      body: JSON.stringify(data),
    }, accessToken)
  },

  listJobArtifacts(jobId: number, accessToken: string) {
    return request<{ artifacts: JobArtifact[] }>(
      `/jobs/${jobId}/artifacts`,
      {},
      accessToken,
    )
  },

  artifactUrl(jobId: number, artifactId: number, download = false): string {
    const q = download ? '?download=1' : ''
    return `${API_BASE}/jobs/${jobId}/artifacts/${artifactId}${q}`
  },

  async fetchArtifactBlob(
    jobId: number,
    artifactId: number,
    accessToken: string,
  ): Promise<Blob> {
    const resp = await fetchWithAuthRetry(this.artifactUrl(jobId, artifactId), {}, accessToken)
    if (!resp.ok) {
      let message = `HTTP ${resp.status}`
      try {
        const data = await resp.json()
        if (data?.error) message = data.error
      } catch {
        /* ignore */
      }
      throw new ApiError(message, resp.status)
    }
    return resp.blob()
  },

  cancelJob(id: number, accessToken: string) {
    return request<Job>(`/jobs/${id}/cancel`, { method: 'POST' }, accessToken)
  },

  requeueJob(id: number, accessToken: string) {
    return request<Job>(`/jobs/${id}/requeue`, { method: 'POST' }, accessToken)
  },

  continueJob(id: number, prompt: string, accessToken: string) {
    return request<Job>(`/jobs/${id}/continue`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }, accessToken)
  },

  getModels(accessToken: string) {
    return request<ModelsResponse>('/models', {}, accessToken)
  },

  listCalendar(
    params: { from: string; to: string; project?: string },
    accessToken: string,
  ) {
    const q = new URLSearchParams({ from: params.from, to: params.to })
    if (params.project !== undefined) {
      q.set('project', params.project)
    }
    return request<CalendarListResponse>(`/calendar?${q.toString()}`, {}, accessToken)
  },

  getCalendarEntry(id: number, accessToken: string) {
    return request<CalendarEntry>(`/calendar/${id}`, {}, accessToken)
  },

  createCalendarEntry(
    data: {
      title: string
      starts_at: string
      ends_at?: string | null
      all_day?: boolean
      description?: string | null
      project?: string | null
    },
    accessToken: string,
  ) {
    return request<CalendarEntry>('/calendar', {
      method: 'POST',
      body: JSON.stringify(data),
    }, accessToken)
  },

  updateCalendarEntry(
    id: number,
    data: {
      title?: string
      starts_at?: string
      ends_at?: string | null
      all_day?: boolean
      description?: string | null
      project?: string | null
    },
    accessToken: string,
  ) {
    return request<CalendarEntry>(`/calendar/${id}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, accessToken)
  },

  deleteCalendarEntry(id: number, accessToken: string) {
    return request<{ ok: boolean; id: number }>(`/calendar/${id}/delete`, { method: 'POST' }, accessToken)
  },

  listJournal(
    params: {
      project?: string
      q?: string
      limit?: number
      before_date?: string
      before_id?: number
      from?: string
      to?: string
    },
    accessToken: string,
  ) {
    const q = new URLSearchParams()
    if (params.project !== undefined) q.set('project', params.project)
    if (params.q) q.set('q', params.q)
    if (params.limit !== undefined) q.set('limit', String(params.limit))
    if (params.before_date) q.set('before_date', params.before_date)
    if (params.before_id !== undefined) q.set('before_id', String(params.before_id))
    if (params.from) q.set('from', params.from)
    if (params.to) q.set('to', params.to)
    const qs = q.toString()
    return request<JournalListResponse>(`/journal${qs ? `?${qs}` : ''}`, {}, accessToken)
  },

  getJournalMemory(accessToken: string) {
    return request<JournalMemoryResponse>('/journal/memory', {}, accessToken)
  },

  getJournalEntry(id: number, accessToken: string) {
    return request<JournalEntry>(`/journal/${id}`, {}, accessToken)
  },

  createJournalEntry(
    data: {
      body: string
      title?: string | null
      entry_date?: string | null
      project?: string | null
    },
    accessToken: string,
  ) {
    return request<JournalEntry>('/journal', {
      method: 'POST',
      body: JSON.stringify(data),
    }, accessToken)
  },

  updateJournalEntry(
    id: number,
    data: {
      body?: string
      title?: string | null
      entry_date?: string | null
      project?: string | null
    },
    accessToken: string,
  ) {
    return request<JournalEntry>(`/journal/${id}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, accessToken)
  },

  deleteJournalEntry(id: number, accessToken: string) {
    return request<{ ok: boolean; id: number }>(`/journal/${id}/delete`, { method: 'POST' }, accessToken)
  },

  listTasks(
    params: {
      project?: string
      status?: string
      priority?: string
      q?: string
      due_from?: string
      due_to?: string
      limit?: number
      offset?: number
    },
    accessToken: string,
  ) {
    const q = new URLSearchParams()
    if (params.project !== undefined) q.set('project', params.project)
    if (params.status) q.set('status', params.status)
    if (params.priority) q.set('priority', params.priority)
    if (params.q) q.set('q', params.q)
    if (params.due_from) q.set('due_from', params.due_from)
    if (params.due_to) q.set('due_to', params.due_to)
    if (params.limit !== undefined) q.set('limit', String(params.limit))
    if (params.offset !== undefined) q.set('offset', String(params.offset))
    const qs = q.toString()
    return request<TaskListResponse>(`/tasks${qs ? `?${qs}` : ''}`, {}, accessToken)
  },

  getTasksDue(accessToken: string) {
    return request<TaskDueResponse>('/tasks/due', {}, accessToken)
  },

  getTask(id: number, accessToken: string) {
    return request<Task>(`/tasks/${id}`, {}, accessToken)
  },

  createTask(
    data: {
      name: string
      description?: string | null
      due_date?: string | null
      project?: string | null
      priority?: TaskPriority
      status?: Exclude<TaskStatus, 'deleted'>
    },
    accessToken: string,
  ) {
    return request<Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }, accessToken)
  },

  updateTask(
    id: number,
    data: {
      name?: string
      description?: string | null
      due_date?: string | null
      project?: string | null
      priority?: TaskPriority
      status?: TaskStatus
    },
    accessToken: string,
  ) {
    return request<Task>(`/tasks/${id}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, accessToken)
  },

  deleteTask(id: number, accessToken: string) {
    return request<{ ok: boolean; id: number }>(`/tasks/${id}/delete`, { method: 'POST' }, accessToken)
  },

  listSystemPrompts(accessToken: string) {
    return request<SystemPromptBundle>('/system-prompts', {}, accessToken)
  },

  getSystemPrompt(id: number, accessToken: string) {
    return request<SystemPrompt>(`/system-prompts/${id}`, {}, accessToken)
  },

  createSystemPrompt(
    data: { name: string; body: string; applies_to?: SystemPromptAppliesTo },
    accessToken: string,
  ) {
    return request<SystemPrompt>('/system-prompts', {
      method: 'POST',
      body: JSON.stringify(data),
    }, accessToken)
  },

  updateSystemPrompt(
    id: number,
    data: Partial<{ name: string; body: string; applies_to: SystemPromptAppliesTo }>,
    accessToken: string,
  ) {
    return request<SystemPrompt>(`/system-prompts/${id}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, accessToken)
  },

  deleteSystemPrompt(id: number, accessToken: string) {
    return request<{ ok: boolean; id: number }>(`/system-prompts/${id}/delete`, { method: 'POST' }, accessToken)
  },

  setSystemPromptDefaults(
    data: Partial<{ chat_prompt_id: number | null; agent_prompt_id: number | null }>,
    accessToken: string,
  ) {
    return request<SystemPromptDefaults>('/system-prompts/defaults', {
      method: 'POST',
      body: JSON.stringify(data),
    }, accessToken)
  },

  setProjectPromptDefaults(
    project: string,
    data: Partial<{ chat_prompt_id: number | null; agent_prompt_id: number | null }>,
    accessToken: string,
  ) {
    return request<ProjectPromptDefaults>(
      `/system-prompts/defaults/projects/${encodeURIComponent(project)}`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      accessToken,
    )
  },

  deleteProjectPromptDefaults(project: string, accessToken: string) {
    return request<{ ok: boolean; project: string }>(
      `/system-prompts/defaults/projects/${encodeURIComponent(project)}/delete`,
      { method: 'POST' },
      accessToken,
    )
  },

  listProjectToolPolicies(accessToken: string) {
    return request<{ policies: ProjectToolPolicy[] }>('/project-tool-policies', {}, accessToken)
  },

  setProjectToolPolicy(project: string, disabled_tools: string[], accessToken: string) {
    return request<ProjectToolPolicy>(
      `/project-tool-policies/${encodeURIComponent(project)}`,
      {
        method: 'POST',
        body: JSON.stringify({ disabled_tools }),
      },
      accessToken,
    )
  },

  deleteProjectToolPolicy(project: string, accessToken: string) {
    return request<{ ok: boolean; project: string }>(
      `/project-tool-policies/${encodeURIComponent(project)}/delete`,
      { method: 'POST' },
      accessToken,
    )
  },

  listKnowledgeBases(params: { project?: string }, accessToken: string) {
    const q = new URLSearchParams()
    if (params.project !== undefined) q.set('project', params.project)
    const qs = q.toString()
    return request<{ bases: KnowledgeBase[] }>(`/kb${qs ? `?${qs}` : ''}`, {}, accessToken)
  },

  getKnowledgeBase(id: number, accessToken: string) {
    return request<KnowledgeBase>(`/kb/${id}`, {}, accessToken)
  },

  createKnowledgeBase(
    data: { name: string; slug?: string; project?: string | null; description?: string | null },
    accessToken: string,
  ) {
    return request<KnowledgeBase>('/kb', {
      method: 'POST',
      body: JSON.stringify(data),
    }, accessToken)
  },

  updateKnowledgeBase(
    id: number,
    data: Partial<{ name: string; slug: string; project: string | null; description: string | null }>,
    accessToken: string,
  ) {
    return request<KnowledgeBase>(`/kb/${id}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, accessToken)
  },

  deleteKnowledgeBase(id: number, accessToken: string) {
    return request<{ ok: boolean; id: number }>(`/kb/${id}/delete`, { method: 'POST' }, accessToken)
  },

  rebuildKnowledgeBase(id: number, accessToken: string) {
    return request<{ ok: boolean; queued: number; kb_id: number }>(
      `/kb/${id}/rebuild`,
      { method: 'POST' },
      accessToken,
    )
  },

  listKbDocuments(kbId: number, accessToken: string) {
    return request<{ documents: KbDocument[] }>(`/kb/${kbId}/documents`, {}, accessToken)
  },

  async uploadKbDocument(kbId: number, file: File, accessToken: string) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetchWithAuthRetry(
      `${API_BASE}/kb/${kbId}/documents`,
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: form,
      },
      accessToken,
    )
    if (!res.ok) {
      let message = res.statusText
      try {
        const body = await res.json()
        if (body.error) message = body.error
      } catch {
        // ignore
      }
      throw new ApiError(message, res.status)
    }
    return res.json() as Promise<KbDocument>
  },

  reingestKbDocument(id: number, accessToken: string) {
    return request<KbDocument>(`/kb/documents/${id}/reingest`, { method: 'POST' }, accessToken)
  },

  deleteKbDocument(id: number, accessToken: string) {
    return request<{ ok: boolean; id: number }>(
      `/kb/documents/${id}/delete`,
      { method: 'POST' },
      accessToken,
    )
  },
}

export { ApiError }
