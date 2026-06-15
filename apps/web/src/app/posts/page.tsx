'use client'
// 202606修正開始
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react'
import { api, fetchApi } from '@/lib/api'
// 202606修正終了
import Header from '@/components/layout/header'
import ApiCostGate from '@/components/api-cost-gate'
import { useCurrentAccountId } from '@/hooks/use-selected-account'

// 202606修正開始
type Tab = 'immediate' | 'scheduled' | 'schedulePost'
// 202606修正終了

//202606追加開始

type SchedulePreview = {
  id: string;
  sortOrder: number;
  enabled: boolean;
  weekday: string;
  time: string;
  offset: string;
  timezone: string;
  text: string;
  nextRunAt?: string | null;
  lastPostedAt?: string | null
};
//0615追加開始
function getWeeklyViewKey(item: SchedulePreview) {
  if (!item.nextRunAt) {
    return `${item.weekday}-${item.time}`;
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(new Date(item.nextRunAt));

  const map: Record<string, string> = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const hour = Number(map.hour);
  const minute = Number(map.minute);
  const bucketMinute = minute < 30 ? '00' : '30';
  const bucketTime = `${String(hour).padStart(2, '0')}:${bucketMinute}`;

  return `${weekdayMap[map.weekday]}-${bucketTime}`;
}
//0615追加終了
type ScheduleItem = {
  id: string;
  enabled: boolean;
  sortOrder: number;
  weekday: string;
  time: string;
  text: string;
  offset: string;
  timezone: string;
};

import type {
  ApiResponse,
  TweetHistory,
  ScheduledPost,
} from '@/lib/api'

//202606追加終了

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const ALLOWED_VIDEO_TYPES = ['video/mp4']
const MAX_IMAGES = 4

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

let mediaIdCounter = 0

interface MediaFile {
  id: string
  file: File
  previewUrl: string
  type: 'image' | 'video'
}

function CharCounter({ length, limit }: { length: number; limit: number }) {
  const pct = limit > 0 ? length / limit : 0
  const color =
    pct >= 1 ? 'text-red-500 font-semibold' :
    pct >= 0.9 ? 'text-yellow-500 font-semibold' :
    'text-gray-400'
  return (
    <p className={`text-xs text-right mt-0.5 ${color}`}>
      {length}/{limit}
    </p>
  )
}

export default function PostsPage() {
  const selectedAccountId = useCurrentAccountId()

  // Tab
  const [tab, setTab] = useState<Tab>('immediate')

  // Subscription / char limit
  const [charLimit, setCharLimit] = useState(280)
  const [subscriptionType, setSubscriptionType] = useState('')

  // Immediate post form
  const [immTexts, setImmTexts] = useState([''])
  const [immQuoteMode, setImmQuoteMode] = useState(false)
  const [immQuoteId, setImmQuoteId] = useState('')
  const [immPosting, setImmPosting] = useState(false)
  const [immError, setImmError] = useState('')
  const [immSuccess, setImmSuccess] = useState('')

  // Media
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Scheduled post form
  const [schText, setSchText] = useState('')
  const [schAt, setSchAt] = useState('')
  const [schCreating, setSchCreating] = useState(false)
  const [schError, setSchError] = useState('')
  const [schSuccess, setSchSuccess] = useState('')

  // Scheduled posts list
  const [scheduled, setScheduled] = useState<ScheduledPost[]>([])
  const [scheduledLoading, setScheduledLoading] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  // 202606追加開始
  // ===== 定期スケジュール追加 =====
  const [weekDay, setWeekDay] = useState('');
  const WEEKDAY_LABELS: Record<string, string> = {
  '0': '日曜日',
  '1': '月曜日',
  '2': '火曜日',
  '3': '水曜日',
  '4': '木曜日',
  '5': '金曜日',
  '6': '土曜日',
  };
  const [scheduleTime, setScheduleTime] = useState('');
  const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hour = String(Math.floor(i / 2)).padStart(2, '0');
  const minute = i % 2 === 0 ? '00' : '30';
  return `${hour}:${minute}`;
  });
  const [timeOffset, setTimeOffset] = useState('5');
  const [timezone, setTimezone] = useState('Asia/Tokyo');
  const TIMEZONES = [
  { value: 'Asia/Tokyo', label: '日本 (JST)' },
  { value: 'America/New_York', label: '米国東部 (EST/EDT)' },
  { value: 'America/Chicago', label: '米国中部 (CST/CDT)' },
  { value: 'America/Denver', label: '米国山岳部 (MST/MDT)' },
  { value: 'America/Los_Angeles', label: '米国西部 (PST/PDT)' },
  { value: 'Europe/London', label: '英国 (GMT/BST)' },
  { value: 'Europe/Paris', label: '中央ヨーロッパ (CET/CEST)' },
  { value: 'Australia/Sydney', label: 'オーストラリア東部' },
  { value: 'Asia/Seoul', label: '韓国 (KST)' },
  { value: 'Asia/Shanghai', label: '中国 (CST)' },
  { value: 'Asia/Singapore', label: 'シンガポール (SGT)' },
  ];
  
  const currentXAccountId = useCurrentAccountId();

  const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL;

  const [scheduleList, setScheduleList] = useState<SchedulePreview[]>([]);
  const [menuOpenIndex, setMenuOpenIndex] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // 週間ビュー用
  const scheduleMap = useMemo(() => {
    const map = new Map<string, SchedulePreview[]>()
    scheduleList.forEach((item) => {
  //0615修正開始
    const key = getWeeklyViewKey(item)
  //0615修正終了
      if (!map.has(key)) {
        map.set(key, [])
      }

      map.get(key)!.push(item)
    })

    return map
  }, [scheduleList])
  const formRef = useRef<HTMLDivElement>(null)

  // 必須チェック
  const isValid =
  weekDay !== '' &&
  scheduleTime !== '' &&
  schText.trim() !== '';

  //削除ボタン
  const handleDelete = async (index: number) => {
  const updatedList = scheduleList
    .filter((_, i) => i !== index)
    .map((item, idx) => ({
      ...item,
      sortOrder: idx + 1,
    }));

  setScheduleList(updatedList);

  await fetchApi('/api/weeks/bulk', {
    method: 'POST',
    body: JSON.stringify({
      xAccountId: currentXAccountId,
      items: updatedList,
    }),
  });
    await loadScheduleList();
  };
  
  //編集ボタン
 const handleEdit = (index: number) => {
  const item = scheduleList[index];

  setEditingId(item.id);

  setWeekDay(item.weekday);
  setScheduleTime(item.time);
  setSchText(item.text);
  setTimeOffset(item.offset);
  setTimezone(item.timezone);

  setMenuOpenIndex(null);

  requestAnimationFrame(() => {
    formRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  });
};

