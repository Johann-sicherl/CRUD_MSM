const { execSync } = require('child_process')

// Hash do commit atual, embutido no bundle do cliente em build time — usado
// só pelo Diagnóstico da Aplicação (AppDiagnosticsGate.tsx) pra saber se o
// app foi atualizado desde a última vez que o Admin viu o pop-up (compara
// contra o que está salvo em localStorage). 'dev' como fallback pra quando
// não há repositório git disponível no ambiente de build (não deve
// acontecer em produção, mas não pode quebrar o build por causa disso).
function getBuildSha() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'vmisecurity.com' },
    ],
  },
  env: {
    NEXT_PUBLIC_APP_BUILD_SHA: getBuildSha(),
  },
}

module.exports = nextConfig
