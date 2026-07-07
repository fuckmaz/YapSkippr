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
  XCircle
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type Page = 'overview' | 'review' | 'feedback' | 'videos' | 'models' | 'training';
type ThemePreference = 'system' | 'dark' | 'light';
type ReviewLabel = 'positive' | 'false_positive' | 'wrong_timing' | 'duplicate' | 'ignored' | 'needs_more_data';

interface FeedbackRecord {
  id: string;
  receivedAt: string;
  payload: {
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

interface Summary {
  totalFeedback: number;
  reviewedFeedback: number;
  pendingFeedback: number;
  modelVersions: number;
  promotedModel: ModelArtifact | null;
  detectorSourceDistribution: Record<string, number>;
  feedbackLabelDistribution: Record<string, number>;
  reviewThroughput: Array<{ date: string; reviewed: number }>;
  modelPerformance: Record<string, number>;
}

interface DashboardData {
  summary: Summary | null;
  feedback: FeedbackRecord[];
  models: ModelArtifact[];
  promoted: ModelArtifact | null;
  trainingRuns: TrainingRun[];
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
  const [data, setData] = useState<DashboardData>({
    summary: null,
    feedback: [],
    models: [],
    promoted: null,
    trainingRuns: []
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAuth = Boolean(token) || sessionAuthenticated;

  async function refresh(): Promise<void> {
    if (!hasAuth) return;
    setLoading(true);
    setError(null);
    try {
      const [summary, feedback, models, training] = await Promise.all([
        api<Summary>('/admin/api/summary', token),
        api<{ items: FeedbackRecord[] }>('/admin/api/feedback', token),
        api<{ items: ModelArtifact[]; promoted: ModelArtifact | null }>('/admin/api/models', token),
        api<{ items: TrainingRun[] }>('/admin/api/training-runs', token)
      ]);
      setData({
        summary,
        feedback: feedback.items,
        models: models.items,
        promoted: models.promoted,
        trainingRuns: training.items
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
            <input type="search" placeholder="Search videos, feedback, or models..." />
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

        {hasAuth ? (
          <>
            {page === 'overview' ? <Overview data={data} onPageChange={setPage} /> : null}
            {page === 'review' ? <ReviewQueue token={token} data={data} onRefresh={refresh} /> : null}
            {page === 'feedback' ? <FeedbackTable items={data.feedback} /> : null}
            {page === 'videos' ? <VideosTable items={data.feedback} /> : null}
            {page === 'models' ? <ModelsPage token={token} models={data.models} promoted={data.promoted} onRefresh={refresh} /> : null}
            {page === 'training' ? <TrainingPage token={token} runs={data.trainingRuns} onRefresh={refresh} /> : null}
          </>
        ) : null}
      </main>
    </div>
  );
}

function Overview({ data, onPageChange }: { data: DashboardData; onPageChange: (page: Page) => void }): JSX.Element {
  const summary = data.summary;
  const sourceRows = Object.entries(summary?.detectorSourceDistribution ?? {});
  const labelRows = Object.entries(summary?.feedbackLabelDistribution ?? {});

  return (
    <section className="page-grid">
      <PageTitle title="Overview" description="System health, usage, feedback quality, and promoted model performance." />
      <div className="metric-grid">
        <MetricCard icon={Database} label="Total Feedback" value={summary?.totalFeedback ?? 0} accent="blue" detail="All submitted reports" />
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
        <Panel title="All Data Available">
          <div className="placeholder-grid">
            <span>Feedback payloads</span>
            <span>Candidate features</span>
            <span>Review labels</span>
            <span>Training runs</span>
            <span>Promotion history</span>
            <span>Detector evidence</span>
          </div>
        </Panel>
      </div>
    </section>
  );
}

function ReviewQueue({ token, data, onRefresh }: { token: string; data: DashboardData; onRefresh: () => Promise<void> }): JSX.Element {
  const [selectedSource, setSelectedSource] = useState('all');
  const [busyLabel, setBusyLabel] = useState<ReviewLabel | null>(null);
  const pending = data.feedback.filter((item) => !item.review && (selectedSource === 'all' || item.payload.source === selectedSource));
  const current = pending[0];
  const recent = data.feedback.filter((item) => item.review).slice(0, 5);

  async function submit(label: ReviewLabel): Promise<void> {
    if (!current) return;
    setBusyLabel(label);
    try {
      await api(`/admin/feedback/${current.id}/review`, token, {
        method: 'POST',
        body: JSON.stringify({ label })
      });
      await onRefresh();
    } finally {
      setBusyLabel(null);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!current) return;
      const map: Record<string, ReviewLabel> = {
        '1': 'positive',
        '2': 'false_positive',
        '3': 'wrong_timing',
        '4': 'duplicate',
        '5': 'ignored',
        '6': 'needs_more_data'
      };
      if (map[event.key]) void submit(map[event.key]);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current?.id]);

  return (
    <section className="page-grid">
      <PageTitle title="Review Queue" description="Review one occurrence at a time and advance automatically after each decision." />
      <div className="review-layout">
        <article className="review-focus">
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
              <div className="review-actions">
                <ReviewButton label="Positive" value="positive" icon={ThumbsUp} busy={busyLabel} onSubmit={submit} />
                <ReviewButton label="False positive" value="false_positive" icon={ThumbsDown} busy={busyLabel} onSubmit={submit} />
                <ReviewButton label="Wrong timing" value="wrong_timing" icon={TimerReset} busy={busyLabel} onSubmit={submit} />
                <ReviewButton label="Duplicate" value="duplicate" icon={Layers} busy={busyLabel} onSubmit={submit} />
                <ReviewButton label="Ignored" value="ignored" icon={Eye} busy={busyLabel} onSubmit={submit} />
                <ReviewButton label="Needs data" value="needs_more_data" icon={ListFilter} busy={busyLabel} onSubmit={submit} />
              </div>
            </>
          ) : (
            <EmptyState title="Queue clear" detail="No pending feedback matches the current filter." />
          )}
        </article>
        <aside className="review-side">
          <Panel title="Queue Progress">
            <select value={selectedSource} onChange={(event) => setSelectedSource(event.target.value)}>
              <option value="all">All sources</option>
              <option value="transcript">Transcript</option>
              <option value="frame-visible-link">Visible links</option>
              <option value="frame-qr-code">QR codes</option>
              <option value="frame-progress-bar">Progress bars</option>
            </select>
            <strong className="queue-number">{pending.length}</strong>
            <span>items pending</span>
          </Panel>
          <Panel title="Recent Reviews">
            <div className="recent-list">
              {recent.map((item) => (
                <span key={item.id}><LabelBadge label={item.review?.label ?? 'ignored'} /> {timeAgo(item.review?.reviewedAt ?? item.receivedAt)}</span>
              ))}
            </div>
          </Panel>
        </aside>
      </div>
    </section>
  );
}

function FeedbackTable({ items }: { items: FeedbackRecord[] }): JSX.Element {
  const [query, setQuery] = useState('');
  const filtered = items.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="page-grid">
      <PageTitle title="Feedback" description="Search, filter, and inspect submitted feedback payloads." />
      <label className="inline-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search feedback..." /></label>
      <DataTable columns={['Received', 'Video', 'Source', 'Timecode', 'Heuristic', 'Model', 'Review']} rows={filtered.map((item) => [
        timeAgo(item.receivedAt),
        item.payload.videoId ?? 'unknown',
        item.payload.source ?? item.payload.occurrenceType,
        formatTime(item.payload.startSeconds),
        formatPercent(item.payload.heuristicConfidence),
        formatPercent(item.payload.modelConfidence),
        item.review ? <LabelBadge label={item.review.label} /> : <span className="status pending">Pending</span>
      ])} />
    </section>
  );
}

function VideosTable({ items }: { items: FeedbackRecord[] }): JSX.Element {
  const videos = useMemo(() => {
    const map = new Map<string, { videoId: string; url: string | null; feedback: number; pending: number; sources: Set<string> }>();
    for (const item of items) {
      const id = item.payload.videoId ?? 'unknown';
      const entry = map.get(id) ?? { videoId: id, url: item.payload.videoUrl, feedback: 0, pending: 0, sources: new Set<string>() };
      entry.feedback += 1;
      if (!item.review) entry.pending += 1;
      entry.sources.add(item.payload.source ?? item.payload.occurrenceType);
      map.set(id, entry);
    }
    return [...map.values()];
  }, [items]);

  return (
    <section className="page-grid">
      <PageTitle title="Videos" description="Feedback grouped by YouTube video for source and queue analysis." />
      <DataTable columns={['Video ID', 'Feedback', 'Pending', 'Sources', 'URL']} rows={videos.map((video) => [
        video.videoId,
        video.feedback,
        video.pending,
        [...video.sources].join(', '),
        video.url ? <a href={video.url} target="_blank" rel="noreferrer">Open</a> : '-'
      ])} />
    </section>
  );
}

function ModelsPage({ token, models, promoted, onRefresh }: { token: string; models: ModelArtifact[]; promoted: ModelArtifact | null; onRefresh: () => Promise<void> }): JSX.Element {
  async function promote(id: string): Promise<void> {
    await api(`/admin/models/${id}/promote`, token, { method: 'POST' });
    await onRefresh();
  }

  async function rollback(id: string): Promise<void> {
    await api(`/admin/models/${id}/rollback`, token, { method: 'POST' });
    await onRefresh();
  }

  return (
    <section className="page-grid">
      <PageTitle title="Models" description="Inspect artifacts, metrics, promotion state, and rollback history." />
      <DataTable columns={['Version', 'Status', 'Accuracy', 'F1', 'AUC', 'Examples', 'Actions']} rows={models.map((model) => [
        model.modelVersion,
        promoted?.modelId === model.modelId ? <span className="status positive">Promoted</span> : <span className="status">Draft</span>,
        formatMetric(model.metrics.accuracy),
        formatMetric(model.metrics.f1),
        formatMetric(model.metrics.auc),
        model.trainingSetSummary.examples ?? 0,
        <div className="table-actions">
          <button type="button" onClick={() => void promote(model.modelId)}>Promote</button>
          <button type="button" onClick={() => void rollback(model.modelId)}>Rollback</button>
        </div>
      ])} />
    </section>
  );
}

function TrainingPage({ token, runs, onRefresh }: { token: string; runs: TrainingRun[]; onRefresh: () => Promise<void> }): JSX.Element {
  const [busy, setBusy] = useState(false);
  async function train(): Promise<void> {
    setBusy(true);
    try {
      await api('/admin/models/train', token, { method: 'POST' });
      await onRefresh();
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
      <DataTable columns={['Run', 'Model', 'Dataset', 'Validation', 'Accuracy', 'F1', 'Status']} rows={runs.map((run) => [
        timeAgo(run.createdAt),
        run.modelId,
        run.datasetSize,
        run.validationSize,
        formatMetric(run.metrics.accuracy),
        formatMetric(run.metrics.f1),
        <span className="status positive">{run.status}</span>
      ])} />
    </section>
  );
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

function ReviewButton({ label, value, icon: Icon, busy, onSubmit }: { label: string; value: ReviewLabel; icon: typeof CheckCircle2; busy: ReviewLabel | null; onSubmit: (value: ReviewLabel) => Promise<void> }): JSX.Element {
  return (
    <button type="button" onClick={() => void onSubmit(value)} disabled={busy !== null}>
      {busy === value ? <Loader2 size={16} className="spin" /> : <Icon size={16} />}
      {label}
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
  const headers = {
    'content-type': 'application/json',
    ...(token ? { 'x-admin-token': token } : {}),
    ...(init.headers ?? {})
  };
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${path}`);
  return response.json() as Promise<T>;
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

function formatPercent(value: number | undefined): string {
  return value === undefined ? '-' : `${Math.round(value * 100)}%`;
}

function formatMetric(value: number | undefined): string {
  return value === undefined ? '-' : value.toFixed(3);
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
