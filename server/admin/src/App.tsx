import {
  Activity,
  BarChart3,
  Box,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Database,
  Eye,
  Film,
  Gauge,
  Layers,
  LineChart,
  Link,
  ListFilter,
  Loader2,
  Moon,
  Play,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Sun,
  Table2,
  ThumbsDown,
  ThumbsUp,
  TimerReset,
  TrainTrack,
  Users,
  XCircle,
  type LucideIcon
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

type Page = 'overview' | 'review' | 'feedback' | 'videos' | 'models' | 'training';
type ThemePreference = 'system' | 'dark' | 'light';
type ReviewLabel = 'positive' | 'false_positive' | 'wrong_timing' | 'duplicate' | 'ignored' | 'needs_more_data';

interface ReviewAction {
  label: string;
  value: ReviewLabel;
  icon: LucideIcon;
  shortcut: string;
}

const reviewActions: ReviewAction[] = [
  { label: 'Positive', value: 'positive', icon: ThumbsUp, shortcut: '1' },
  { label: 'False positive', value: 'false_positive', icon: ThumbsDown, shortcut: '2' },
  { label: 'Wrong timing', value: 'wrong_timing', icon: TimerReset, shortcut: '3' },
  { label: 'Duplicate', value: 'duplicate', icon: Layers, shortcut: '4' },
  { label: 'Ignored', value: 'ignored', icon: Eye, shortcut: '5' },
  { label: 'Needs data', value: 'needs_more_data', icon: ListFilter, shortcut: '6' }
];

interface FeedbackRecord {
  id: string;
  receivedAt: string;
  payload: {
    clientId?: string;
    videoUrl: string | null;
    videoId: string | null;
    occurrenceId: string;
    occurrenceType: string;
    source?: string;
    startSeconds: number;
    summary: string;
    reason?: string;
    feedback: string;
    heuristicConfidence?: number;
    modelConfidence?: number;
    modelId?: string | null;
    modelVersion?: string | null;
    modelSource?: string;
    featureSchemaVersion?: number;
    candidateFeatures?: Record<string, number>;
    evidenceSnapshot?: Array<{
      source: string;
      kind: string;
      startSeconds: number;
      confidence: number;
      reason: string;
      detail?: string;
    }>;
    transcriptContext?: string;
  };
  review: null | {
    id: string;
    label: ReviewLabel;
    notes?: string;
    reviewedAt: string;
  };
}

interface ModelArtifact {
  modelId: string;
  modelVersion: string;
  featureSchemaVersion: number;
  createdAt: string;
  promotedAt?: string | null;
  intercept: number;
  weights: Record<string, number>;
  thresholds: Record<string, number>;
  metrics: Record<string, number>;
  trainingSetSummary: Record<string, number>;
}

interface TrainingRun {
  id: string;
  createdAt: string;
  modelId: string;
  datasetSize: number;
  validationSize: number;
  metrics: Record<string, number>;
  status: string;
}

interface TrainingDatasetRow {
  feedbackId: string;
  occurrenceId: string;
  videoId: string | null;
  source: string;
  startSeconds: number;
  receivedAt: string;
  reviewedAt: string | null;
  reviewLabel: ReviewLabel | null;
  trainingLabel: 0 | 1 | null;
  featureSchemaVersion: number | null;
  featureCount: number;
  compatible: boolean;
  trainable: boolean;
  exclusionReason: string | null;
}

interface PromotionRecord {
  id: string;
  modelId: string;
  promotedAt: string;
  action: 'promote' | 'rollback';
}

interface ModelEvaluation {
  modelId: string;
  metrics: Record<string, number>;
  trainingSetSummary: Record<string, number>;
  promotedComparison: null | {
    promotedModelId: string;
    metricDeltas: Record<string, number>;
  };
}

interface TrainingReadiness {
  featureSchemaVersion: number;
  totalExamples: number;
  compatibleExamples: number;
  incompatibleExamples: number;
  positiveExamples: number;
  negativeExamples: number;
  ready: boolean;
  blocker: string | null;
}

interface DetectorQualityRow {
  source: string;
  total: number;
  reviewed: number;
  pending: number;
  positive: number;
  falsePositive: number;
  wrongTiming: number;
  duplicate: number;
  ignored: number;
  needsMoreData: number;
  trainablePositive: number;
  trainableNegative: number;
  positiveRate: number;
}

interface Summary {
  totalFeedback: number;
  uniqueClients: number;
  reviewedFeedback: number;
  pendingFeedback: number;
  modelVersions: number;
  promotedModel: ModelArtifact | null;
  detectorSourceDistribution: Record<string, number>;
  detectorQuality: DetectorQualityRow[];
  feedbackLabelDistribution: Record<string, number>;
  reviewThroughput: Array<{ date: string; reviewed: number }>;
  modelPerformance: Record<string, number>;
  trainingReadiness: TrainingReadiness;
}

interface VideoSummaryRow {
  videoId: string;
  url: string | null;
  feedback: number;
  pending: number;
  reviewed: number;
  sources: Set<string>;
  latestReceivedAt: string;
}

interface DashboardData {
  summary: Summary | null;
  feedback: FeedbackRecord[];
  models: ModelArtifact[];
  promoted: ModelArtifact | null;
  promotionHistory: PromotionRecord[];
  trainingRuns: TrainingRun[];
  trainingDataset: TrainingDatasetRow[];
}

interface GlobalSearchResult {
  id: string;
  page: Page;
  category: string;
  title: string;
  meta: string;
  detail: string;
  icon: LucideIcon;
}

const themeStorageKey = 'yapskippr.adminTheme';

const navigation = [
  { page: 'overview' as const, label: 'Overview', icon: BarChart3 },
  { page: 'review' as const, label: 'Review Queue', icon: ClipboardCheck },
  { page: 'feedback' as const, label: 'Feedback', icon: Table2 },
  { page: 'videos' as const, label: 'Videos', icon: Film },
  { page: 'models' as const, label: 'Models', icon: Layers },
  { page: 'training' as const, label: 'Training', icon: TrainTrack }
];

export function App(): JSX.Element {
  const [page, setPage] = useState<Page>('overview');
  const [token, setToken] = useState(() => localStorage.getItem('yapskippr.adminToken') ?? '');
  const [sessionAuthenticated, setSessionAuthenticated] = useState(false);
  const [themePreference, setThemePreference] = useThemePreference();
  const [globalQuery, setGlobalQuery] = useState('');
  const [data, setData] = useState<DashboardData>({
    summary: null,
    feedback: [],
    models: [],
    promoted: null,
    promotionHistory: [],
    trainingRuns: [],
    trainingDataset: []
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAuth = Boolean(token) || sessionAuthenticated;
  const globalResults = useMemo(() => buildGlobalSearchResults(data, globalQuery), [data, globalQuery]);

  async function refresh(): Promise<void> {
    if (!hasAuth) return;
    setLoading(true);
    setError(null);
    try {
      const [summary, feedback, models, training, trainingDataset] = await Promise.all([
        api<Summary>('/admin/api/summary', token),
        api<{ items: FeedbackRecord[] }>('/admin/api/feedback', token),
        api<{ items: ModelArtifact[]; promoted: ModelArtifact | null; history: PromotionRecord[] }>('/admin/api/models', token),
        api<{ items: TrainingRun[] }>('/admin/api/training-runs', token),
        api<{ items: TrainingDatasetRow[] }>('/admin/api/training-dataset', token)
      ]);
      setData({
        summary,
        feedback: feedback.items,
        models: models.items,
        promoted: models.promoted,
        promotionHistory: models.history,
        trainingRuns: training.items,
        trainingDataset: trainingDataset.items
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [token, sessionAuthenticated]);

  useEffect(() => {
    if (token) return;
    void api<{ ok: boolean }>('/admin/api/session', '').then(() => {
      setSessionAuthenticated(true);
    }).catch(() => {
      setSessionAuthenticated(false);
    });
  }, [token]);

  async function saveToken(value: string): Promise<void> {
    const response = await fetch('/admin/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token: value })
    });
    if (!response.ok) throw new Error('Invalid admin token.');
    localStorage.removeItem('yapskippr.adminToken');
    setToken('');
    setSessionAuthenticated(true);
  }

  function openSearchResult(target: Page): void {
    setPage(target);
    setGlobalQuery('');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Activity size={22} /></div>
          <div>
            <strong>YapSkippr</strong>
            <span>Model Ops</span>
          </div>
        </div>
        <nav>
          {navigation.map((item) => {
            const Icon = item.icon;
            const count = item.page === 'review' ? data.summary?.pendingFeedback : undefined;
            return (
              <button key={item.page} type="button" data-active={page === item.page} onClick={() => setPage(item.page)}>
                <Icon size={18} />
                <span>{item.label}</span>
                {count !== undefined ? <em>{count}</em> : null}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-status">
          <span><CheckCircle2 size={14} /> API connected</span>
          <span><Database size={14} /> {data.feedback.length} feedback rows</span>
          <span><Shield size={14} /> Admin only</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="Search dashboard"
              type="search"
              value={globalQuery}
              onChange={(event) => setGlobalQuery(event.target.value)}
              placeholder="Search videos, feedback, or models..."
            />
          </label>
          <div className="topbar-actions">
            <ThemeSwitch value={themePreference} onChange={setThemePreference} />
            <button type="button" className="icon-button" onClick={() => void refresh()} aria-label="Refresh dashboard">
              {loading ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
            </button>
            <div className="admin-pill">AD<span>Admin</span></div>
          </div>
        </header>

        {!hasAuth ? <LoginPanel onSave={saveToken} /> : null}
        {error ? <div className="alert"><XCircle size={18} /> {error}</div> : null}
        {hasAuth && globalQuery.trim() ? (
          <GlobalSearchResults query={globalQuery} results={globalResults} onOpen={openSearchResult} />
        ) : null}

        {hasAuth ? (
          <>
            {page === 'overview' ? <Overview data={data} onPageChange={setPage} /> : null}
            {page === 'review' ? <ReviewQueue token={token} data={data} onRefresh={refresh} /> : null}
            {page === 'feedback' ? <FeedbackTable items={data.feedback} /> : null}
            {page === 'videos' ? <VideosTable items={data.feedback} /> : null}
            {page === 'models' ? <ModelsPage token={token} models={data.models} promoted={data.promoted} history={data.promotionHistory} onRefresh={refresh} /> : null}
            {page === 'training' ? <TrainingPage token={token} summary={data.summary} feedback={data.feedback} models={data.models} runs={data.trainingRuns} trainingDataset={data.trainingDataset} promoted={data.promoted} onRefresh={refresh} /> : null}
          </>
        ) : null}
      </main>
    </div>
  );
}

function GlobalSearchResults({
  query,
  results,
  onOpen
}: {
  query: string;
  results: GlobalSearchResult[];
  onOpen: (page: Page) => void;
}): JSX.Element {
  return (
    <section className="global-search-panel" aria-live="polite">
      <div className="global-search-head">
        <div>
          <span>Global search</span>
          <h2>Search Results</h2>
        </div>
        <strong>{results.length} matches</strong>
      </div>
      {results.length ? (
        <div className="global-search-results">
          {results.map((result) => {
            const Icon = result.icon;
            return (
              <button
                key={result.id}
                type="button"
                className="global-search-result"
                aria-label={`Open ${result.category.toLowerCase()} ${result.title}`}
                onClick={() => onOpen(result.page)}
              >
                <span className="result-icon"><Icon size={16} /></span>
                <span>
                  <small>{result.category} · {result.meta}</small>
                  <strong>{result.title}</strong>
                  <em>{result.detail}</em>
                </span>
                <ChevronRight size={16} />
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState title={`No matches for "${query.trim()}"`} detail="Try a video ID, occurrence ID, source, model ID, or review label." />
      )}
    </section>
  );
}

function Overview({ data, onPageChange }: { data: DashboardData; onPageChange: (page: Page) => void }): JSX.Element {
  const summary = data.summary;
  const sourceRows = Object.entries(summary?.detectorSourceDistribution ?? {});
  const labelRows = Object.entries(summary?.feedbackLabelDistribution ?? {});
  const readiness = summary?.trainingReadiness ?? null;

  return (
    <section className="page-grid">
      <PageTitle title="Overview" description="System health, usage, feedback quality, and promoted model performance." />
      <div className="metric-grid">
        <MetricCard icon={Database} label="Total Feedback" value={summary?.totalFeedback ?? 0} accent="blue" detail="All submitted reports" />
        <MetricCard icon={Users} label="Reporting Clients" value={summary?.uniqueClients ?? 0} accent="orange" detail="Anonymous installs" />
        <MetricCard icon={CheckCircle2} label="Reviewed" value={summary?.reviewedFeedback ?? 0} accent="green" detail="Admin labeled" />
        <MetricCard icon={TimerReset} label="Pending Review" value={summary?.pendingFeedback ?? 0} accent="yellow" detail="Queue size" />
        <MetricCard icon={Film} label="Videos Tracked" value={uniqueVideoCount(data.feedback)} accent="purple" detail="Unique videos" />
        <MetricCard icon={Layers} label="Models" value={summary?.modelVersions ?? 0} accent="slate" detail={data.promoted ? '1 promoted' : 'None promoted'} />
      </div>
      <div className="dashboard-layout">
        <Panel title="Usage Over Time" action="Daily">
          <LineGraph rows={summary?.reviewThroughput ?? []} />
        </Panel>
        <Panel title="Detector Source Distribution" action="All time">
          <BarList rows={sourceRows} />
        </Panel>
        <Panel title="Detector Quality" action="Reviewed">
          <DetectorQualityList rows={summary?.detectorQuality ?? []} />
        </Panel>
        <Panel title="Review Queue">
          <div className="queue-card">
            <div>
              <strong>{summary?.pendingFeedback ?? 0}</strong>
              <span>Pending</span>
            </div>
            <div>
              <strong>{reviewedPercent(summary)}%</strong>
              <span>Reviewed</span>
            </div>
          </div>
          <div className="meter"><span style={{ width: `${reviewedPercent(summary)}%` }} /></div>
          <button type="button" className="primary wide" onClick={() => onPageChange('review')}>Review next <ChevronRight size={16} /></button>
        </Panel>
        <Panel title="Feedback Labels">
          <Donut rows={labelRows} total={summary?.totalFeedback ?? 0} />
        </Panel>
        <Panel title="Model Performance">
          <MetricStrip metrics={summary?.modelPerformance ?? {}} />
        </Panel>
        <Panel title="Training Dataset" action={readiness ? `Schema ${readiness.featureSchemaVersion}` : undefined}>
          <TrainingDatasetSummary readiness={readiness} />
        </Panel>
        <Panel title="All Data Available">
          <div className="placeholder-grid">
            <span>Feedback payloads</span>
            <span>Candidate features</span>
            <span>Review labels</span>
            <span>Training runs</span>
            <span>Promotion history</span>
            <span>Detector evidence</span>
            <span>Detector quality</span>
          </div>
        </Panel>
      </div>
    </section>
  );
}

function DetectorQualityList({ rows }: { rows: DetectorQualityRow[] }): JSX.Element {
  if (rows.length === 0) return <EmptyState title="No detector reviews yet" detail="Reviewed feedback will populate source quality metrics." />;

  return (
    <div className="quality-list">
      {rows.map((row) => (
        <div key={row.source}>
          <strong>{sourceLabel(row.source)}</strong>
          <span>{row.reviewed.toLocaleString()} reviewed · {row.pending.toLocaleString()} pending</span>
          <em>{formatPercent(row.positiveRate)} positive</em>
          <small>{row.trainablePositive.toLocaleString()} positive / {row.trainableNegative.toLocaleString()} negative trainable</small>
        </div>
      ))}
    </div>
  );
}

function TrainingDatasetSummary({ readiness }: { readiness: TrainingReadiness | null }): JSX.Element {
  if (!readiness) return <EmptyState title="No training dataset data" detail="Refresh after feedback has been reviewed." />;

  return (
    <div className="dataset-summary">
      <div>
        <span>Compatible examples</span>
        <strong>{readiness.compatibleExamples.toLocaleString()}</strong>
      </div>
      <div>
        <span>Incompatible examples</span>
        <strong>{readiness.incompatibleExamples.toLocaleString()}</strong>
      </div>
      <div>
        <span>Label balance</span>
        <strong>{readiness.positiveExamples.toLocaleString()} / {readiness.negativeExamples.toLocaleString()}</strong>
      </div>
      <p>{readiness.blocker ?? 'Ready to train a schema-compatible model.'}</p>
    </div>
  );
}

function ReviewQueue({ token, data, onRefresh }: { token: string; data: DashboardData; onRefresh: () => Promise<void> }): JSX.Element {
  const [selectedSource, setSelectedSource] = useState('all');
  const [busyLabel, setBusyLabel] = useState<ReviewLabel | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const submittingReviewRef = useRef(false);
  const sources = useMemo(() => uniqueSources(data.feedback), [data.feedback]);
  const pending = data.feedback.filter((item) => !item.review && (selectedSource === 'all' || feedbackSource(item) === selectedSource));
  const current = pending[0];
  const recent = data.feedback.filter((item) => item.review).slice(0, 5);

  async function submit(label: ReviewLabel): Promise<void> {
    if (!current) return;
    if (submittingReviewRef.current) return;
    submittingReviewRef.current = true;
    setBusyLabel(label);
    try {
      const notes = reviewNotes.trim();
      await api(`/admin/feedback/${current.id}/review`, token, {
        method: 'POST',
        body: JSON.stringify({
          label,
          ...(notes ? { notes } : {})
        })
      });
      await onRefresh();
      setReviewNotes('');
    } finally {
      submittingReviewRef.current = false;
      setBusyLabel(null);
    }
  }

  useEffect(() => {
    setReviewNotes('');
  }, [current?.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!current) return;
      if (busyLabel !== null) return;
      if (isEditableShortcutTarget(event.target)) return;
      const action = reviewActions.find((item) => item.shortcut === event.key);
      if (!action) return;
      event.preventDefault();
      void submit(action.value);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busyLabel, current?.id, reviewNotes]);

  return (
    <section className="page-grid">
      <PageTitle title="Review Queue" description="Review one occurrence at a time and advance automatically after each decision." />
      <div className="review-layout">
        <article className="review-focus" aria-busy={busyLabel !== null}>
          {current ? (
            <>
              <div className="review-head">
                <div>
                  <span className="source-chip">{current.payload.source ?? current.payload.occurrenceType}</span>
                  <h2>{current.payload.summary}</h2>
                </div>
                <a href={current.payload.videoUrl ?? '#'} target="_blank" rel="noreferrer">Open video <Link size={15} /></a>
              </div>
              <dl className="review-facts">
                <div><dt>Timecode</dt><dd>{formatTime(current.payload.startSeconds)}</dd></div>
                <div><dt>Heuristic</dt><dd>{formatPercent(current.payload.heuristicConfidence)}</dd></div>
                <div><dt>Model</dt><dd>{formatPercent(current.payload.modelConfidence)}</dd></div>
                <div><dt>Model version</dt><dd>{current.payload.modelVersion ?? 'fallback'}</dd></div>
              </dl>
              <section className="evidence-box">
                <h3>Evidence</h3>
                {(current.payload.evidenceSnapshot ?? []).map((evidence, index) => (
                  <div key={`${evidence.source}-${index}`} className="evidence-row">
                    <span>{evidence.source}</span>
                    <strong>{evidence.kind}</strong>
                    <em>{formatPercent(evidence.confidence)}</em>
                    <p>{evidence.detail ?? evidence.reason}</p>
                  </div>
                ))}
              </section>
              <section className="transcript-box">
                <h3>Transcript context</h3>
                <p>{current.payload.transcriptContext || 'No transcript context submitted.'}</p>
              </section>
              <section className="feedback-box">
                <h3>Extension Feedback</h3>
                <div className="feedback-grid">
                  <div>
                    <span>Submitted as</span>
                    <LabelBadge label={current.payload.feedback} />
                  </div>
                  <p>{current.payload.notes || 'No viewer note submitted.'}</p>
                </div>
              </section>
              <label className="review-notes">
                <span>Admin notes</span>
                <textarea
                  aria-label="Admin review notes"
                  value={reviewNotes}
                  onChange={(event) => setReviewNotes(event.target.value)}
                  placeholder="Optional review notes"
                />
              </label>
              <div className="review-actions">
                {reviewActions.map((action) => (
                  <ReviewButton key={action.value} action={action} busy={busyLabel} onSubmit={submit} />
                ))}
              </div>
            </>
          ) : (
            <EmptyState title="Queue clear" detail="No pending feedback matches the current filter." />
          )}
        </article>
        <aside className="review-side">
          <Panel title="Queue Progress">
            <label className="filter-control review-source-filter">
              <span>Source</span>
              <select aria-label="Review queue source filter" value={selectedSource} onChange={(event) => setSelectedSource(event.target.value)}>
                <option value="all">All sources</option>
                {sources.map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}
              </select>
            </label>
            <strong className="queue-number">{pending.length}</strong>
            <span>items pending</span>
          </Panel>
          <Panel title="Recent Reviews">
            <div className="recent-list">
              {recent.length ? recent.map((item) => (
                <div key={item.id} className="recent-review">
                  <span><LabelBadge label={item.review?.label ?? 'ignored'} /> {timeAgo(item.review?.reviewedAt ?? item.receivedAt)}</span>
                  {item.review?.notes ? <small>{item.review.notes}</small> : null}
                </div>
              )) : <EmptyState title="No reviews yet" detail="Completed reviews will appear here while you work through the queue." />}
            </div>
          </Panel>
        </aside>
      </div>
    </section>
  );
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function FeedbackTable({ items }: { items: FeedbackRecord[] }): JSX.Element {
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [sort, setSort] = useState('received-desc');
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null);
  const sources = useMemo(() => uniqueSources(items), [items]);
  const filtered = useMemo(() => {
    return items
      .filter((item) => matchesQuery(item, query))
      .filter((item) => sourceFilter === 'all' || feedbackSource(item) === sourceFilter)
      .filter((item) => {
        if (reviewFilter === 'all') return true;
        if (reviewFilter === 'pending') return !item.review;
        return Boolean(item.review);
      })
      .sort((a, b) => compareFeedback(a, b, sort));
  }, [items, query, reviewFilter, sort, sourceFilter]);
  const selectedFeedback = selectedFeedbackId ? items.find((item) => item.id === selectedFeedbackId) ?? null : null;

  useEffect(() => {
    setSelectedFeedbackId(null);
  }, [query, reviewFilter, sourceFilter]);

  return (
    <section className="page-grid">
      <PageTitle title="Feedback" description="Search, filter, and inspect submitted feedback payloads." />
      <div className="table-toolbar">
        <label className="inline-search">
          <Search size={16} />
          <input aria-label="Search feedback" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search feedback..." />
        </label>
        <label className="filter-control">
          <span>Source</span>
          <select aria-label="Feedback source filter" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
            <option value="all">All sources</option>
            {sources.map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}
          </select>
        </label>
        <label className="filter-control">
          <span>Review</span>
          <select aria-label="Feedback review filter" value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)}>
            <option value="all">All reviews</option>
            <option value="pending">Pending only</option>
            <option value="reviewed">Reviewed only</option>
          </select>
        </label>
        <label className="filter-control">
          <span>Sort</span>
          <select aria-label="Feedback sort" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="received-desc">Newest first</option>
            <option value="received-asc">Oldest first</option>
            <option value="model-desc">Model confidence</option>
            <option value="heuristic-desc">Heuristic confidence</option>
            <option value="time-asc">Earliest timecode</option>
          </select>
        </label>
      </div>
      <DataTable columns={['Received', 'Video', 'Occurrence', 'Source', 'Timecode', 'Heuristic', 'Model', 'Review', 'Actions']} rows={filtered.map((item) => [
        timeAgo(item.receivedAt),
        item.payload.videoId ?? 'unknown',
        item.payload.occurrenceId,
        sourceLabel(feedbackSource(item)),
        formatTime(item.payload.startSeconds),
        formatPercent(item.payload.heuristicConfidence),
        formatPercent(item.payload.modelConfidence),
        item.review ? <LabelBadge label={item.review.label} /> : <span className="status pending">Pending</span>,
        <div className="table-actions">
          <button type="button" aria-label={`Inspect feedback ${item.payload.occurrenceId}`} onClick={() => setSelectedFeedbackId(item.id)}>
            <Eye size={14} /> Inspect
          </button>
        </div>
      ])} />
      {selectedFeedback ? <FeedbackDetailPanel item={selectedFeedback} /> : null}
    </section>
  );
}

function FeedbackDetailPanel({ item }: { item: FeedbackRecord }): JSX.Element {
  const features = Object.entries(item.payload.candidateFeatures ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const evidence = item.payload.evidenceSnapshot ?? [];
  const timecodeHref = buildTimecodeUrl(item.payload.videoUrl, item.payload.startSeconds);

  return (
    <Panel title="Feedback Details">
      <div className="feedback-detail-grid">
        <section className="detail-section">
          <h3>Candidate summary</h3>
          <div className="summary-list">
            <DetailRow label="Occurrence" value={item.payload.occurrenceId} />
            <DetailRow label="Video" value={item.payload.videoId ?? 'unknown'} />
            <DetailRow label="Client" value={item.payload.clientId ?? 'anonymous'} />
            <DetailRow label="Timecode" value={formatTime(item.payload.startSeconds)} />
            <DetailRow label="Source" value={sourceLabel(feedbackSource(item))} />
            <DetailRow label="Received" value={timeAgo(item.receivedAt)} />
          </div>
          {timecodeHref ? (
            <a className="detail-link" href={timecodeHref} target="_blank" rel="noreferrer">
              <Link size={14} /> Open at timecode
            </a>
          ) : null}
        </section>
        <section className="detail-section">
          <h3>Model metadata</h3>
          <div className="summary-list">
            <DetailRow label="Heuristic confidence" value={formatPercent(item.payload.heuristicConfidence)} />
            <DetailRow label="Model confidence" value={formatPercent(item.payload.modelConfidence)} />
            <DetailRow label="Model" value={item.payload.modelId ?? 'fallback'} />
            <DetailRow label="Version" value={item.payload.modelVersion ?? 'fallback'} />
            <DetailRow label="Feature schema" value={item.payload.featureSchemaVersion === undefined ? '-' : String(item.payload.featureSchemaVersion)} />
          </div>
        </section>
        <section className="detail-section detail-section-wide">
          <h3>Evidence snapshot</h3>
          {evidence.length ? (
            <div className="detail-evidence-list">
              {evidence.map((entry, index) => (
                <div key={`${entry.source}-${entry.startSeconds}-${index}`} className="detail-evidence-row">
                  <span>{sourceLabel(entry.source)}</span>
                  <strong>{entry.kind}</strong>
                  <em>{formatTime(entry.startSeconds)} · {formatPercent(entry.confidence)}</em>
                  <p>{entry.detail ?? entry.reason}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No evidence snapshot" detail="This payload did not include detector evidence details." />
          )}
        </section>
        <section className="detail-section">
          <h3>Candidate features</h3>
          {features.length ? (
            <div className="feature-list">
              {features.map(([feature, value]) => <DetailRow key={feature} label={feature} value={formatFeatureValue(value)} />)}
            </div>
          ) : (
            <EmptyState title="No candidate features" detail="This payload cannot be used for model training yet." />
          )}
        </section>
        <section className="detail-section">
          <h3>Transcript context</h3>
          <p>{item.payload.transcriptContext || 'No transcript context submitted.'}</p>
          <h3>Extension feedback</h3>
          <div className="summary-list">
            <DetailRow label="Submitted as" value={item.payload.feedback} />
            <DetailRow label="Viewer notes" value={item.payload.notes ?? 'No viewer note submitted.'} />
            <DetailRow label="Admin review" value={item.review?.label ?? 'pending'} />
          </div>
        </section>
      </div>
    </Panel>
  );
}

function DetailRow({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function VideosTable({ items }: { items: FeedbackRecord[] }): JSX.Element {
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sort, setSort] = useState('feedback-desc');
  const sources = useMemo(() => uniqueSources(items), [items]);
  const videos = useMemo(() => {
    return summarizeVideos(items)
      .filter((video) => matchesQuery({ videoId: video.videoId, url: video.url, sources: [...video.sources] }, query))
      .filter((video) => sourceFilter === 'all' || video.sources.has(sourceFilter))
      .sort((a, b) => compareVideos(a, b, sort));
  }, [items, query, sort, sourceFilter]);

  const videoRows = videos.map((video) => [
    video.videoId,
    video.feedback,
    video.pending,
    video.reviewed,
    [...video.sources].map(sourceLabel).join(', '),
    timeAgo(video.latestReceivedAt),
    video.url ? <a href={video.url} target="_blank" rel="noreferrer">Open</a> : '-'
  ]);

  return (
    <section className="page-grid">
      <PageTitle title="Videos" description="Feedback grouped by YouTube video for source and queue analysis." />
      <div className="table-toolbar">
        <label className="inline-search">
          <Search size={16} />
          <input aria-label="Search videos" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search videos..." />
        </label>
        <label className="filter-control">
          <span>Source</span>
          <select aria-label="Video source filter" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
            <option value="all">All sources</option>
            {sources.map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}
          </select>
        </label>
        <label className="filter-control">
          <span>Sort</span>
          <select aria-label="Video sort" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="feedback-desc">Most feedback</option>
            <option value="pending-desc">Most pending</option>
            <option value="reviewed-desc">Most reviewed</option>
            <option value="recent-desc">Recently reported</option>
            <option value="video-asc">Video ID</option>
          </select>
        </label>
      </div>
      <DataTable columns={['Video ID', 'Feedback', 'Pending', 'Reviewed', 'Sources', 'Latest', 'URL']} rows={videoRows} />
    </section>
  );
}

function ModelsPage({
  token,
  models,
  promoted,
  history,
  onRefresh
}: {
  token: string;
  models: ModelArtifact[];
  promoted: ModelArtifact | null;
  history: PromotionRecord[];
  onRefresh: () => Promise<void>;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState('created-desc');
  const [selectedEvaluation, setSelectedEvaluation] = useState<{ model: ModelArtifact; evaluation: ModelEvaluation } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const visibleModels = useMemo(() => {
    return models
      .filter((model) => matchesQuery(model, query))
      .filter((model) => {
        if (statusFilter === 'all') return true;
        const isPromoted = promoted?.modelId === model.modelId;
        return statusFilter === 'promoted' ? isPromoted : !isPromoted;
      })
      .sort((a, b) => compareModels(a, b, sort, promoted?.modelId));
  }, [models, promoted?.modelId, query, sort, statusFilter]);

  async function inspect(model: ModelArtifact): Promise<void> {
    setBusyAction(`inspect:${model.modelId}`);
    setActionError(null);
    try {
      const evaluation = await api<ModelEvaluation>(`/admin/models/${model.modelId}/evaluation`, token);
      setSelectedEvaluation({ model, evaluation });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function promote(id: string): Promise<void> {
    setBusyAction(`promote:${id}`);
    setActionError(null);
    try {
      await api(`/admin/models/${id}/promote`, token, { method: 'POST' });
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function rollback(id: string): Promise<void> {
    setBusyAction(`rollback:${id}`);
    setActionError(null);
    try {
      await api(`/admin/models/${id}/rollback`, token, { method: 'POST' });
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="page-grid">
      <PageTitle title="Models" description="Inspect artifacts, metrics, promotion state, and rollback history." />
      <div className="table-toolbar">
        <label className="inline-search">
          <Search size={16} />
          <input aria-label="Search models" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models..." />
        </label>
        <label className="filter-control">
          <span>Status</span>
          <select aria-label="Model status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All models</option>
            <option value="promoted">Promoted</option>
            <option value="draft">Drafts</option>
          </select>
        </label>
        <label className="filter-control">
          <span>Sort</span>
          <select aria-label="Model sort" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="created-desc">Newest first</option>
            <option value="f1-desc">Best F1</option>
            <option value="accuracy-desc">Best accuracy</option>
            <option value="examples-desc">Most examples</option>
            <option value="version-asc">Version</option>
          </select>
        </label>
      </div>
      {actionError ? <div className="inline-alert"><XCircle size={16} /> {actionError}</div> : null}
      <DataTable columns={['Model', 'Version', 'Status', 'Accuracy', 'F1', 'AUC', 'Examples', 'Actions']} rows={visibleModels.map((model) => [
        <code>{model.modelId}</code>,
        model.modelVersion,
        promoted?.modelId === model.modelId ? <span className="status positive">Promoted</span> : <span className="status">Draft</span>,
        formatMetric(model.metrics.accuracy),
        formatMetric(model.metrics.f1),
        formatMetric(model.metrics.auc),
        model.trainingSetSummary.examples ?? 0,
        <div className="table-actions">
          <button type="button" aria-label="Inspect model" onClick={() => void inspect(model)} disabled={busyAction !== null}>
            {busyAction === `inspect:${model.modelId}` ? <Loader2 size={14} className="spin" /> : <Eye size={14} />} Inspect
          </button>
          <button type="button" onClick={() => void promote(model.modelId)} disabled={busyAction !== null || promoted?.modelId === model.modelId}>
            {busyAction === `promote:${model.modelId}` ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />} Promote
          </button>
          <button type="button" onClick={() => void rollback(model.modelId)} disabled={busyAction !== null || promoted?.modelId !== model.modelId}>
            {busyAction === `rollback:${model.modelId}` ? <Loader2 size={14} className="spin" /> : <TimerReset size={14} />} Rollback
          </button>
        </div>
      ])} />
      {selectedEvaluation ? <ModelEvaluationPanel model={selectedEvaluation.model} evaluation={selectedEvaluation.evaluation} /> : null}
      <div className="promotion-history">
        <Panel title="Promotion History">
          {history.length ? (
            <div className="history-list">
              {history.slice(0, 8).map((entry) => (
                <div key={entry.id} className="history-row">
                  <LabelBadge label={entry.action} />
                  <code>{entry.modelId}</code>
                  <span>{timeAgo(entry.promotedAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No promotions yet" detail="Promoted and rolled back model versions will appear here." />
          )}
        </Panel>
      </div>
    </section>
  );
}

function ModelEvaluationPanel({ model, evaluation }: { model: ModelArtifact; evaluation: ModelEvaluation }): JSX.Element {
  const weights = Object.entries(model.weights)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 10);
  const summary = Object.entries(evaluation.trainingSetSummary);
  const thresholds = Object.entries(model.thresholds).sort(([a], [b]) => a.localeCompare(b));
  const comparison = Object.entries(evaluation.promotedComparison?.metricDeltas ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Panel title="Model Evaluation">
      <div className="evaluation-head">
        <div>
          <span>Model</span>
          <code>{evaluation.modelId}</code>
        </div>
        <MetricStrip metrics={evaluation.metrics} />
      </div>
      <div className="model-detail-grid">
        <section>
          <h3>Feature weights</h3>
          <div className="weight-list">
            {weights.map(([feature, weight]) => (
              <div key={feature}>
                <span>{feature}</span>
                <strong data-direction={weight >= 0 ? 'positive' : 'negative'}>{formatSignedMetric(weight)}</strong>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h3>Artifact metadata</h3>
          <div className="summary-list">
            <DetailRow label="Model version" value={model.modelVersion} />
            <DetailRow label="Feature schema" value={model.featureSchemaVersion} />
            <DetailRow label="Created" value={formatAbsoluteDate(model.createdAt)} />
            <DetailRow label="Promoted" value={model.promotedAt ? formatAbsoluteDate(model.promotedAt) : 'Draft'} />
            <DetailRow label="Intercept" value={formatSignedMetric(model.intercept)} />
          </div>
        </section>
        <section>
          <h3>Thresholds</h3>
          <div className="summary-list">
            {thresholds.map(([label, value]) => <DetailRow key={label} label={label} value={formatMetric(value)} />)}
          </div>
        </section>
        <section>
          <h3>Promoted comparison</h3>
          {evaluation.promotedComparison ? (
            <div className="summary-list">
              <DetailRow label="Baseline" value={evaluation.promotedComparison.promotedModelId} />
              {comparison.map(([label, value]) => <DetailRow key={label} label={`${label} delta`} value={formatSignedMetric(value)} />)}
            </div>
          ) : (
            <p className="muted-note">No promoted baseline yet.</p>
          )}
        </section>
        <section>
          <h3>Training summary</h3>
          <div className="summary-list">
            {summary.map(([key, value]) => (
              <div key={key}>
                <span>{key}</span>
                <strong>{formatMetric(value)}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Panel>
  );
}

function TrainingPage({
  token,
  summary,
  feedback,
  models,
  runs,
  trainingDataset,
  promoted,
  onRefresh
}: {
  token: string;
  summary: Summary | null;
  feedback: FeedbackRecord[];
  models: ModelArtifact[];
  runs: TrainingRun[];
  trainingDataset: TrainingDatasetRow[];
  promoted: ModelArtifact | null;
  onRefresh: () => Promise<void>;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [datasetQuery, setDatasetQuery] = useState('');
  const [datasetSourceFilter, setDatasetSourceFilter] = useState('all');
  const [datasetStatusFilter, setDatasetStatusFilter] = useState('all');
  const [datasetSort, setDatasetSort] = useState('received-desc');
  const [selectedDatasetFeedbackId, setSelectedDatasetFeedbackId] = useState<string | null>(null);
  const [selectedTrainingRunId, setSelectedTrainingRunId] = useState<string | null>(null);
  const feedbackById = useMemo(() => new Map(feedback.map((item) => [item.id, item])), [feedback]);
  const modelById = useMemo(() => new Map(models.map((model) => [model.modelId, model])), [models]);
  const datasetSources = useMemo(() => {
    return [...new Set(trainingDataset.map((row) => row.source))]
      .sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b)));
  }, [trainingDataset]);
  const visibleTrainingDataset = useMemo(() => {
    return trainingDataset
      .filter((row) => matchesQuery({ row, payload: feedbackById.get(row.feedbackId)?.payload }, datasetQuery))
      .filter((row) => datasetSourceFilter === 'all' || row.source === datasetSourceFilter)
      .filter((row) => {
        if (datasetStatusFilter === 'all') return true;
        if (datasetStatusFilter === 'trainable') return row.trainable;
        if (datasetStatusFilter === 'blocked') return !row.trainable;
        if (datasetStatusFilter === 'incompatible') return !row.compatible;
        return true;
      })
      .sort((a, b) => compareTrainingDatasetRows(a, b, datasetSort, feedbackById));
  }, [datasetQuery, datasetSort, datasetSourceFilter, datasetStatusFilter, feedbackById, trainingDataset]);
  const selectedDatasetRow = selectedDatasetFeedbackId
    ? trainingDataset.find((row) => row.feedbackId === selectedDatasetFeedbackId) ?? null
    : null;
  const selectedDatasetFeedback = selectedDatasetFeedbackId ? feedbackById.get(selectedDatasetFeedbackId) ?? null : null;
  const selectedTrainingRun = selectedTrainingRunId ? runs.find((run) => run.id === selectedTrainingRunId) ?? null : null;
  const selectedTrainingRunModel = selectedTrainingRun ? modelById.get(selectedTrainingRun.modelId) ?? null : null;

  useEffect(() => {
    setSelectedDatasetFeedbackId(null);
  }, [datasetQuery, datasetSourceFilter, datasetStatusFilter]);

  async function train(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api('/admin/models/train', token, { method: 'POST' });
      await onRefresh();
    } catch (trainError) {
      setError(trainError instanceof Error ? trainError.message : String(trainError));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page-grid">
      <PageTitle title="Training" description="Create deterministic TypeScript-trained model artifacts from reviewed feedback." />
      <button type="button" className="primary train-button" onClick={() => void train()} disabled={busy}>
        {busy ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />} Train model
      </button>
      {error ? <div className="inline-alert"><XCircle size={16} /> {error}</div> : null}
      <TrainingReadinessPanel readiness={summary?.trainingReadiness ?? null} />
      <div className="training-dataset-panel">
        <Panel title="Training Dataset Explorer">
          <div className="table-toolbar">
            <label className="inline-search">
              <Search size={16} />
              <input
                aria-label="Search training dataset"
                value={datasetQuery}
                onChange={(event) => setDatasetQuery(event.target.value)}
                placeholder="Search dataset..."
              />
            </label>
            <label className="filter-control">
              <span>Source</span>
              <select
                aria-label="Training dataset source filter"
                value={datasetSourceFilter}
                onChange={(event) => setDatasetSourceFilter(event.target.value)}
              >
                <option value="all">All sources</option>
                {datasetSources.map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}
              </select>
            </label>
            <label className="filter-control">
              <span>Status</span>
              <select
                aria-label="Training dataset status filter"
                value={datasetStatusFilter}
                onChange={(event) => setDatasetStatusFilter(event.target.value)}
              >
                <option value="all">All rows</option>
                <option value="trainable">Trainable</option>
                <option value="blocked">Blocked</option>
                <option value="incompatible">Incompatible schema</option>
              </select>
            </label>
            <label className="filter-control">
              <span>Sort</span>
              <select
                aria-label="Training dataset sort"
                value={datasetSort}
                onChange={(event) => setDatasetSort(event.target.value)}
              >
                <option value="received-desc">Newest first</option>
                <option value="received-asc">Oldest first</option>
                <option value="time-asc">Earliest timecode</option>
                <option value="confidence-desc">Model confidence</option>
                <option value="trainable-first">Trainable first</option>
              </select>
            </label>
          </div>
          <DataTable columns={['Candidate', 'Video', 'Source', 'Timecode', 'Review', 'Schema', 'Features', 'Trainable', 'Reason', 'Actions']} rows={visibleTrainingDataset.map((row) => [
            row.occurrenceId,
            row.videoId ?? 'unknown',
            sourceLabel(row.source),
            formatTime(row.startSeconds),
            row.reviewLabel ? <LabelBadge label={row.reviewLabel} /> : <span className="status pending">Pending</span>,
            row.featureSchemaVersion === null ? '-' : `Schema ${row.featureSchemaVersion}`,
            row.featureCount,
            row.trainable ? <span className="status positive">Trainable</span> : <span className="status pending">Blocked</span>,
            row.exclusionReason ?? 'Ready for confidence training',
            <div className="table-actions">
              <button type="button" aria-label={`Inspect dataset row ${row.occurrenceId}`} onClick={() => setSelectedDatasetFeedbackId(row.feedbackId)}>
                <Eye size={14} /> Inspect
              </button>
            </div>
          ])} />
        </Panel>
      </div>
      {selectedDatasetRow ? <TrainingDatasetDetailPanel row={selectedDatasetRow} feedback={selectedDatasetFeedback} /> : null}
      <Panel title="Current Promoted Model">
        {promoted ? (
          <div className="promoted-model-summary">
            <div>
              <span>Model</span>
              <code>{promoted.modelId}</code>
            </div>
            <div>
              <span>Version</span>
              <strong>{promoted.modelVersion}</strong>
            </div>
            <MetricStrip metrics={promoted.metrics} />
          </div>
        ) : (
          <EmptyState title="No promoted model" detail="Promote a trained model to compare future training runs against it." />
        )}
      </Panel>
      <div className="training-runs-panel">
        <Panel title="Training Runs">
          <DataTable columns={['Run', 'Model', 'Dataset', 'Validation', 'Accuracy', 'F1', 'Accuracy delta', 'F1 delta', 'Status', 'Actions']} rows={runs.map((run) => [
            timeAgo(run.createdAt),
            run.modelId,
            run.datasetSize,
            run.validationSize,
            formatMetric(run.metrics.accuracy),
            formatMetric(run.metrics.f1),
            formatMetricDelta(run.metrics.accuracy, promoted?.metrics.accuracy),
            formatMetricDelta(run.metrics.f1, promoted?.metrics.f1),
            <span className="status positive">{run.status}</span>,
            <div className="table-actions">
              <button type="button" aria-label={`Inspect training run ${run.id}`} onClick={() => setSelectedTrainingRunId(run.id)}>
                <Eye size={14} /> Inspect
              </button>
            </div>
          ])} />
        </Panel>
      </div>
      {selectedTrainingRun ? <TrainingRunDetailPanel run={selectedTrainingRun} model={selectedTrainingRunModel} promoted={promoted} /> : null}
    </section>
  );
}

function TrainingRunDetailPanel({
  run,
  model,
  promoted
}: {
  run: TrainingRun;
  model: ModelArtifact | null;
  promoted: ModelArtifact | null;
}): JSX.Element {
  const summary = model?.trainingSetSummary ?? {};
  const comparison = promoted ? Object.entries(run.metrics).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <div className="training-run-detail-panel">
      <Panel title="Training Run Details">
        <div className="model-detail-grid">
          <section>
            <h3>Dataset split</h3>
            <div className="summary-list">
              <DetailRow label="Dataset examples" value={run.datasetSize} />
              <DetailRow label="Validation examples" value={run.validationSize} />
              <DetailRow label="Train examples" value={formatOptionalMetric(summary.trainExamples)} />
              <DetailRow label="Positive examples" value={formatOptionalMetric(summary.positives)} />
              <DetailRow label="Negative examples" value={formatOptionalMetric(summary.negatives)} />
              <DetailRow label="Feature count" value={formatOptionalMetric(summary.featureCount)} />
            </div>
          </section>
          <section>
            <h3>Run metadata</h3>
            <div className="summary-list">
              <DetailRow label="Run" value={run.id} />
              <DetailRow label="Model" value={run.modelId} />
              <DetailRow label="Created" value={formatAbsoluteDate(run.createdAt)} />
              <DetailRow label="Status" value={run.status} />
              <DetailRow label="Feature schema" value={model?.featureSchemaVersion ?? '-'} />
            </div>
          </section>
          <section>
            <h3>Validation metrics</h3>
            <MetricStrip metrics={run.metrics} />
          </section>
          <section>
            <h3>Comparison to promoted model</h3>
            {promoted ? (
              <div className="summary-list">
                <DetailRow label="Promoted model" value={promoted.modelId} />
                {comparison.map(([metric, value]) => (
                  <DetailRow key={metric} label={`${metric} delta`} value={formatMetricDelta(value, promoted.metrics[metric])} />
                ))}
              </div>
            ) : (
              <p className="muted-note">No promoted model is currently available for comparison.</p>
            )}
          </section>
        </div>
      </Panel>
    </div>
  );
}

function TrainingDatasetDetailPanel({ row, feedback }: { row: TrainingDatasetRow; feedback: FeedbackRecord | null }): JSX.Element {
  const payload = feedback?.payload ?? null;
  const features = Object.entries(payload?.candidateFeatures ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const evidence = payload?.evidenceSnapshot ?? [];

  return (
    <Panel title="Training Dataset Details">
      <div className="feedback-detail-grid training-dataset-detail-grid">
        <section className="detail-section">
          <h3>Candidate</h3>
          <div className="summary-list">
            <DetailRow label="Occurrence" value={row.occurrenceId} />
            <DetailRow label="Video" value={row.videoId ?? 'unknown'} />
            <DetailRow label="Client" value={payload?.clientId ?? 'anonymous'} />
            <DetailRow label="Source" value={sourceLabel(row.source)} />
            <DetailRow label="Timecode" value={formatTime(row.startSeconds)} />
            <DetailRow label="Received" value={timeAgo(row.receivedAt)} />
          </div>
        </section>
        <section className="detail-section">
          <h3>Training status</h3>
          <div className="summary-list">
            <DetailRow label="Review label" value={row.reviewLabel ?? 'pending'} />
            <DetailRow label="Training label" value={row.trainingLabel === null ? '-' : row.trainingLabel} />
            <DetailRow label="Feature schema" value={row.featureSchemaVersion === null ? '-' : row.featureSchemaVersion} />
            <DetailRow label="Feature count" value={row.featureCount} />
            <DetailRow label="Trainable" value={row.trainable ? 'Yes' : 'No'} />
            <DetailRow label="Reason" value={row.exclusionReason ?? 'Ready for confidence training'} />
          </div>
        </section>
        <section className="detail-section">
          <h3>Model metadata</h3>
          <div className="summary-list">
            <DetailRow label="Heuristic confidence" value={formatPercent(payload?.heuristicConfidence)} />
            <DetailRow label="Model confidence" value={formatPercent(payload?.modelConfidence)} />
            <DetailRow label="Model" value={payload?.modelId ?? 'fallback'} />
            <DetailRow label="Version" value={payload?.modelVersion ?? 'fallback'} />
            <DetailRow label="Model source" value={payload?.modelSource ?? 'fallback'} />
          </div>
        </section>
        <section className="detail-section detail-section-wide">
          <h3>Evidence snapshot</h3>
          {evidence.length ? (
            <div className="detail-evidence-list">
              {evidence.map((entry, index) => (
                <div key={`${entry.source}-${entry.startSeconds}-${index}`} className="detail-evidence-row">
                  <span>{sourceLabel(entry.source)}</span>
                  <strong>{entry.kind}</strong>
                  <em>{formatTime(entry.startSeconds)} · {formatPercent(entry.confidence)}</em>
                  <p>{entry.detail ?? entry.reason}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No evidence snapshot" detail="This row has no stored detector evidence." />
          )}
        </section>
        <section className="detail-section">
          <h3>Candidate features</h3>
          {features.length ? (
            <div className="feature-list">
              {features.map(([feature, value]) => <DetailRow key={feature} label={feature} value={formatFeatureValue(value)} />)}
            </div>
          ) : (
            <EmptyState title="No candidate features" detail="This row cannot be used for confidence training." />
          )}
        </section>
        <section className="detail-section">
          <h3>Transcript context</h3>
          <p>{payload?.transcriptContext || 'No transcript context submitted.'}</p>
          <h3>Extension feedback</h3>
          <div className="summary-list">
            <DetailRow label="Submitted as" value={payload?.feedback ?? 'unknown'} />
            <DetailRow label="Viewer notes" value={payload?.notes ?? 'No viewer note submitted.'} />
            <DetailRow label="Admin notes" value={feedback?.review?.notes ?? 'No admin note submitted.'} />
          </div>
        </section>
      </div>
    </Panel>
  );
}

function TrainingReadinessPanel({ readiness }: { readiness: TrainingReadiness | null }): JSX.Element {
  if (!readiness) {
    return (
      <Panel title="Training Readiness">
        <EmptyState title="Readiness unavailable" detail="Refresh the dashboard to load training example counts." />
      </Panel>
    );
  }

  return (
    <Panel title="Training Readiness">
      <div className="training-readiness">
        <div className="readiness-status">
          <span className={readiness.ready ? 'status positive' : 'status pending'}>{readiness.ready ? 'Ready' : 'Blocked'}</span>
          <p>{readiness.blocker ?? 'Reviewed feedback has both positive and negative compatible examples for the active schema.'}</p>
        </div>
        <div className="readiness-grid">
          <div>
            <span>Feature schema</span>
            <strong>Schema {readiness.featureSchemaVersion}</strong>
          </div>
          <div>
            <span>Usable dataset</span>
            <strong>{readiness.compatibleExamples.toLocaleString()} compatible</strong>
            <small>{readiness.incompatibleExamples.toLocaleString()} incompatible</small>
          </div>
          <div>
            <span>Label balance</span>
            <strong>{readiness.positiveExamples.toLocaleString()} positive · {readiness.negativeExamples.toLocaleString()} negative</strong>
          </div>
          <div>
            <span>Total reviewed examples</span>
            <strong>{readiness.totalExamples.toLocaleString()}</strong>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function feedbackSource(item: FeedbackRecord): string {
  return item.payload.source ?? item.payload.occurrenceType ?? 'unknown';
}

function uniqueSources(items: readonly FeedbackRecord[]): string[] {
  return [...new Set(items.map(feedbackSource))].sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b)));
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    transcript: 'Transcript',
    'frame-visible-link': 'Visible links',
    'frame-qr-code': 'QR codes',
    'frame-progress-bar': 'Progress bars'
  };
  return labels[source] ?? source.replace(/-/g, ' ');
}

function summarizeVideos(items: readonly FeedbackRecord[]): VideoSummaryRow[] {
  const map = new Map<string, VideoSummaryRow>();
  for (const item of items) {
    const id = item.payload.videoId ?? 'unknown';
    const entry = map.get(id) ?? {
      videoId: id,
      url: item.payload.videoUrl,
      feedback: 0,
      pending: 0,
      reviewed: 0,
      sources: new Set<string>(),
      latestReceivedAt: item.receivedAt
    };
    entry.feedback += 1;
    if (!item.review) entry.pending += 1;
    else entry.reviewed += 1;
    entry.sources.add(feedbackSource(item));
    if (dateValue(item.receivedAt) > dateValue(entry.latestReceivedAt)) entry.latestReceivedAt = item.receivedAt;
    map.set(id, entry);
  }
  return [...map.values()];
}

function buildGlobalSearchResults(data: DashboardData, query: string): GlobalSearchResult[] {
  const normalized = query.trim();
  if (!normalized) return [];

  const feedbackResults = data.feedback
    .filter((item) => matchesQuery({
      id: item.id,
      videoId: item.payload.videoId,
      videoUrl: item.payload.videoUrl,
      occurrenceId: item.payload.occurrenceId,
      source: item.payload.source,
      summary: item.payload.summary,
      reason: item.payload.reason,
      feedback: item.payload.feedback,
      review: item.review?.label,
      notes: item.payload.notes,
      transcriptContext: item.payload.transcriptContext
    }, normalized))
    .slice(0, 5)
    .map((item): GlobalSearchResult => ({
      id: `feedback:${item.id}`,
      page: 'feedback',
      category: 'Feedback',
      title: item.payload.occurrenceId,
      meta: item.payload.videoId ?? 'unknown video',
      detail: `${sourceLabel(feedbackSource(item))} · ${formatTime(item.payload.startSeconds)} · ${item.payload.summary}`,
      icon: Table2
    }));

  const videoResults = summarizeVideos(data.feedback)
    .filter((video) => matchesQuery({ videoId: video.videoId, url: video.url, sources: [...video.sources] }, normalized))
    .slice(0, 4)
    .map((video): GlobalSearchResult => ({
      id: `video:${video.videoId}`,
      page: 'videos',
      category: 'Video',
      title: video.videoId,
      meta: `${video.feedback} feedback · ${video.pending} pending`,
      detail: [...video.sources].map(sourceLabel).join(', ') || 'No sources recorded',
      icon: Film
    }));

  const modelResults = data.models
    .filter((model) => matchesQuery(model, normalized))
    .slice(0, 4)
    .map((model): GlobalSearchResult => ({
      id: `model:${model.modelId}`,
      page: 'models',
      category: 'Model',
      title: model.modelId,
      meta: model.modelVersion,
      detail: `F1 ${formatMetric(model.metrics.f1)} · accuracy ${formatMetric(model.metrics.accuracy)}`,
      icon: Layers
    }));

  const trainingResults = data.trainingRuns
    .filter((run) => matchesQuery(run, normalized))
    .slice(0, 3)
    .map((run): GlobalSearchResult => ({
      id: `training:${run.id}`,
      page: 'training',
      category: 'Training',
      title: run.modelId,
      meta: run.status,
      detail: `${run.datasetSize} examples · ${run.validationSize} validation`,
      icon: TrainTrack
    }));

  return [...feedbackResults, ...videoResults, ...modelResults, ...trainingResults].slice(0, 12);
}

function matchesQuery(value: unknown, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return JSON.stringify(value).toLowerCase().includes(normalized);
}

function compareFeedback(a: FeedbackRecord, b: FeedbackRecord, sort: string): number {
  if (sort === 'received-asc') return dateValue(a.receivedAt) - dateValue(b.receivedAt);
  if (sort === 'model-desc') return numberValue(b.payload.modelConfidence) - numberValue(a.payload.modelConfidence) || compareFeedback(a, b, 'received-desc');
  if (sort === 'heuristic-desc') return numberValue(b.payload.heuristicConfidence) - numberValue(a.payload.heuristicConfidence) || compareFeedback(a, b, 'received-desc');
  if (sort === 'time-asc') return a.payload.startSeconds - b.payload.startSeconds || compareFeedback(a, b, 'received-desc');
  return dateValue(b.receivedAt) - dateValue(a.receivedAt);
}

function compareVideos(a: VideoSummaryRow, b: VideoSummaryRow, sort: string): number {
  if (sort === 'pending-desc') return b.pending - a.pending || a.videoId.localeCompare(b.videoId);
  if (sort === 'reviewed-desc') return b.reviewed - a.reviewed || a.videoId.localeCompare(b.videoId);
  if (sort === 'recent-desc') return dateValue(b.latestReceivedAt) - dateValue(a.latestReceivedAt) || a.videoId.localeCompare(b.videoId);
  if (sort === 'video-asc') return a.videoId.localeCompare(b.videoId);
  return b.feedback - a.feedback || a.videoId.localeCompare(b.videoId);
}

function compareModels(a: ModelArtifact, b: ModelArtifact, sort: string, promotedId: string | undefined): number {
  const promotedFirst = Number(b.modelId === promotedId) - Number(a.modelId === promotedId);
  if (promotedFirst !== 0) return promotedFirst;
  if (sort === 'f1-desc') return numberValue(b.metrics.f1) - numberValue(a.metrics.f1) || compareModels(a, b, 'created-desc', promotedId);
  if (sort === 'accuracy-desc') return numberValue(b.metrics.accuracy) - numberValue(a.metrics.accuracy) || compareModels(a, b, 'created-desc', promotedId);
  if (sort === 'examples-desc') return numberValue(b.trainingSetSummary.examples) - numberValue(a.trainingSetSummary.examples) || compareModels(a, b, 'created-desc', promotedId);
  if (sort === 'version-asc') return a.modelVersion.localeCompare(b.modelVersion);
  return dateValue(b.createdAt) - dateValue(a.createdAt);
}

function compareTrainingDatasetRows(
  a: TrainingDatasetRow,
  b: TrainingDatasetRow,
  sort: string,
  feedbackById: ReadonlyMap<string, FeedbackRecord>
): number {
  if (sort === 'received-asc') return dateValue(a.receivedAt) - dateValue(b.receivedAt);
  if (sort === 'time-asc') return a.startSeconds - b.startSeconds || compareTrainingDatasetRows(a, b, 'received-desc', feedbackById);
  if (sort === 'confidence-desc') {
    return numberValue(feedbackById.get(b.feedbackId)?.payload.modelConfidence) - numberValue(feedbackById.get(a.feedbackId)?.payload.modelConfidence)
      || compareTrainingDatasetRows(a, b, 'received-desc', feedbackById);
  }
  if (sort === 'trainable-first') return Number(b.trainable) - Number(a.trainable) || compareTrainingDatasetRows(a, b, 'received-desc', feedbackById);
  return dateValue(b.receivedAt) - dateValue(a.receivedAt);
}

function PageTitle({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <div className="page-title">
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail, accent }: { icon: typeof Database; label: string; value: number; detail: string; accent: string }): JSX.Element {
  return (
    <article className="metric-card" data-accent={accent}>
      <Icon size={22} />
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Panel({ title, action, children }: { title: string; action?: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {action ? <button type="button">{action}</button> : null}
      </div>
      {children}
    </section>
  );
}

function LineGraph({ rows }: { rows: Array<{ date: string; reviewed: number }> }): JSX.Element {
  const rawValues = rows.length ? rows.map((row) => row.reviewed) : [0, 1, 0, 2, 1, 3, 2];
  const values = rawValues.length === 1 ? [0, rawValues[0] ?? 0, rawValues[0] ?? 0] : rawValues;
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 100},${92 - (value / max) * 74}`).join(' ');
  return (
    <svg className="line-graph" viewBox="0 0 100 100" role="img" aria-label="Review throughput graph">
      <defs>
        <linearGradient id="lineFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--green)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`0,92 ${points} 100,92`} fill="url(#lineFill)" stroke="none" />
      <polyline points={points} fill="none" stroke="var(--green)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function BarList({ rows }: { rows: Array<[string, number]> }): JSX.Element {
  const max = Math.max(...rows.map(([, value]) => value), 1);
  return (
    <div className="bar-list">
      {(rows.length ? rows : [['No data', 0]]).map(([label, value]) => (
        <div key={label} className="bar-row">
          <span>{label}</span>
          <div><i style={{ width: `${(value / max) * 100}%` }} /></div>
          <em>{value}</em>
        </div>
      ))}
    </div>
  );
}

function Donut({ rows, total }: { rows: Array<[string, number]>; total: number }): JSX.Element {
  return (
    <div className="donut-wrap">
      <div className="donut" />
      <div className="label-list">
        {(rows.length ? rows : [['pending', 0]]).map(([label, value]) => (
          <span key={label}><LabelBadge label={label} /> {total ? Math.round((value / total) * 100) : 0}%</span>
        ))}
      </div>
    </div>
  );
}

function MetricStrip({ metrics }: { metrics: Record<string, number> }): JSX.Element {
  const keys = ['accuracy', 'precision', 'recall', 'f1', 'auc'];
  return (
    <div className="metric-strip">
      {keys.map((key) => (
        <div key={key}>
          <span>{key.toUpperCase()}</span>
          <strong>{formatMetric(metrics[key])}</strong>
        </div>
      ))}
    </div>
  );
}

function ReviewButton({
  action,
  busy,
  onSubmit
}: {
  action: ReviewAction;
  busy: ReviewLabel | null;
  onSubmit: (value: ReviewLabel) => Promise<void>;
}): JSX.Element {
  const Icon = action.icon;
  return (
    <button type="button" aria-keyshortcuts={action.shortcut} onClick={() => void onSubmit(action.value)} disabled={busy !== null}>
      {busy === action.value ? <Loader2 size={16} className="spin" /> : <Icon size={16} />}
      {action.label}
    </button>
  );
}

function DataTable({ columns, rows }: { columns: string[]; rows: Array<Array<React.ReactNode>> }): JSX.Element {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
          )) : (
            <tr><td colSpan={columns.length}><EmptyState title="No rows yet" detail="Data will appear after feedback is submitted or reviewed." /></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function LabelBadge({ label }: { label: string }): JSX.Element {
  return <span className="label-badge" data-label={label}>{label.replace(/_/g, ' ')}</span>;
}

function EmptyState({ title, detail }: { title: string; detail: string }): JSX.Element {
  return (
    <div className="empty-state">
      <Box size={22} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function ThemeSwitch({ value, onChange }: { value: ThemePreference; onChange: (value: ThemePreference) => void }): JSX.Element {
  const next = value === 'system' ? 'dark' : value === 'dark' ? 'light' : 'system';
  const Icon = value === 'light' ? Sun : value === 'dark' ? Moon : Gauge;
  return (
    <button type="button" className="theme-switch" onClick={() => onChange(next)}>
      <Icon size={17} />
      {value}
    </button>
  );
}

function LoginPanel({ onSave }: { onSave: (token: string) => Promise<void> }): JSX.Element {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onSave(value);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="login-panel">
      <Shield size={22} />
      <div>
        <h1>Admin token required</h1>
        <p>Enter the `ADMIN_TOKEN` configured on the YapSkippr server.</p>
      </div>
      <input type="password" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Admin token" />
      <button type="button" className="primary" onClick={() => void submit()} disabled={busy}>
        {busy ? 'Checking...' : 'Unlock dashboard'}
      </button>
      {error ? <span className="login-error">{error}</span> : null}
    </section>
  );
}

function useThemePreference(): [ThemePreference, (value: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(() => (localStorage.getItem(themeStorageKey) as ThemePreference | null) ?? 'system');
  useEffect(() => {
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(themeStorageKey, preference);
  }, [preference]);
  return [preference, setPreference];
}

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const hasBody = init.body !== undefined && init.body !== null;
  const headers = {
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
    ...(token ? { 'x-admin-token': token } : {}),
    ...(init.headers ?? {})
  };
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers
  });
  if (!response.ok) throw new Error(await responseErrorMessage(response, path));
  return response.json() as Promise<T>;
}

async function responseErrorMessage(response: Response, path: string): Promise<string> {
  try {
    const payload = await response.clone().json() as { error?: unknown };
    if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
  } catch {
    // Fall through to the generic message for non-JSON errors.
  }
  return `HTTP ${response.status} from ${path}`;
}

function uniqueVideoCount(items: readonly FeedbackRecord[]): number {
  return new Set(items.map((item) => item.payload.videoId ?? item.payload.videoUrl ?? item.id)).size;
}

function reviewedPercent(summary: Summary | null): number {
  if (!summary || summary.totalFeedback === 0) return 0;
  return Math.round((summary.reviewedFeedback / summary.totalFeedback) * 100);
}

function formatTime(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  return `${minutes}:${String(rounded % 60).padStart(2, '0')}`;
}

function buildTimecodeUrl(videoUrl: string | null, seconds: number): string | null {
  if (!videoUrl) return null;
  try {
    const url = new URL(videoUrl);
    url.searchParams.set('t', `${Math.max(0, Math.round(seconds))}s`);
    return url.toString();
  } catch {
    return null;
  }
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? '-' : `${Math.round(value * 100)}%`;
}

function formatFeatureValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function formatMetric(value: number | undefined): string {
  return value === undefined ? '-' : value.toFixed(3);
}

function formatOptionalMetric(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatFeatureValue(value) : '-';
}

function formatSignedMetric(value: number | undefined): string {
  if (value === undefined) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
}

function formatMetricDelta(value: number | undefined, baseline: number | undefined): string {
  if (value === undefined || baseline === undefined) return '-';
  return formatSignedMetric(value - baseline);
}

function numberValue(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : -1;
}

function dateValue(iso: string): number {
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : 0;
}

function formatAbsoluteDate(iso: string): string {
  return dateValue(iso) === 0 ? '-' : iso.slice(0, 19).replace('T', ' ');
}

function timeAgo(iso: string): string {
  const age = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
