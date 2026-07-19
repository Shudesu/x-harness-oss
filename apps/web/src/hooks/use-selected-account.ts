'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { XAccount } from '@/lib/api'

const STORAGE_KEY = 'xh_selected_account'

/**
 * Global hook for the sidebar account selector.
 * Persists the selected X account ID in localStorage.
 * Pages use this to get the currently-active account.
 */
export function useSelectedAccount() {
  const [accounts, setAccounts] = useState<XAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAccountId, setSelectedAccountIdState] = useState('')

  const setSelectedAccountId = useCallback((id: string) => {
    setSelectedAccountIdState(id)
    if (typeof window !== 'undefined') {
      if (id) {
        localStorage.setItem(STORAGE_KEY, id)
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    }
    // Dispatch a custom event so other components (sidebar, pages) stay in sync
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('xh_account_change', { detail: id }))
    }
  }, [])

  // Fetch accounts on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await api.accounts.list()
        if (!cancelled && res.success) {
          setAccounts(res.data)
          // Restore from localStorage or pick first
          const stored = localStorage.getItem(STORAGE_KEY)
          const match = res.data.find((a) => a.id === stored)
          if (match) {
            setSelectedAccountIdState(match.id)
          } else if (res.data.length > 0) {
            setSelectedAccountIdState(res.data[0].id)
            localStorage.setItem(STORAGE_KEY, res.data[0].id)
          }
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Listen for cross-component sync events
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      setSelectedAccountIdState(id)
    }

    // Re-fetch the account list (e.g. after a profile refresh) without
    // toggling `loading`, so the sidebar keeps showing current data.
    const refreshHandler = async () => {
      try {
        const res = await api.accounts.list()
        if (res.success) {
          setAccounts(res.data)
        }
      } catch {
        // silently fail
      }
    }

    window.addEventListener('xh_account_change', handler)
    window.addEventListener('xh_accounts_refresh', refreshHandler)
    return () => {
      window.removeEventListener('xh_account_change', handler)
      window.removeEventListener('xh_accounts_refresh', refreshHandler)
    }
  }, [])

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null

  return {
    accounts,
    loading,
    selectedAccountId,
    selectedAccount,
    setSelectedAccountId,
  }
}

/**
 * Lightweight read-only hook for pages that just need the current account ID.
 * Listens for changes from the sidebar.
 */
export function useCurrentAccountId(): string {
  const [id, setId] = useState(() => {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem(STORAGE_KEY) || ''
  })

  useEffect(() => {
    // Re-read in case SSR value was empty
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && stored !== id) setId(stored)

    const handler = (e: Event) => {
      setId((e as CustomEvent<string>).detail)
    }
    window.addEventListener('xh_account_change', handler)
    return () => window.removeEventListener('xh_account_change', handler)
  }, [id])

  return id
}
