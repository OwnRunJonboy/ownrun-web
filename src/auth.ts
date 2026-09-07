import { reactive, readonly } from 'vue'
import { api, registerAuthSession, refreshAccessToken, type AuthTokens } from '@/api/client'

const ACCESS_KEY = 'ownrun_access'
const REFRESH_KEY = 'ownrun_refresh'
const REMEMBER_KEY = 'ownrun_remember'

let refreshTimer: ReturnType<typeof setTimeout> | null = null

function loadTokens(): { access: string | null; refresh: string | null; remember: boolean } {
  // Never keep an access JWT in localStorage (migrate leftover keys away).
  localStorage.removeItem(ACCESS_KEY)

  const remember = localStorage.getItem(REMEMBER_KEY) === '1'
  const refresh = remember
    ? localStorage.getItem(REFRESH_KEY)
    : sessionStorage.getItem(REFRESH_KEY)
  const access = sessionStorage.getItem(ACCESS_KEY)
  return { access, refresh, remember }
}

function persistSession(access: string, refresh: string, remember: boolean) {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
  sessionStorage.removeItem(ACCESS_KEY)
  sessionStorage.removeItem(REFRESH_KEY)

  if (remember) {
    localStorage.setItem(REMEMBER_KEY, '1')
    localStorage.setItem(REFRESH_KEY, refresh)
  } else {
    localStorage.removeItem(REMEMBER_KEY)
    sessionStorage.setItem(REFRESH_KEY, refresh)
  }

  sessionStorage.setItem(ACCESS_KEY, access)
}

function clearStorage() {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(REMEMBER_KEY)
  sessionStorage.removeItem(ACCESS_KEY)
  sessionStorage.removeItem(REFRESH_KEY)
}

const state = reactive({
  accessToken: null as string | null,
  refreshToken: null as string | null,
  rememberMe: false,
  ready: false,
})

function applyTokens(tokens: AuthTokens) {
  persistSession(tokens.access_token, tokens.refresh_token, state.rememberMe)
  state.accessToken = tokens.access_token
  state.refreshToken = tokens.refresh_token
  scheduleRefresh(tokens.expires_in)
}

function wipeTokens() {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  clearStorage()
  state.accessToken = null
  state.refreshToken = null
}

function onAuthLost() {
  wipeTokens()
  if (state.ready && !window.location.hash.startsWith('#/login')) {
    window.location.hash = '#/login'
  }
}

function scheduleRefresh(expiresIn: number) {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  const waitMs = Math.max(15_000, (expiresIn - 60) * 1000)
  refreshTimer = setTimeout(() => {
    void refreshAccessToken()
  }, waitMs)
}

export function useAuth() {
  async function init() {
    registerAuthSession({
      getRefreshToken: () => state.refreshToken,
      applyTokens,
      onAuthLost,
    })

    const loaded = loadTokens()
    state.rememberMe = loaded.remember
    state.refreshToken = loaded.refresh
    state.accessToken = loaded.access

    if (loaded.refresh) {
      const access = await refreshAccessToken()
      if (!access) {
        wipeTokens()
      }
    }

    state.ready = true
  }

  async function login(username: string, password: string, rememberMe: boolean) {
    const tokens = await api.login(username, password, rememberMe)
    state.rememberMe = rememberMe
    applyTokens(tokens)
  }

  async function logout() {
    const refresh = state.refreshToken
    wipeTokens()
    if (refresh) {
      try {
        await api.logout(refresh)
      } catch {
        // ignore
      }
    }
  }

  const isAuthenticated = () => state.accessToken !== null

  return {
    state: readonly(state),
    init,
    login,
    logout,
    isAuthenticated,
    getAccessToken: () => state.accessToken,
  }
}
