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
}

export { ApiError }
