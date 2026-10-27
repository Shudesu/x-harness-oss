'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';

const UPDATE_ID = 'campaign-experience-090';
const STORAGE_KEY = 'xh:updates:seen';

export default function CampaignUpdate({ autoShow = false }: { autoShow?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  function open() {
    const element = dialog.current;
    if (!element || element.open || typeof element.showModal !== 'function') return;
    previousFocus.current = document.activeElement as HTMLElement;
    element.showModal();
    try { localStorage.setItem(STORAGE_KEY, UPDATE_ID); } catch { /* Manual access remains available. */ }
  }
  useEffect(() => {
    if (!autoShow) return;
    try { if (localStorage.getItem(STORAGE_KEY) === UPDATE_ID) return; } catch { return; }
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== 'visible' || document.querySelector('dialog[open]') ||
        document.activeElement !== document.body) return;
      open();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [autoShow]);
  return <>
    <div className="mb-4 flex justify-end"><button type="button" ref={trigger} onClick={open} aria-haspopup="dialog" className="min-h-11 rounded-full border border-green-200 bg-green-50 px-4 text-sm font-medium text-green-900">更新内容を見る <span aria-hidden="true">↗</span></button></div>
    <dialog ref={dialog} aria-labelledby="campaign-update-title" style={{width:'min(680px, calc(100vw - 24px))',maxHeight:'calc(100dvh - 24px)'}} className="m-auto overflow-y-auto rounded-3xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/60"
      onClose={() => { const target=previousFocus.current; if(target?.isConnected&&target!==document.body)target.focus();else trigger.current?.focus(); }}
      onClick={event => { if(event.target!==dialog.current)return;const r=dialog.current.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.current.close(); }}>
      <div className="flex items-center justify-between px-6 pt-5"><span className="text-xs font-semibold tracking-widest text-green-800">X HARNESS · v0.9.0</span><button type="button" autoFocus onClick={()=>dialog.current?.close()} aria-label="更新内容を閉じる" className="h-11 w-11 rounded-full bg-slate-100 text-2xl">×</button></div>
      <div className="px-6 pb-6 sm:px-9"><p className="mt-5 text-sm font-medium text-green-800">Xで集めて、LINEでつなぐ。</p><h2 id="campaign-update-title" className="mt-2 text-2xl font-bold leading-snug sm:text-3xl">キャンペーンの準備から<br/>結果の確認まで、分かりやすく。</h2><p className="mt-4 text-sm leading-7 text-slate-600">参加者はLINEで合言葉を受け取り、Xに投稿。結果と特典はLINEで確認できます。</p>
        <ul className="my-6 space-y-4">{[
          ['01','企画の下書きを、ひとことから。','説明を入力して、企画名・告知文・特典の案を準備。内容を選んでフォームへ反映できます。'],
          ['02','残り枠と結果を、迷わず確認。','参加画面に残り枠・締め切りを表示。結果の文面と、希望者向けのクーポン・次回案内を設定できます。'],
          ['03','振り返りと費用も、見えるように。','終了時の結果通知と予算に応じた確認間隔の調整を追加。通知先は設定画面から選べます。'],
        ].map(([number,title,text])=><li key={number} className="flex gap-4 rounded-2xl bg-slate-50 p-4"><span className="text-sm font-semibold text-green-800">{number}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{text}</p></div></li>)}</ul>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6"><strong>最初に設定してください</strong><p>利用するXアカウントとLINE環境の接続が必要です。結果通知・フォロー案内はOFFから始まります。先行案内の配信は、LINE側で内容を確認してから行います。</p><p className="mt-2 text-xs">既存の履歴は保持します。旧式の自動DM配布は停止します。X API・AI・LINE配信の料金は利用内容によって発生します。Grok BotのXコネクタの料金条件は、この直接API接続とは別に確認してください。</p></div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2"><Link href="/campaign" onClick={()=>dialog.current?.close()} className="rounded-xl bg-green-800 p-3 text-center font-semibold text-white">キャンペーンを作る</Link><Link href="/settings" onClick={()=>dialog.current?.close()} className="rounded-xl border border-slate-300 p-3 text-center font-medium">接続・通知を設定する</Link></div>
        <p className="mt-4 text-center text-xs text-slate-500">このブラウザでは一度だけ自動表示します。「更新内容を見る」から再確認できます。</p>
      </div>
    </dialog>
  </>;
}
