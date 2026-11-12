'use client'

import { useState } from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { DialogRoot, Dialog, DialogTitle, DialogDescription } from '@cloudflare/kumo/components/dialog'

// Confirmation for actions that reach X (create draft / publish). The confirm
// button stays disabled while the action runs so a double click cannot fire
// it twice; errors are shown inside the dialog instead of closing it.
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, danger, onConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = (next: boolean) => { if (!busy) { setError(''); onOpenChange(next) } }
  return <DialogRoot role="alertdialog" open={open} onOpenChange={close}>
    <Dialog className="max-w-lg p-6">
      <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
      <DialogDescription className="mt-3 text-sm leading-6 text-kumo-subtle">{description}</DialogDescription>
      {error && <p role="alert" className="mt-4 rounded-lg bg-kumo-danger-tint p-3 text-sm text-kumo-danger">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => close(false)}>キャンセル</Button>
        <Button variant={danger ? 'destructive' : 'primary'} disabled={busy} onClick={async () => {
          setBusy(true); setError('')
          try { await onConfirm(); onOpenChange(false) }
          catch (e) { setError(e instanceof Error ? e.message : '処理に失敗しました') }
          finally { setBusy(false) }
        }}>{busy ? '処理中…' : confirmLabel}</Button>
      </div>
    </Dialog>
  </DialogRoot>
}