//↑ボタン
const moveUp = async (index: number) => {
  if (index === 0) return;

  const newList = [...scheduleList];

  [newList[index - 1], newList[index]] = [
    newList[index],
    newList[index - 1],
  ];

  const updatedList = newList.map((item, idx) => ({
    ...item,
    sortOrder: idx + 1,
  }));

  setScheduleList(updatedList);

  await fetchApi('/api/weeks/bulk', {
    method: 'POST',
    body: JSON.stringify({
      xAccountId: currentXAccountId,
      items: updatedList,
    }),
  });
};

//↓ボタン
const moveDown = async (index: number) => {
  if (index === scheduleList.length - 1) return;

  const newList = [...scheduleList];

  [newList[index + 1], newList[index]] = [
    newList[index],
    newList[index + 1],
  ];

  const updatedList = newList.map((item, idx) => ({
    ...item,
    sortOrder: idx + 1,
  }));

  setScheduleList(updatedList);

  await fetchApi('/api/weeks/bulk', {
    method: 'POST',
    body: JSON.stringify({
      xAccountId: currentXAccountId,
      items: updatedList,
    }),
  });
};
  //チェックボックス
  const toggleEnabled = async (index: number) => {
  const updatedList = [...scheduleList];

  updatedList[index] = {
    ...updatedList[index],
    enabled: !updatedList[index].enabled,
  };

  setScheduleList(updatedList);

  await fetchApi('/api/weeks/bulk', {
    method: 'POST',
    body: JSON.stringify({
      xAccountId: currentXAccountId,
      items: updatedList,
    }),
  });
  };

