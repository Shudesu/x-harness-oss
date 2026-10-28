'use client';
import {useEffect,useState} from 'react';
import {fetchApi} from '@/lib/api';
type Source={gateId:string;source:string;state:string;supported:boolean;lastCompleteAt:number|null};
export default function ExternalSource({gateId,active}:{gateId:string;active:boolean}){
 const [source,setSource]=useState<Source|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false);
 const load=()=>fetchApi<{data:Source}>(`/api/integrations/agent-source/${gateId}/status`).then(r=>setSource(r.data)).catch(()=>setError('取得方法を確認できません。管理者でログインしてから再確認してください。'));
 useEffect(()=>{void load();},[gateId,active]);
 if(!source)return <p className="text-sm text-slate-600">{error||'取得方法を確認中…'}</p>;
 const external=source.source==='external';
 const states:Record<string,string>={awaiting_data:'データ待ち',receiving:'ページ受信中・確定を保留',stale:'更新停止・確定を保留',ready:'受信済み',unsupported_conditions:'条件を確認してください・確定を保留',x_api:'X APIで取得'};
 return <div className="mt-4 rounded-lg border bg-slate-50 p-4 text-sm">
 <h3 className="font-semibold">参加データの取得方法</h3><p>{external?'Grokなどの外部データ':'X API'}：{states[source.state]||source.state}</p>
 <p>最終受信：{source.lastCompleteAt?new Date(source.lastCompleteAt).toLocaleString('ja-JP'):'まだありません'}</p>
 <p className="mt-2">外部データでは、この企画の返信検索・判定・終了時集計にX APIを使いません。取得先の料金・上限、ほかの投稿・集計のAPI費用は別です。更新が止まると確定を保留し、有料APIには自動で戻しません。</p>
 <p className="mt-2">取得したデータに基づき特典を確定し、既存のLINE結果通知を送ります。データの真偽をXに再照会しません。LINEの通数は消費します。</p>
 {active?<p className="mt-2">切り替えるには先にキャンペーンを一時停止してください。</p>:<>
 {!source.supported&&!external?<p>標準ティアの返信のみの条件に対応します。厳格ティア・フォロー等のAPI確認は対象外です。</p>:<>
 <label className="mt-3 flex gap-2"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>取得方法と特典確定への影響を確認しました{external?'（X APIに戻すと費用が発生する場合があります）':''}</label>
 <button className="mt-3 rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50" disabled={!consent||busy} onClick={async()=>{setBusy(true);setError('');try{await fetchApi(`/api/integrations/agent-source/${gateId}/mode`,{method:'POST',body:JSON.stringify({enabled:!external,confirm:'owner_accepts_external_observations'})});setConsent(false);await load();}catch{setError('切り替えできませんでした。照合中の参加者や実行中の検索がないか確認し、時間を置いて再確認してください。');}finally{setBusy(false);}}}>{external?'X APIでの取得に戻す':'外部データで判定する'}</button></>}
 </>}{error&&<p role="alert" className="mt-2 text-red-700">{error}</p>}</div>;
}
