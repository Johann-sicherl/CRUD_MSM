/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'vmisecurity.com' },
    ],
  },
}

module.exports = nextConfig