const handleSchedulePost = async () => {
  const newItem: SchedulePreview = {
    id: editingId ?? crypto.randomUUID(),
    weekday: weekDay,
    time: scheduleTime,
    offset: timeOffset,
    timezone,
    text: schText,
    sortOrder: 0, // 後で再計算
    enabled: true,
    nextRunAt: null,
  };

  let updatedList: SchedulePreview[];

  // ===== 編集モード =====
  if (editingId) {
    updatedList = scheduleList.map((item) =>
      item.id === editingId ? newItem : item
    );
  } 
  // ===== 新規モード =====
  else {
    updatedList = [...scheduleList, newItem];
  }

  // sortOrderを再採番
  updatedList = updatedList.map((item, index) => ({
    ...item,
    sortOrder: index + 1,
  }));

  //DB保存
  
  await fetchApi('/api/weeks/bulk', {
  method: 'POST',
  body: JSON.stringify({
    xAccountId: currentXAccountId,
    items: updatedList,
  }),
  });
  
  await loadScheduleList();

  //フォームリセット
  setEditingId(null);
  setWeekDay('');
  setScheduleTime('');
  setSchText('');
};

  // 202606追加終了

  // History
  const [history, setHistory] = useState<TweetHistory[]>([])
  // Account id the currently displayed history rows belong to. Used to bind
  // each row to its source account so an in-flight account switch (where
  // selectedAccountId has already changed but loadHistory hasn't refreshed
  // the list yet) can't delete the wrong account's tweet.
  const [historyAccountId, setHistoryAccountId] = useState<string>('')
  // Mirror of historyAccountId so loadHistory can read the *latest* binding
  // when its async fetch resolves, without taking historyAccountId as a
  // dependency (which would recreate loadHistory and double-trigger the
  // mount/account-switch effect).
  const historyAccountIdRef = useRef<string>('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  const loadSubscription = useCallback(async (accountId: string) => {
    if (!accountId) return
    try {
      const res = await api.accounts.subscription(accountId)
      if (res.success) {
        setCharLimit(res.data.charLimit)
        setSubscriptionType(res.data.subscriptionType)
      }
    } catch {
      // fall back to 280
      setCharLimit(280)
      setSubscriptionType('')
    }
  }, [])

  const loadHistory = useCallback(async (cursor?: string, accountId?: string) => {
    const effectiveAccountId = accountId || selectedAccountId || ''
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const res = await api.posts.history({ xAccountId: effectiveAccountId || undefined, limit: 20, cursor })
      if (res.success) {
        if (cursor) {
          // Drop stale paginated responses if the binding has shifted to
          // another account between dispatch and resolution. Read from the
          // ref so we always see the *latest* binding rather than the value
          // captured when this loadHistory closure was created.
          if (effectiveAccountId !== historyAccountIdRef.current) {
            return
          }
          setHistory((prev) => [...prev, ...res.data.items])
          setNextCursor(res.data.nextCursor)
        } else {
          setHistory(res.data.items)
          // Reset binding only on a fresh (non-paginated) load — pagination
          // appends rows that belong to the same account as the first page.
          historyAccountIdRef.current = effectiveAccountId
          setHistoryAccountId(effectiveAccountId)
          setNextCursor(res.data.nextCursor)
        }
      } else {
        setHistoryError('投稿履歴の読み込みに失敗しました')
      }
    } catch {
      setHistoryError('投稿履歴の読み込みに失敗しました')
    } finally {
      setHistoryLoading(false)
    }
  }, [selectedAccountId])

  const handleDeletePost = useCallback(async (tweetId: string, preview: string) => {
    // Bind to historyAccountId (the account these rows were loaded for), not
    // selectedAccountId — these can drift mid-account-switch and we'd otherwise
    // send the wrong credentials for the visible row.
    if (!historyAccountId) {
      alert('アカウントが選択されていません')
      return
    }
    if (!confirm(`この投稿を削除しますか？\n\n「${preview.length > 60 ? preview.slice(0, 60) + '…' : preview}」\n\nXからも完全に削除されます。元には戻せません。`)) {
      return
    }
    setDeletingIds((prev) => new Set(prev).add(tweetId))
    try {
      const res = await api.posts.delete(tweetId, historyAccountId)
      if (res.success) {
        // Refresh from cursor=undefined (first page) instead of just filtering
        // out the row. Filtering would leave nextCursor stale: deleting the
        // last visible row on a multi-page history would hit the empty-state
        // branch and hide the 次へ button, stranding older tweets behind a
        // cursor the user can no longer reach.
        await loadHistory(undefined, historyAccountId)
      } else {
        alert('削除に失敗しました: ' + ((res as { error?: string }).error ?? 'unknown'))
      }
    } catch (err) {
      alert('削除に失敗しました: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(tweetId)
        return next
      })
    }
  }, [historyAccountId, loadHistory])

  const loadScheduled = useCallback(async () => {
    setScheduledLoading(true)
    try {
      const res = await api.posts.listScheduled()
      if (res.success) setScheduled(res.data)
    } catch {
      // silently fail
    } finally {
      setScheduledLoading(false)
    }
  }, [])

  //0612追加開始
