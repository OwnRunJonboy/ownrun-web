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
    model: string
    prompt: string
    system_prompt?: string
    messages?: ChatMessage[]
    parent_job_id?: number
    profile?: string
    project?: string
    max_tool_iterations?: number
  }
  result: AgentResult | { text?: string; model?: string; duration_ms?: number } | null
  progress: AgentResult | null
  error_message: string | null
  created_at: string
  queued_at: string
  claimed_at: string | null
  finished_at: string | null
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
  timezone?: string
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
  ) {
    super(message)
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null,
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
      type?: 'ollama.chat' | 'agent.task'
      model: string
      prompt: string
      system_prompt?: string
      profile?: string
      project?: string
      max_tool_iterations?: number
    },
    accessToken: string,
  ) {
    return request<Job>('/jobs', {
      method: 'POST',
      body: JSON.stringify(data),
    }, accessToken)
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
}

export { ApiError }
