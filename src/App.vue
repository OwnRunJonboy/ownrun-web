<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import { useAuth } from '@/auth'
import { useRouter } from 'vue-router'

const auth = useAuth()
const router = useRouter()

async function logout() {
  await auth.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="container">
    <header v-if="auth.isAuthenticated()" class="app-header">
      <h1><RouterLink to="/">OwnRun</RouterLink></h1>
      <nav class="actions">
        <RouterLink to="/calendar" class="btn">Calendar</RouterLink>
        <RouterLink to="/journal" class="btn">Journal</RouterLink>
        <RouterLink to="/jobs/new" class="btn">New chat</RouterLink>
        <RouterLink to="/jobs/new-agent" class="btn btn-primary">New agent</RouterLink>
        <button type="button" class="btn" @click="logout">Logout</button>
      </nav>
    </header>
    <RouterView />
  </div>
</template>