const loadScheduleList = useCallback(async () => {
  if (!currentXAccountId) {
    setScheduleList([])
    return
  }

  try {
    const res = await fetchApi<ApiResponse<SchedulePreview[]>>(
      `/api/weeks?xAccountId=${encodeURIComponent(currentXAccountId)}`
    )
    if (res.success) {
      setScheduleList(res.data)
    }
  } catch {
    setScheduleList([])
  }
}, [currentXAccountId])

  //0612追加終了
  const [fetched, setFetched] = useState(false)
  const handleManualFetch = () => {
    if (selectedAccountId) {
      setFetched(true)
      loadHistory(undefined, selectedAccountId)
      loadSubscription(selectedAccountId)
    }
  }

  useEffect(() => {
    if (tab === 'scheduled') {
      loadScheduled()
    }
  }, [tab, loadScheduled])

  //0612追加開始
  useEffect(() => {
  loadScheduleList()
}, [loadScheduleList])
  //0612追加終了

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      mediaFiles.forEach((m) => URL.revokeObjectURL(m.previewUrl))
    }
  }, [mediaFiles])

  //202606新規追加開始
  useEffect(() => {
  console.log("WORKER_URL =", process.env.NEXT_PUBLIC_WORKER_URL);
}, []);
  //202606新規追加終了

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    const newMedia: MediaFile[] = []
    for (const file of files) {
      const isImage = ALLOWED_IMAGE_TYPES.includes(file.type)
      const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type)
      if (!isImage && !isVideo) continue

      // Can't mix video with images; video is solo
      if (isVideo) {
        // Replace all with single video
        mediaFiles.forEach((m) => URL.revokeObjectURL(m.previewUrl))
        const entry: MediaFile = { id: `media-${++mediaIdCounter}`, file, previewUrl: URL.createObjectURL(file), type: 'video' }
        setMediaFiles([entry])
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }

      newMedia.push({ id: `media-${++mediaIdCounter}`, file, previewUrl: URL.createObjectURL(file), type: 'image' })
    }

    setMediaFiles((prev) => {
      // Don't add more than MAX_IMAGES total
      const combined = [...prev.filter((m) => m.type === 'image'), ...newMedia]
      return combined.slice(0, MAX_IMAGES)
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeMedia = (idx: number) => {
    setMediaFiles((prev) => {
      URL.revokeObjectURL(prev[idx].previewUrl)
      return prev.filter((_, i) => i !== idx)
    })
  }

  const uploadAllMedia = async (): Promise<string[]> => {
    if (mediaFiles.length === 0) return []
    setUploading(true)
    try {
      const ids: string[] = []
      for (const m of mediaFiles) {
        const res = await api.media.upload(m.file, selectedAccountId)
        if (res.success) ids.push(res.data.mediaId)
      }
      return ids
    } finally {
      setUploading(false)
    }
  }

  const handleImmediatePost = async (e: React.FormEvent) => {
    e.preventDefault()
    const texts = immTexts.filter((t) => t.trim())
    if (!selectedAccountId || texts.length === 0) return
    setImmPosting(true)
    setImmError('')
    setImmSuccess('')
    try {
      const mediaIds = await uploadAllMedia()

      if (texts.length === 1) {
        const res = await api.posts.create({
          xAccountId: selectedAccountId,
          text: texts[0],
          ...(immQuoteMode && immQuoteId.trim() ? { quoteTweetId: immQuoteId.trim() } : {}),
          ...(mediaIds.length > 0 ? { mediaIds } : {}),
        })
        if (res.success) {
          setImmTexts([''])
          setImmQuoteId('')
          setImmQuoteMode(false)
          setMediaFiles([])
          setImmSuccess('投稿しました')
          loadHistory()
        } else {
          setImmError('投稿に失敗しました')
        }
      } else {
        const res = await api.posts.thread({
          xAccountId: selectedAccountId,
          texts,
          ...(mediaIds.length > 0 ? { mediaIds } : {}),
        })
        if (res.success) {
          setImmTexts([''])
          setMediaFiles([])
          setImmSuccess(`${texts.length}件のスレッドを投稿しました`)
          loadHistory()
        } else {
          setImmError('スレッド投稿に失敗しました')
        }
      }
    } catch {
      setImmError('投稿に失敗しました')
    } finally {
      setImmPosting(false)
    }
  }

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAccountId || !schText.trim() || !schAt) return
    setSchCreating(true)
    setSchError('')
    setSchSuccess('')
    try {
      const res = await api.posts.schedule({
        xAccountId: selectedAccountId,
        text: schText.trim(),
        scheduledAt: new Date(schAt).toISOString(),
      })
      if (res.success) {
        setSchText('')
        setSchAt('')
        setSchSuccess('スケジュールしました')
        loadScheduled()
      } else {
        setSchError(res.error ?? 'エラーが発生しました')
      }
    } catch {
      setSchError('スケジュールに失敗しました')
    } finally {
      setSchCreating(false)
    }
  }

  const handleCancel = async (id: string) => {
    if (!confirm('この投稿をキャンセルしますか？')) return
    setCancellingId(id)
    try {
      await api.posts.cancel(id)
      loadScheduled()
    } catch {
      // silently fail
    } finally {
      setCancellingId(null)
    }
  }

  const addThread = () => setImmTexts((prev) => [...prev, ''])
  const removeThread = (i: number) => setImmTexts((prev) => prev.filter((_, idx) => idx !== i))
  const updateThread = (i: number, v: string) =>
    setImmTexts((prev) => prev.map((t, idx) => (idx === i ? v : t)))

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const canAddMedia =
    mediaFiles.length === 0 ||
    (mediaFiles[0]?.type === 'image' && mediaFiles.length < MAX_IMAGES)

  return (
    <div>
      <Header title="投稿管理" description="即時投稿・予約投稿・履歴" />

      {!fetched && !historyLoading && (
        <div className="mb-4">
          <ApiCostGate onFetch={handleManualFetch} loading={historyLoading} description="投稿履歴・サブスクリプション情報を X API から取得します（$0.005 × 2回）" />
        </div>
      )}

      {/* Top section: tabs */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
        {/* Tab header */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setTab('immediate')}
            className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === 'immediate'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            新規投稿
          </button>
          <button
            onClick={() => setTab('scheduled')}
            className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === 'scheduled'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            予約投稿
          </button>
{/* 202606追加 開始*/}
          <button
            onClick={() => setTab('schedulePost')}
            className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === 'schedulePost'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            >
              スケジュール投稿
          </button>
{/* 202606追加 終了*/}
        </div>

{/* 202606追加開始 */}
{tab === 'schedulePost' && (
  <div
    ref={formRef}
    className="space-y-4 mt-4"
  >

    <div className="flex gap-4 items-start flex-nowrap px-4">

      {/* ===== 曜日選択 ===== */}
      <div className="w-36">
        <label className="block text-xs font-medium text-gray-600 mb-1">
          曜日 <span className="text-red-500">*</span>
        </label>

        <select
          value={weekDay}
          onChange={(e) => setWeekDay(e.target.value)}
          required
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">選択してください</option>
          <option value="0">日曜日</option>
          <option value="1">月曜日</option>
          <option value="2">火曜日</option>
          <option value="3">水曜日</option>
          <option value="4">木曜日</option>
          <option value="5">金曜日</option>
          <option value="6">土曜日</option>
        </select>
      </div>

      {/* ===== 時刻選択 ===== */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          投稿時刻 <span className="text-red-500">*</span>
        </label>

        <select
          value={scheduleTime}
          onChange={(e) => setScheduleTime(e.target.value)}
          required
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">選択してください</option>

          {TIME_OPTIONS.map((time) => (
            <option key={time} value={time}>
              {time}
            </option>
          ))}
        </select>
      </div>
      
      {/* ===== 投稿テキスト ===== */}
      <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            投稿テキスト <span className="text-red-500">*</span>
          </label>
          <textarea
            value={schText}
            onChange={(e) => setSchText(e.target.value)}
            placeholder="ツイートの内容を入力..."
            required
            rows={4}
            maxLength={280}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <CharCounter length={schText.length} limit={280} />
      </div>
              
      {/* ===== 時刻ずらし ===== */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          時間ずらし
        </label>

        <select
          value={timeOffset}
          onChange={(e) => setTimeOffset(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="5">±5分</option>
          <option value="10">±10分</option>
          <option value="15">±15分</option>
        </select>
      </div>
              
      {/* ===== タイムゾーン ===== */}
      <div className="w-48">
        <label className="block text-xs font-medium text-gray-600 mb-1">
          タイムゾーン
        </label>

        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {TIMEZONES.map((tz) => (
            <option
              key={tz.value}
              value={tz.value}
            >
              {tz.label}
            </option>
          ))}
        </select>
      </div>

      {/* キューに追加ボタン */}
      <div className="flex items-start pt-6">
        <button
        type="button"
        disabled={!isValid || (!editingId && scheduleList.length >= 50)}
        onClick={handleSchedulePost}       
        className={`px-4 py-2 rounded-lg text-white
          ${isValid ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-not-allowed'}
        `}
      >
        キューに追加
        </button>
        {scheduleList.length >= 50 && !editingId && (
          <p className="mt-2 text-sm font-medium text-red-600">
            スケジュール投稿は50件まで登録できます
            （現在 {scheduleList.length} 件）
          </p>
        )}
      </div>
</div>
    {/* ===== 登録済みスケジュール ===== */}
    {scheduleList.length > 0 && (
      <div className="mt-6 overflow-x-auto px-4">
        <table className="min-w-full border border-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
                      <th className="border px-3 py-2 w-20"></th>
              <th className="border px-2 py-2">日付</th>       
              <th className="border px-3 py-2">曜日</th>
              <th className="border px-3 py-2">投稿時刻</th>
              <th className="border px-3 py-2">投稿テキスト</th>
              <th className="border px-3 py-2">時刻ずらし</th>
              <th className="border px-3 py-2">タイムゾーン</th>
              <th className="border px-3 py-2 w-16"></th>
            </tr>
          </thead>

          <tbody>
            {scheduleList.map((item, index) => (
              <tr key={item.id}>

                <td className="border px-3 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-2">

                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={item.enabled}
                      onChange={() => toggleEnabled(index)}
                    />

                    <button
                      type="button"
                      onClick={() => moveUp(index)}
                      disabled={index === 0}
                      className="px-1 text-gray-600 disabled:text-gray-300"
                    >
                      ↑
                    </button>

                    <span className="text-xs text-gray-500">
                      {item.sortOrder}
                    </span>

                    <button
                      type="button"
                      onClick={() => moveDown(index)}
                      disabled={index === scheduleList.length - 1}
                      className="px-1 text-gray-600 disabled:text-gray-300"
                    >
                      ↓
                    </button>

                  </div>
                </td>
                {/* 20260614修正開始 */}
                <td className="border px-2 py-2 text-center">
                  {item.nextRunAt
                    ? new Date(item.nextRunAt).toLocaleDateString('ja-JP', {
                        timeZone: item.timezone || 'Asia/Tokyo',
                        month: 'numeric',
                        day: 'numeric',
                      })
                    : '-'}
                </td>
                {/* 20260614修正開始 */}
                <td className="border px-3 py-2">
                  {WEEKDAY_LABELS[item.weekday]}
                </td>

                <td className="border px-3 py-2">
                  {item.time}
                </td>

                <td className="border px-3 py-2">
                  {item.text}
                </td>

                <td className="border px-3 py-2">
                  ±{item.offset}分
                </td>

                <td className="border px-3 py-2">
                   {item.timezone}
                </td>

                <td className="border px-3 py-2 relative">
                  <button
                    type="button"
                    onClick={() =>
                      setMenuOpenIndex(
                        menuOpenIndex === index ? null : index
                      )
                    }
                    className="px-2 py-1 rounded hover:bg-gray-100"
                  >
                    ⋮
                  </button>

                  {menuOpenIndex === index && (
                    <div className="absolute right-2 mt-1 w-24 bg-white border rounded shadow-lg z-10">
                      <button
                        type="button"
                        onClick={() => handleEdit(index)}
                        className="block w-full text-left px-3 py-2 hover:bg-gray-100"
                      >
                        編集
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(index)}
                        className="block w-full text-left px-3 py-2 text-red-500 hover:bg-gray-100"
                      >
                        削除
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
            )}
    {/* 週間ビュー用         */}
    <div className="mt-6 overflow-auto px-4">

      <table className="w-full border-collapse text-xs">

        <thead>
          <tr>
            <th className="border bg-gray-100 w-20">
              時刻
            </th>

            {['日', '月', '火', '水', '木', '金', '土'].map((day) => (
              <th
                key={day}
                className="border bg-gray-100 w-40"
              >
                {day}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {TIME_OPTIONS.map((time) => (
            <tr key={time}>

              {/* 時刻 */}
              <td className="border px-2 py-2 text-center bg-gray-50">
                {time}
              </td>

              {/* 曜日 */}
              {Array.from({ length: 7 }).map((_, weekday) => {

                const key = `${weekday}-${time}`
                const posts = scheduleMap.get(key) || []
                const postedPosts = posts.filter(post => post.lastPostedAt)
const hasPosted = postedPosts.length > 0

                return (
                  <td
                    key={key}
                    className={`border px-2 py-2 align-top ${
                      posts.length > 0 ? 'bg-green-200' : 'bg-white'
                    }`}
                  >
                    <div className="space-y-1">

                      {posts.map((post) => (
                      <button
                        key={post.id}
                        type="button"
                        onClick={() => {
                          const index = scheduleList.findIndex(
                            item => item.id === post.id
                          )

                          if (index >= 0) {
                            handleEdit(index)
                          }
                        }}
                        className={`w-full text-left rounded px-2 py-1 text-[10px] break-words
                          hover:ring-2 hover:ring-blue-500 transition
                          ${
                            post.enabled
                              ? 'bg-blue-200'
                              : 'bg-gray-200'
                          }
                        `}
                        >
                        {/* 20260614修正開始 */}
                        <div className="font-semibold text-[10px]">
                          {post.nextRunAt
                            ? new Date(post.nextRunAt).toLocaleDateString('ja-JP', {
                                timeZone: 'Asia/Tokyo',
                                month: 'numeric',
                                day: 'numeric',
                              })
                            : '-'}
                        </div> 
                        <div className="text-[9px] text-gray-500">
                          {post.timezone}
                        </div>  
                        {/* 20260614修正終了 */}
                        <div className="mt-1">
                          {post.text.length > 10
                            ? `${post.text.slice(0, 10)}...`
                            : post.text}
                        </div>
                      </button>
                    ))}

                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>

      </table>

    </div>
  </div>
)}
{/* 202606追加終了 */}

        <div className="p-5">
          {/* Immediate post tab */}
          {tab === 'immediate' && (
            <form onSubmit={handleImmediatePost} className="space-y-4">
              {immTexts.map((text, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-600">
                      {immTexts.length > 1 ? `ツイート ${i + 1}` : '投稿テキスト'}
                      <span className="text-red-500"> *</span>
                    </label>
                    <div className="flex items-center gap-2">
                      {/* Subscription badge (only on first tweet) */}
                      {i === 0 && subscriptionType && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                          {subscriptionType}
                        </span>
                      )}
                      {immTexts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeThread(i)}
                          className="text-xs text-red-400 hover:text-red-600"
                        >
                          削除
                        </button>
                      )}
                    </div>
                  </div>
                  <textarea
                    value={text}
                    onChange={(e) => updateThread(i, e.target.value)}
                    placeholder="ツイートの内容を入力..."
                    required
                    rows={3}
                    maxLength={charLimit}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  <CharCounter length={text.length} limit={charLimit} />
                </div>
              ))}

              {/* Media attachment (attached to first tweet in thread) */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={[...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES].join(',')}
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {canAddMedia && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    画像/動画を添付{immTexts.length > 1 && '（1つ目のツイート）'}
                    <span className="text-xs text-gray-400">
                      ({mediaFiles.length}/{MAX_IMAGES})
                    </span>
                  </button>
                )}

                {/* Media previews */}
                {mediaFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {mediaFiles.map((m, idx) => (
                      <div key={m.id} className="relative group">
                        {m.type === 'image' ? (
                          <img
                            src={m.previewUrl}
                            alt=""
                            className="w-20 h-20 object-cover rounded-lg border border-gray-200"
                          />
                        ) : (
                          <video
                            src={m.previewUrl}
                            className="w-20 h-20 object-cover rounded-lg border border-gray-200"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => removeMedia(idx)}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-700 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Upload progress indicator */}
                {uploading && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-blue-600">
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    メディアをアップロード中...
                  </div>
                )}
              </div>

              {/* Quote RT toggle (only for single tweets) */}
              {immTexts.length === 1 && (
                <div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={immQuoteMode}
                      onChange={(e) => setImmQuoteMode(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    引用RTする
                  </label>
                  {immQuoteMode && (
                    <input
                      type="text"
                      value={immQuoteId}
                      onChange={(e) => setImmQuoteId(e.target.value)}
                      placeholder="引用するツイートのID"
                      className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>
              )}

              {immError && (
                <div className="bg-red-50 border border-red-200 p-3 text-red-700 text-sm rounded-lg">
                  {immError}
                </div>
              )}
              {immSuccess && (
                <div className="bg-green-50 border border-green-200 p-3 text-green-700 text-sm rounded-lg">
                  {immSuccess}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={addThread}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  + スレッド追加
                </button>
                <button
                  type="submit"
                  disabled={immPosting || uploading || !selectedAccountId || immTexts.every((t) => !t.trim())}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {(immPosting || uploading) && (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                  {uploading ? 'アップロード中...' : immPosting ? '投稿中...' : '投稿'}
                </button>
              </div>
            </form>
          )}

          {/* Scheduled post tab */}
          {tab === 'scheduled' && (
            <div className="space-y-6">
              <form onSubmit={handleSchedule} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    投稿テキスト <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={schText}
                    onChange={(e) => setSchText(e.target.value)}
                    placeholder="ツイートの内容を入力..."
                    required
                    rows={4}
                    maxLength={280}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  <CharCounter length={schText.length} limit={280} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    投稿日時 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={schAt}
                    onChange={(e) => setSchAt(e.target.value)}
                    required
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {schError && (
                  <div className="bg-red-50 border border-red-200 p-3 text-red-700 text-sm rounded-lg">
                    {schError}
                  </div>
                )}
                {schSuccess && (
                  <div className="bg-green-50 border border-green-200 p-3 text-green-700 text-sm rounded-lg">
                    {schSuccess}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={schCreating || !selectedAccountId || !schText.trim() || !schAt}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    {schCreating ? 'スケジュール中...' : 'スケジュール'}
                  </button>
                </div>
              </form>

              {/* Scheduled list */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">スケジュール済み</h3>
                {scheduledLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
                    ))}
                  </div>
                ) : scheduled.length === 0 ? (
                  <p className="text-sm text-gray-400">スケジュール投稿がありません</p>
                ) : (
                  <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                    <table className="w-full min-w-[500px] text-sm">
                      <thead>
                        <tr className="bg-gray-100 border-b border-gray-200">
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">内容</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">投稿日時</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">状態</th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {scheduled.map((p) => (
                          <tr key={p.id} className="hover:bg-white transition-colors">
                            <td className="px-4 py-2 text-gray-700 max-w-xs">
                              <p className="truncate">{p.text}</p>
                            </td>
                            <td className="px-4 py-2 text-gray-500 whitespace-nowrap text-xs">
                              {formatDate(p.scheduledAt)}
                            </td>
                            <td className="px-4 py-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                p.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                                p.status === 'posted' ? 'bg-green-100 text-green-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                {p.status === 'scheduled' ? '予約中' : p.status === 'posted' ? '投稿済' : '失敗'}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right">
                              {p.status === 'scheduled' && (
                                <button
                                  onClick={() => handleCancel(p.id)}
                                  disabled={cancellingId === p.id}
                                  className="text-xs text-red-500 hover:text-red-600 px-3 py-1 rounded-md border border-red-100 hover:border-red-200 disabled:opacity-50 transition-colors"
                                >
                                  {cancellingId === p.id ? 'キャンセル中...' : 'キャンセル'}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>


      {/* History section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">投稿履歴</h2>
        </div>

        {historyError && (
          <div className="px-5 py-3 bg-red-50 border-b border-red-100 text-red-700 text-sm">
            {historyError}
          </div>
        )}

        {historyLoading && history.length === 0 ? (
          <div className="divide-y divide-gray-100">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-4 py-4 animate-pulse">
                <div className="flex items-start gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-gray-200 rounded w-3/4" />
                    <div className="h-3 bg-gray-100 rounded w-1/2" />
                  </div>
                  <div className="flex gap-4">
                    <div className="h-3 bg-gray-100 rounded w-8" />
                    <div className="h-3 bg-gray-100 rounded w-8" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : history.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 text-sm">投稿履歴がありません</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">内容</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">いいね</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">RT</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">リプライ</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">インプレッション</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">日時</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.map((tweet) => {
                    const isExpanded = expandedIds.has(tweet.id)
                    const truncated = tweet.text.length > 50
                    return (
                      <tr key={tweet.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-sm text-gray-700 max-w-xs">
                            {isExpanded || !truncated ? tweet.text : `${tweet.text.slice(0, 50)}…`}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 text-right">
                            {tweet.public_metrics?.like_count ?? '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 text-right">
                            {tweet.public_metrics?.retweet_count ?? '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 text-right">
                            {tweet.public_metrics?.reply_count ?? '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 text-right">
                            {tweet.public_metrics?.impression_count ?? '-'}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400 text-right whitespace-nowrap">
                            {formatDate(tweet.created_at)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-3">
                              {truncated && (
                                <button
                                  onClick={() => toggleExpanded(tweet.id)}
                                  className="text-xs text-blue-500 hover:text-blue-700"
                                >
                                  {isExpanded ? '折りたたむ' : '展開'}
                                </button>
                              )}
                              <button
                                onClick={() => handleDeletePost(tweet.id, tweet.text)}
                                disabled={deletingIds.has(tweet.id) || historyAccountId !== selectedAccountId || historyLoading}
                                className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                title={historyAccountId !== selectedAccountId ? '別アカウントの履歴を読み込み中…' : 'この投稿をXから削除'}
                              >
                                {deletingIds.has(tweet.id) ? '削除中…' : '削除'}
                              </button>
                            </div>
                          </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {nextCursor && (
              <div className="px-5 py-4 border-t border-gray-100 flex justify-center">
                <button
                  onClick={() => loadHistory(nextCursor)}
                  disabled={historyLoading}
                  className="text-sm text-blue-500 hover:text-blue-700 font-medium disabled:opacity-50"
                >
                  {historyLoading ? '読み込み中...' : '次へ'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
