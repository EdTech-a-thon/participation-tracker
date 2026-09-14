import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// Cloudflare Web Analytics. The token is set as VITE_CF_BEACON on the production host only, so
// local and preview builds never report views.
const cfBeacon = import.meta.env.VITE_CF_BEACON?.trim()
if (cfBeacon) {
  const script = document.createElement('script')
  script.type = 'module'
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js'
  script.dataset.cfBeacon = JSON.stringify({ token: cfBeacon })
  document.head.append(script)
}

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
