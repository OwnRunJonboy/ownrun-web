import { reactive, readonly } from 'vue'
import { api } from '@/api/client'

const ACCESS_KEY = 'ownrun_access'
const REFRESH_KEY = 'ownrun_refresh'
const REMEMBER_KEY = 'ownrun_remember'

function storage(persistent: boolean): Storage {
  return persistent ? localStorage : sessionStorage
}

function loadTokens(): { access: string | null; refresh: string | null; remember: boolean } {
  const remember = localStorage.getItem(REMEMBER_KEY) === '1'
  const store = storage(remember)
  return {
    access: store.getItem(ACCESS_KEY),
    refresh: store.getItem(REFRESH_KEY),
    remember,
  }
}

function saveTokens(access: string, refresh: string, remember: boolean) {
  // Clear both stores first
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
  sessionStorage.removeItem(ACCESS_KEY)
  sessionStorage.removeItem(REFRESH_KEY)

  if (remember) {
    localStorage.setItem(REMEMBER_KEY, '1')
  } else {
    localStorage.removeItem(REMEMBER_KEY)
  }

  const store = storage(remember)
  store.setItem(ACCESS_KEY, access)
  store.setItem(REFRESH_KEY, refresh)
}

function clearTokens() {
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

export function useAuth() {
  async function init() {
    const loaded = loadTokens()
    state.rememberMe = loaded.remember
    state.refreshToken = loaded.refresh
    state.accessToken = loaded.access

    if (loaded.refresh) {
      try {
        const tokens = await api.refresh(loaded.refresh)
        saveTokens(tokens.access_token, tokens.refresh_token, loaded.remember)
        state.accessToken = tokens.access_token
        state.refreshToken = tokens.refresh_token
      } catch {
        clearTokens()
        state.accessToken = null
        state.refreshToken = null
      }
    }

    state.ready = true
  }

  async function login(username: string, password: string, rememberMe: boolean) {
    const tokens = await api.login(username, password, rememberMe)
    saveTokens(tokens.access_token, tokens.refresh_token, rememberMe)
    state.accessToken = tokens.access_token
    state.refreshToken = tokens.refresh_token
    state.rememberMe = rememberMe
  }

  async function logout() {
    if (state.refreshToken) {
      try {
        await api.logout(state.refreshToken)
      } catch {
        // ignore
      }
    }
    clearTokens()
    state.accessToken = null
    state.refreshToken = null
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
