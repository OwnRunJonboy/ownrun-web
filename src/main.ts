import { createApp } from 'vue'
import App from '@/App.vue'
import router from '@/router'
import { useAuth } from '@/auth'
import '@/styles.css'

async function bootstrap() {
  const auth = useAuth()
  await auth.init()
  createApp(App).use(router).mount('#app')
}

bootstrap()
