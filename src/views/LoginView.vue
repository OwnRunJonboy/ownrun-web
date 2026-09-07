<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/auth'
import { ApiError } from '@/api/client'

const auth = useAuth()
const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const rememberMe = ref(false)
const error = ref('')
const loading = ref(false)
const lockedUntil = ref(0)
let unlockTimer: ReturnType<typeof setTimeout> | null = null

const isLocked = computed(() => lockedUntil.value > Date.now())

function armLockout(seconds: number) {
  lockedUntil.value = Date.now() + seconds * 1000
  if (unlockTimer) clearTimeout(unlockTimer)
  unlockTimer = setTimeout(() => {
    lockedUntil.value = 0
    unlockTimer = null
  }, seconds * 1000)
}

async function submit() {
  if (isLocked.value) return
  error.value = ''
  loading.value = true
  try {
    await auth.login(username.value, password.value, rememberMe.value)
    const redirect = (route.query.redirect as string) || '/'
    router.push(redirect)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Login failed'
    if (e instanceof ApiError && e.status === 429 && e.retryAfter) {
      armLockout(e.retryAfter)
    }
  } finally {
    loading.value = false
  }
}

onUnmounted(() => {
  if (unlockTimer) clearTimeout(unlockTimer)
})
</script>

<template>
  <div style="max-width: 360px; margin: 4rem auto">
    <h1 style="margin-bottom: 1.5rem">OwnRun</h1>
    <form @submit.prevent="submit">
      <div class="form-group">
        <label for="username">Username</label>
        <input id="username" v-model="username" autocomplete="username" required />
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input
          id="password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </div>
      <div class="form-group">
        <label>
          <input v-model="rememberMe" type="checkbox" />
          Remember me for 30 days
        </label>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" class="btn btn-primary" :disabled="loading || isLocked">
        {{ loading ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
  </div>
</template>
