'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { API_URL } from '@/lib/api'

export default function LoginPage() {
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      localStorage.removeItem('xh_api_key')
      const response = await fetch(`${API_URL}/api/auth/session`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey})})
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error('Unauthorized')
      sessionStorage.setItem('xh_session',result.data.token)
      setApiKey('')
      router.push('/')
    } catch {
      sessionStorage.removeItem('xh_session')
      setError('接続に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#1D9BF0' }}>
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg mx-auto mb-3" style={{ backgroundColor: '#1D9BF0' }}>
            X
          </div>
          <h1 className="text-xl font-bold text-gray-900">X Harness</h1>
          <p className="text-sm text-gray-500 mt-1">Xアカウント自動化ダッシュボード</p>
        </div>

        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label htmlFor="api-key" className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="APIキーを入力"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 mb-4">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !apiKey}
            className="w-full py-3 text-white font-medium rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#1D9BF0' }}
          >
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}
