/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a fully static site to `out/` so it can be embedded in the Tauri shell.
  output: 'export',
  // Safety net for asset-path resolution inside the desktop webview.
  trailingSlash: true,
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
}

export default nextConfig