import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import ui from '@nuxt/ui/vue-plugin'
import App from './App.vue'
import '../assets/css/main.css'

const app = createApp(App)
// Order matters: Pinia first (Colada's query cache lives inside the Pinia
// store), then Colada, then Nuxt UI. See `.opencode/rules/conventions-frontend.md`
// ("Server State: Pinia Colada").
const pinia = createPinia()
app.use(pinia)
app.use(PiniaColada)
app.use(ui)
app.mount('#app')