// Inlined at build time by next.config.ts.
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'
export const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA || 'unknown'
export const BUILD_DATE = process.env.NEXT_PUBLIC_BUILD_DATE || ''

export function versionLabel(): string {
  return `v${APP_VERSION} · ${BUILD_SHA}`
}
