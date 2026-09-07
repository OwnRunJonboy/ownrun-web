import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuth } from '@/auth'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { guest: true },
    },
    {
      path: '/calendar',
      name: 'calendar',
      component: () => import('@/views/CalendarView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/journal',
      name: 'journal',
      component: () => import('@/views/JournalView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/tasks',
      name: 'tasks',
      component: () => import('@/views/TasksView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/knowledge',
      name: 'knowledge',
      component: () => import('@/views/KnowledgeView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/prompts',
      name: 'prompts',
      component: () => import('@/views/PromptsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/',
      name: 'jobs',
      component: () => import('@/views/JobsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/jobs/new',
      name: 'new-job',
      component: () => import('@/views/NewJobView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/jobs/new-agent',
      name: 'new-agent',
      component: () => import('@/views/NewAgentView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/jobs/new-image',
      name: 'new-image',
      component: () => import('@/views/NewImageView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/jobs/:id',
      name: 'job-detail',
      component: () => import('@/views/JobDetailView.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuth()
  while (!auth.state.ready) {
    await new Promise((r) => setTimeout(r, 10))
  }

  if (to.meta.requiresAuth && !auth.isAuthenticated()) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.guest && auth.isAuthenticated()) {
    return { name: 'jobs' }
  }
})

export default router
