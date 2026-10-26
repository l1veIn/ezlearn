import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Goal = {
  id: string;
  title: string;
  pack_id: string;
  pack_version: string;
  daily_minutes: number;
  exam_date?: string;
  active?: boolean;
};
type Question = {
  id: string;
  type: 'single_choice' | 'short_answer';
  prompt: string;
  options?: { id: string; text: string }[];
  points: number;
  explanation?: string;
  topic_ids: string[];
};
type Material = { id: string; title: string; content?: string; source?: string; path?: string };
type Lesson = {
  id: string;
  goal_id: string;
  title: string;
  objective: string;
  explanation: string;
  example: string;
  context_summary?: string;
  topic_ids: string[];
  kind: string;
  minutes: number;
  status: string;
  questions: Question[];
  materials: Material[];
  created_at: string;
  url?: string;
};
type Attempt = {
  id: string;
  lesson_id: string;
  goal_id: string;
  status: string;
  version: number;
  answers: Record<string, string>;
  created_at: string;
  submitted_at?: string;
  handoff_prompt?: string;
};
type Grade = { question_id: string; score: number; feedback: string; max_score?: number };
type Review = {
  id: string;
  version: number;
  grades: Grade[];
  total: number;
  max_score: number;
  summary: string;
  next_steps: string;
};
type Progress = {
  goal_id: string;
  topic_id: string;
  exposures: number;
  attempts: number;
  correct: number;
  earned: number;
  possible: number;
  mastery: string;
  last_practiced_at?: string;
  due_at?: string;
};
type Pack = {
  id?: string;
  version?: string;
  pack?: { manifest: Manifest; topics?: { id: string; title: string }[] };
  manifest?: Manifest;
  topics?: { id: string; title: string }[];
  source?: { kind: string; url?: string; ref?: string; resolved?: string };
};
type Manifest = {
  id: string;
  version: string;
  name: string;
  language: string;
  description: string;
  license: string;
  source: string;
};
type Dashboard = {
  goals: Goal[];
  packs: Pack[];
  lessons: Lesson[];
  attempts: Attempt[];
  progress: Progress[];
  due_reviews: Progress[];
  backend_id: string;
  base_url: string;
  platform_version?: string;
};
type AttemptDetail = { attempt: Attempt; lesson: Lesson; review?: Review; handoff_prompt: string };
const EMPTY: Dashboard = {
  goals: [],
  packs: [],
  lessons: [],
  attempts: [],
  progress: [],
  due_reviews: [],
  backend_id: '',
  base_url: '',
};
class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, input?: unknown): Promise<T> {
  const response = await fetch(
    url,
    input === undefined
      ? { credentials: 'same-origin', cache: 'no-store' }
      : {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
  );
  let result: { ok?: boolean; data?: T; error?: { code?: string; message?: string } };
  try {
    result = await response.json();
  } catch {
    throw new ApiError('NETWORK_ERROR', '服务暂时没有响应，请确认当前学习平台实例正在运行。');
  }
  if (!response.ok || result.ok === false)
    throw new ApiError(
      result.error?.code || (response.status === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED'),
      result.error?.message || '请求没有完成，请稍后重试。',
    );
  return result.data === undefined ? (result as T) : result.data;
}
const rpc = <T,>(operation: string, input: object = {}) =>
  request<T>(`/api/rpc/${operation}`, input);
const manifest = (pack: Pack): Manifest | undefined => pack.manifest ?? pack.pack?.manifest;
const stamp = (value?: string) =>
  value
    ? new Date(value).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
    : '尚无记录';
const kindName = (kind: string) =>
  ({ daily: '日常学习', diagnostic: '轻量摸底', checkpoint: '阶段测验', mock: '迷你模拟' })[kind] ??
  '日常学习';
const statusName = (status: string) =>
  ({
    in_progress: '学习中',
    submitted: '待老师反馈',
    reviewed: '已有反馈',
    draft: '备课中',
    published: '可以开始',
  })[status] ?? status;
const masteryName = (mastery: string) =>
  ({
    unknown: '等待练习证据',
    learning: '刚刚接触',
    practicing: '继续练习',
    demonstrated: '练习已证明掌握',
  })[mastery] ?? mastery;

function Icon({
  name,
  size = 20,
}: {
  name:
    | 'arrow'
    | 'book'
    | 'history'
    | 'settings'
    | 'check'
    | 'copy'
    | 'plus'
    | 'refresh'
    | 'leaf'
    | 'logout';
  size?: number;
}) {
  const paths = {
    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    ),
    book: (
      <>
        <path d="M12 6c-3-3-7-3-10-2v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 2ZM12 6v15" />
      </>
    ),
    history: (
      <>
        <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16M8 4v6M16 14v6" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V4H4v12h4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: (
      <>
        <path d="M20 7a9 9 0 1 0 1 8M20 2v6h-6" />
      </>
    ),
    leaf: (
      <>
        <path d="M20 3C7 2 1 9 7 16s15 0 13-13ZM5 21 16 9" />
      </>
    ),
    logout: (
      <>
        <path d="M9 4H4v16h5M9 12h12m-5-5 5 5-5 5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function Link({
  to,
  children,
  className,
  onClick,
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
          event.preventDefault();
          onClick?.();
          history.pushState({}, '', to);
          dispatchEvent(new PopStateEvent('popstate'));
          window.scrollTo(0, 0);
        }
      }}
    >
      {children}
    </a>
  );
}
function Text({ children, className = '' }: { children?: string; className?: string }) {
  return (
    <div className={`prose ${className}`}>
      {(children ?? '')
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((paragraph, i) => (
          <p key={i}>{paragraph.replace(/^#{1,4}\s/gm, '')}</p>
        ))}
    </div>
  );
}
function CopyButton({
  text,
  label = '复制提示词',
  primary = false,
}: {
  text: string;
  label?: string;
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      setFailed(true);
    }
  }
  return (
    <>
      <button className={primary ? 'button primary' : 'button subtle'} onClick={copy}>
        <Icon name={copied ? 'check' : 'copy'} size={17} />
        {copied ? '已复制' : label}
      </button>
      {failed && (
        <label className="copy-fallback">
          可手动复制下方文字
          <textarea readOnly value={text} onFocus={(e) => e.currentTarget.select()} />
        </label>
      )}
    </>
  );
}
function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark">✳</span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}

function App() {
  const [path, setPath] = useState(location.pathname);
  const [data, setData] = useState<Dashboard>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [login, setLogin] = useState(false);
  const [toast, setToast] = useState('');
  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 3200);
  }, []);
  const reload = useCallback(async () => {
    try {
      const [dashboard, platform] = await Promise.all([
        request<Dashboard>('/api/dashboard'),
        request<{ version: string }>('/api/platform'),
      ]);
      setData({ ...EMPTY, ...dashboard, platform_version: platform.version });
      setLogin(false);
      setError('');
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'UNAUTHORIZED' || err.code === 'AUTH_REQUIRED') setLogin(true);
      else setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    addEventListener('popstate', update);
    void reload();
    return () => removeEventListener('popstate', update);
  }, [reload]);
  useEffect(() => {
    document.title = `ezlearn · ${path.startsWith('/lessons') ? '今日学习' : path.startsWith('/attempts') ? '学习反馈' : path === '/history' ? '学习足迹' : path === '/settings' ? '我的书架' : '学习札记'}`;
  }, [path]);
  const lessonId = path.match(/^\/lessons\/([^/]+)$/)?.[1];
  const attemptId = path.match(/^\/attempts\/([^/]+)$/)?.[1];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-glyph">
            <i />
            <i />
            <i />
          </span>
          <span>
            ezlearn<span className="brand-period">.</span>
          </span>
        </Link>
        <div className="brand-caption">你的日常，都是好教材。</div>
        <nav aria-label="主导航">
          <Link
            to="/"
            className={`nav-item ${path === '/' || lessonId || attemptId ? 'active' : ''}`}
          >
            <Icon name="book" />
            <span>今日学习</span>
            <span className="nav-number">01</span>
          </Link>
          <Link to="/history" className={`nav-item ${path === '/history' ? 'active' : ''}`}>
            <Icon name="history" />
            <span>学习足迹</span>
            <span className="nav-number">02</span>
          </Link>
          <Link to="/settings" className={`nav-item ${path === '/settings' ? 'active' : ''}`}>
            <Icon name="settings" />
            <span>我的书架</span>
            <span className="nav-number">03</span>
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="tiny-star">✳</span>
            <p>
              不必一次学会所有。
              <br />
              今天，向前一小步。
            </p>
          </div>
          <div className="connection">
            <span className={`status-dot ${error || login ? 'offline' : ''}`} />
            <span>{login ? '等待登录' : error ? '连接暂不可用' : '学习札记已就绪'}</span>
            <span className="version">
              {data.platform_version ? `v${data.platform_version}` : '—'}
            </span>
          </div>
        </div>
      </aside>
      <main id="main" className={`main ${lessonId || attemptId ? 'reading-main' : ''}`}>
        <header className="topline">
          <span>
            学习札记 <span className="slash">/</span>{' '}
            {path === '/history'
              ? '留下一点成长的证据'
              : path === '/settings'
                ? '整理你的学习方向'
                : lessonId
                  ? '专注这一小刻'
                  : attemptId
                    ? '练习之后'
                    : '让知识与日常相遇'}
          </span>
          <span>
            {new Date().toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            })}
            <span className="topline-day">
              {new Date().toLocaleDateString('zh-CN', { weekday: 'short' })}
            </span>
          </span>
        </header>
        {login ? (
          <Login onDone={reload} />
        ) : loading ? (
          <div className="loading" role="status">
            <span className="loading-line" />
            正在翻开学习札记…
          </div>
        ) : error ? (
          <Empty
            title="暂时没有连上学习服务"
            action={
              <button className="button primary" onClick={reload}>
                <Icon name="refresh" />
                重新连接
              </button>
            }
          >
            {error}
          </Empty>
        ) : lessonId ? (
          <LessonPage
            key={lessonId}
            id={decodeURIComponent(lessonId)}
            reload={reload}
            notify={notify}
          />
        ) : attemptId ? (
          <AttemptPage key={attemptId} id={decodeURIComponent(attemptId)} reload={reload} />
        ) : path === '/history' ? (
          <HistoryPage data={data} />
        ) : path === '/settings' ? (
          <SettingsPage data={data} reload={reload} notify={notify} />
        ) : (
          <Home data={data} reload={reload} />
        )}
        <footer className="page-footer">
          <span>少一点负担，多一点理解。</span>
          <span>
            MADE FOR A LITTLE EVERY DAY <span className="footer-leaf">↗</span>
          </span>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

function Login({ onDone }: { onDone: () => Promise<void> }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="login-page">
      <span className="eyebrow">YOUR PRIVATE LEARNING SPACE</span>
      <h1>欢迎回来。</h1>
      <p className="intro">登录你的个人学习空间，接着上次的地方继续。</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await request('/api/login', { token });
            setToken('');
            await onDone();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          实例访问凭证
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="current-password"
            required
            maxLength={1024}
          />
        </label>
        {error && <Notice error>{error}</Notice>}
        <button className="button primary" disabled={busy}>
          {busy ? '正在进入…' : '进入学习札记'}
          <Icon name="arrow" />
        </button>
        <p className="field-help">凭证仅用于登录，不会放入课程链接或交接提示词。</p>
      </form>
    </section>
  );
}

function Home({ data, reload }: { data: Dashboard; reload: () => Promise<void> }) {
  const goals = data.goals.filter((g) => g.active !== false);
  const [selected, setSelected] = useState(goals[0]?.id ?? '');
  const [plan, setPlan] = useState<{
    action: string;
    lesson?: Lesson;
    attempt?: Attempt;
    topic?: { id: string; title: string };
    reason: string;
  }>();
  const [error, setError] = useState('');
  const goal = goals.find((g) => g.id === selected) ?? goals[0];
  const activeLessons = data.lessons
    .filter((l) => l.goal_id === goal?.id && l.status === 'published')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const pending = data.attempts.filter(
    (a) => a.status === 'submitted' && (!goal || a.goal_id === goal.id),
  );
  const due = data.due_reviews.filter((p) => !goal || p.goal_id === goal.id);
  const reviewed = data.attempts.filter((a) => a.status === 'reviewed');
  const lesson =
    plan?.lesson ??
    activeLessons.find(
      (l) => !data.attempts.some((a) => a.lesson_id === l.id && a.status !== 'in_progress'),
    );
  const prompt = goal
    ? `/ezlearn 继续学习目标 ${goal.id}（${goal.title}），后端 ${data.backend_id}。请先检查未完成课程、待阅卷与到期复习，安排约 ${goal.daily_minutes ?? 15} 分钟的一小节，并给我课程链接。`
    : '/ezlearn 我要学英语，每天 15 分钟，请先查看已安装学习包，帮我建立学习目标。';
  useEffect(() => {
    if (!goal) return;
    let active = true;
    void rpc<typeof plan>('plan_next_session', { goal_id: goal.id })
      .then((value) => {
        if (active) setPlan(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [goal?.id]);
  return (
    <>
      <section className="home-hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="short-line" />A LITTLE, EVERY DAY
          </span>
          <h1>
            每天一点，
            <br />
            <span className="serif-emphasis">慢慢学会。</span>
          </h1>
          <p className="intro">
            从你熟悉的日常出发，
            <br />和 AI 老师一起，把一个小知识点学明白。
          </p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="art-square square-a" />
          <div className="art-square square-b" />
          <div className="art-line" />
          <span className="art-label">
            SMALL STEPS.
            <br />
            REAL UNDERSTANDING.
          </span>
          <span className="art-cross">+</span>
          <span className="art-seed">✳</span>
        </div>
      </section>
      <section className="today-section" aria-labelledby="today-title">
        <div className="section-heading">
          <h2 id="today-title">
            <span className="section-index">01</span>今天的这一小步
          </h2>
          {goals.length > 1 && (
            <select
              aria-label="选择学习目标"
              value={goal?.id}
              onChange={(e) => {
                setSelected(e.target.value);
                setPlan(undefined);
              }}
            >
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          )}
        </div>
        {!goal ? (
          <div className="start-note">
            <div>
              <span className="eyebrow">FIRST, A DIRECTION</span>
              <h3>先给好奇心一个方向。</h3>
              <p>选择学习包、设定一个小目标，再请你的 Agent 带来第一节课。</p>
            </div>
            <Link to="/settings" className="button primary">
              建立学习目标
              <Icon name="arrow" />
            </Link>
          </div>
        ) : (
          <div className="today-card">
            <div className="today-card-body">
              <div className="lesson-meta">
                <span className="green-label">
                  {plan?.action === 'review_attempt'
                    ? '等老师来看看'
                    : lesson
                      ? kindName(lesson.kind)
                      : '下一节，准备出发'}
                </span>
                <span>
                  {lesson?.minutes ?? goal.daily_minutes ?? 15} 分钟{' '}
                  <span className="middle-dot">·</span> {goal.title}
                </span>
              </div>
              <h3>
                {plan?.action === 'review_attempt'
                  ? '练习已完成，带着问题继续。'
                  : (lesson?.title ?? '让新知识，接上你的日常。')}
              </h3>
              <p>
                {plan?.action === 'review_attempt'
                  ? '把作答交给 AI 老师，收下反馈，再决定下一小步。'
                  : (lesson?.objective ??
                    plan?.reason ??
                    '在 Agent 中发起 /ezlearn，让老师结合你的目标和掌握情况安排课程。')}
              </p>
              <div className="today-actions">
                {plan?.action === 'review_attempt' && plan.attempt ? (
                  <Link to={`/attempts/${plan.attempt.id}`} className="button primary">
                    查看提交与交接
                    <Icon name="arrow" />
                  </Link>
                ) : lesson ? (
                  <Link to={`/lessons/${lesson.id}`} className="button primary">
                    {plan?.action === 'resume' ? '继续这一课' : '开始这一课'}
                    <Icon name="arrow" />
                  </Link>
                ) : (
                  <CopyButton text={prompt} primary label="复制提示词，请老师备课" />
                )}
                <span className="quiet-caption">专注一小刻，就很好。</span>
              </div>
            </div>
            <div className="card-margin" aria-hidden="true">
              <span>NOTE</span>
              <strong>{String(data.lessons.length + (lesson ? 0 : 1)).padStart(2, '0')}</strong>
              <span>
                一步一步
                <br />
                就会到达
              </span>
            </div>
          </div>
        )}
        {error && <Notice error>{error}</Notice>}
      </section>
      <section className="rhythm-section">
        <div className="section-heading">
          <h2>
            <span className="section-index">02</span>学习有自己的节奏
          </h2>
          <Link to="/history" className="text-link">
            查看足迹
            <Icon name="arrow" size={16} />
          </Link>
        </div>
        <div className="rhythm-grid">
          <div className="rhythm-item">
            <span className="rhythm-title">留给老师的作答</span>
            <span className="rhythm-value">
              {String(pending.length).padStart(2, '0')}
              <small>份</small>
            </span>
            <p>{pending.length ? '已有练习提交，等待老师反馈。' : '每次练习，都有认真回应。'}</p>
            {pending[0] && (
              <Link to={`/attempts/${pending[0].id}`} className="text-link">
                继续交接 <Icon name="arrow" size={15} />
              </Link>
            )}
          </div>
          <div className="rhythm-item">
            <span className="rhythm-title">值得再见的知识</span>
            <span className="rhythm-value">
              {String(due.length).padStart(2, '0')}
              <small>个</small>
            </span>
            <p>{due.length ? '复习熟悉的知识，让理解更扎实。' : '复习会在合适的时候回来。'}</p>
          </div>
          <div className="rhythm-item">
            <span className="rhythm-title">已经留下的脚印</span>
            <span className="rhythm-value">
              {String(reviewed.length).padStart(2, '0')}
              <small>次</small>
            </span>
            <p>{reviewed.length ? '来自练习的证据，记下每次成长。' : '从第一道练习开始积累。'}</p>
          </div>
        </div>
      </section>
      <section className="agent-note">
        <span className="small-label">与 AI 老师同行</span>
        <p>
          在你的 Agent 里输入 <code>/ezlearn</code> 开始。
          <br className="mobile-break" />
          做完练习后，把交接提示词带回去。
        </p>
        <CopyButton text={prompt} label="复制开始提示词" />
      </section>
    </>
  );
}

function LessonPage({
  id,
  reload,
  notify,
}: {
  id: string;
  reload: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [lesson, setLesson] = useState<Lesson>();
  const [attempt, setAttempt] = useState<Attempt>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const answersRef = useRef(answers);
  answersRef.current = answers;
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const l = await rpc<Lesson>('get_lesson', { id });
        if (!alive) return;
        setLesson(l);
        const a = await rpc<Attempt>('start_attempt', {
          lesson_id: id,
          idempotency_key: `web-initial:${id}`,
        });
        if (alive) {
          setAttempt(a);
          setAnswers(a.answers ?? {});
        }
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function save() {
    if (!attempt || busy || !dirty) return;
    const snapshot = { ...answersRef.current };
    setBusy(true);
    setError('');
    try {
      const value = await rpc<Attempt>('save_draft', {
        id: attempt.id,
        expected_version: attempt.version,
        answers: snapshot,
      });
      setAttempt(value);
      setDirty(JSON.stringify(answersRef.current) !== JSON.stringify(snapshot));
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
      notify('草稿已保存，随时可以回来。');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!attempt || !lesson || busy) return;
    const missing = lesson.questions.find((q) => !answers[q.id]?.trim());
    if (missing) {
      setError('还有练习没有作答。填写答案后，就可以交给老师了。');
      document.getElementById(`question-${missing.id}`)?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await rpc<Attempt>('submit_attempt', {
        id: attempt.id,
        expected_version: attempt.version,
        answers,
      });
      setDirty(false);
      await reload();
      history.pushState({}, '', `/attempts/${result.id}`);
      dispatchEvent(new PopStateEvent('popstate'));
      window.scrollTo(0, 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!lesson)
    return error ? (
      <Notice error>{error}</Notice>
    ) : (
      <div className="loading" role="status">
        正在翻开这一课…
      </div>
    );
  const answered = lesson.questions.filter((q) => answers[q.id]?.trim()).length;
  return (
    <article className="lesson-page">
      <Link to="/" className="back-link">
        ← 回到今日学习
      </Link>
      <div className="reading-heading">
        <span className="eyebrow">
          {kindName(lesson.kind)} <span className="middle-dot">/</span> {lesson.minutes} MINUTES
        </span>
        <h1>{lesson.title}</h1>
        <p className="lesson-objective">
          <span>这一课，你将能够</span>
          {lesson.objective}
        </p>
      </div>
      {attempt && attempt.status !== 'in_progress' ? (
        <div className="notice submitted-inline">
          <p>这份练习{statusName(attempt.status)}。</p>
          <Link to={`/attempts/${attempt.id}`} className="button primary">
            查看{attempt.status === 'reviewed' ? '学习反馈' : '提交记录'}
            <Icon name="arrow" />
          </Link>
          {attempt.status === 'reviewed' && (
            <button
              className="button subtle"
              onClick={async () => {
                setBusy(true);
                try {
                  const a = await rpc<Attempt>('start_attempt', {
                    lesson_id: id,
                    idempotency_key: `web-retake:${crypto.randomUUID()}`,
                  });
                  setAttempt(a);
                  setAnswers(a.answers);
                  setDirty(false);
                  setSavedAt('');
                  await reload();
                  notify('新的一次练习已准备好。');
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              再练一次
            </button>
          )}
        </div>
      ) : null}
      <div className="reading-layout">
        <div className="reading-content">
          <section className="lesson-section">
            <div className="content-label">
              <span>01</span>
              <h2>先理解一点</h2>
            </div>
            <Text>{lesson.explanation}</Text>
          </section>
          <section className="example-section">
            <span className="small-label">放到熟悉的工作里</span>
            <Text>{lesson.example}</Text>
            <span className="example-decoration" aria-hidden="true">
              “
            </span>
          </section>
          {lesson.materials?.length > 0 && (
            <details className="materials">
              <summary>
                参考讲义 <span>{lesson.materials.length} 份</span>
              </summary>
              {lesson.materials.map((m) => (
                <div key={m.id} className="material-item">
                  <h3>{m.title}</h3>
                  {m.content && <Text>{m.content}</Text>}
                  <p className="material-source">{m.source ?? m.path ?? m.id}</p>
                </div>
              ))}
            </details>
          )}
          <section className="practice-section">
            <div className="content-label">
              <span>02</span>
              <h2>试着用一用</h2>
            </div>
            <p className="section-intro">不用急着答对。写下你的理解，老师会和你一起看。</p>
            <form onSubmit={submit}>
              <fieldset
                disabled={!attempt || attempt.status !== 'in_progress' || busy}
                className="questions-fieldset"
              >
                {lesson.questions.map((q, index) => (
                  <fieldset className="question" id={`question-${q.id}`} tabIndex={-1} key={q.id}>
                    <legend>
                      <span className="question-number">{String(index + 1).padStart(2, '0')}</span>
                      <span>{q.prompt}</span>
                    </legend>
                    <div className="question-type">
                      {q.type === 'single_choice' ? '选择一个答案' : '用自己的话回答'}{' '}
                      <span className="middle-dot">·</span> {q.points} 分
                    </div>
                    {q.type === 'single_choice' ? (
                      <div className="options">
                        {q.options?.map((option) => (
                          <label
                            className={`option ${answers[q.id] === option.id ? 'selected' : ''}`}
                            key={option.id}
                          >
                            <input
                              type="radio"
                              name={q.id}
                              value={option.id}
                              checked={answers[q.id] === option.id}
                              onChange={() => {
                                setAnswers((a) => ({ ...a, [q.id]: option.id }));
                                setDirty(true);
                              }}
                            />
                            <span className="option-letter">{option.id}</span>
                            <span>{option.text}</span>
                            <span className="option-circle">
                              {answers[q.id] === option.id && <span />}
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        aria-label={`第 ${index + 1} 题答案`}
                        rows={4}
                        maxLength={10000}
                        placeholder="从一个简单的句子开始……"
                        value={answers[q.id] ?? ''}
                        onChange={(e) => {
                          setAnswers((a) => ({ ...a, [q.id]: e.target.value }));
                          setDirty(true);
                        }}
                      />
                    )}
                  </fieldset>
                ))}
              </fieldset>
              {error && <Notice error>{error}</Notice>}
              {attempt?.status === 'in_progress' && (
                <div className="submit-area">
                  <div className="draft-status" aria-live="polite">
                    <span className={`status-dot ${dirty ? 'unsaved' : ''}`} />
                    {busy
                      ? '正在保存…'
                      : dirty
                        ? '有未保存的修改'
                        : savedAt
                          ? `草稿已保存于 ${savedAt}`
                          : '草稿已同步，可随时继续'}
                    <span className="draft-privacy">答案只保存在当前学习实例</span>
                  </div>
                  <div className="submit-buttons">
                    <button
                      className="button subtle"
                      type="button"
                      onClick={save}
                      disabled={!dirty || busy}
                    >
                      保存草稿
                    </button>
                    <button className="button primary" type="submit" disabled={busy || !attempt}>
                      {busy ? '正在提交…' : '完成，交给老师'}
                      <Icon name="arrow" />
                    </button>
                  </div>
                </div>
              )}
            </form>
          </section>
        </div>
        <aside className="reading-rail">
          <span className="small-label">这一小刻</span>
          <div className="rail-time">
            {lesson.minutes}
            <span>分钟</span>
          </div>
          <div className="rail-progress">
            <span>练习进度</span>
            <strong>
              {answered} / {lesson.questions.length}
            </strong>
            <div className="progress-track">
              <i
                style={{
                  width: `${lesson.questions.length ? (answered / lesson.questions.length) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <p>
            先理解，再练习。
            <br />
            遇到不确定的地方，
            <br />
            也可以留给老师。
          </p>
          <span className="rail-flower" aria-hidden="true">
            ✳
          </span>
        </aside>
      </div>
    </article>
  );
}

function AttemptPage({ id, reload }: { id: string; reload: () => Promise<void> }) {
  const [detail, setDetail] = useState<AttemptDetail>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setDetail(await rpc<AttemptDetail>('get_attempt', { id }));
      setError('');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [id, reload]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!detail)
    return error ? (
      <Notice error>{error}</Notice>
    ) : (
      <div className="loading" role="status">
        正在查看练习记录…
      </div>
    );
  const { attempt, lesson, review } = detail;
  if (attempt.status === 'in_progress')
    return (
      <Empty
        title="这节课还在进行中"
        action={
          <Link to={`/lessons/${lesson.id}`} className="button primary">
            回到练习
            <Icon name="arrow" />
          </Link>
        }
      >
        你的草稿已经保存，可以从上次停下的地方继续。
      </Empty>
    );
  const handoff = detail.handoff_prompt || attempt.handoff_prompt || '';
  return (
    <article className="attempt-page">
      <Link to="/" className="back-link">
        ← 回到今日学习
      </Link>
      {review ? (
        <>
          <div className="reading-heading">
            <span className="eyebrow">A NOTE FROM YOUR TEACHER</span>
            <h1>
              每一次练习，
              <br />
              <span className="serif-emphasis">都让理解更近一点。</span>
            </h1>
            <p className="intro">
              {lesson.title} <span className="middle-dot">·</span> {stamp(attempt.submitted_at)}
            </p>
          </div>
          <div className="review-summary">
            <div className="score">
              <strong>{review.total}</strong>
              <span>/ {review.max_score}</span>
              <small>本轮练习得分</small>
            </div>
            <div>
              <span className="small-label">老师的话</span>
              <Text>{review.summary}</Text>
            </div>
          </div>
          <section className="review-questions">
            <div className="section-heading">
              <h2>
                <span className="section-index">01</span>逐题回顾
              </h2>
              <span className="muted">反馈版本 {review.version}</span>
            </div>
            {lesson.questions.map((q, index) => {
              const grade = review.grades.find((g) => g.question_id === q.id);
              const answer = attempt.answers[q.id];
              const option = q.options?.find((o) => o.id === answer);
              return (
                <div className="review-question" key={q.id}>
                  <div className="review-question-heading">
                    <h3>
                      <span className="question-number">{String(index + 1).padStart(2, '0')}</span>
                      {q.prompt}
                    </h3>
                    <span className={`grade-pill ${grade?.score === q.points ? 'full' : ''}`}>
                      {grade?.score ?? 0} / {q.points} 分
                    </span>
                  </div>
                  <div className="answer-block">
                    <span className="small-label">你的答案</span>
                    <p>{option ? `${answer} · ${option.text}` : answer || '未作答'}</p>
                  </div>
                  {q.explanation && (
                    <div className="explanation-block">
                      <span className="small-label">题目解析</span>
                      <Text>{q.explanation}</Text>
                    </div>
                  )}
                  <div className="teacher-feedback">
                    <span className="feedback-mark" aria-hidden="true">
                      ↳
                    </span>
                    <Text>{grade?.feedback ?? '老师暂无补充反馈。'}</Text>
                  </div>
                </div>
              );
            })}
          </section>
          <section className="next-note">
            <span className="small-label">下一小步</span>
            <Text>{review.next_steps}</Text>
            <div className="result-actions">
              <Link to="/" className="button primary">
                回到今日学习
                <Icon name="arrow" />
              </Link>
              <Link to={`/lessons/${lesson.id}`} className="button subtle">
                回到课程，再练一次
              </Link>
            </div>
          </section>
        </>
      ) : (
        <section className="submitted-page">
          <span className="submission-mark" aria-hidden="true">
            <Icon name="check" size={35} />
          </span>
          <span className="eyebrow">PRACTICE, COMPLETE</span>
          <h1>
            这一小步，
            <br />
            已经留下了。
          </h1>
          <p className="intro">
            已提交，待老师反馈。
            <br />
            把提示词带回 Agent，老师会根据你的作答逐题回应。
          </p>
          <div className="handoff-card">
            <span className="small-label">复制提示词，继续学习</span>
            <p className="handoff-text">{handoff}</p>
            <CopyButton text={handoff} primary label="复制提示词，继续学习" />
            <p className="field-help">提示词含准确的答题记录与后端标识，不包含密钥。</p>
          </div>
          <div className="submission-detail">
            <span>{lesson.title}</span>
            <code title="答题记录 ID">{attempt.id}</code>
          </div>
          <button className="text-link" onClick={load} disabled={busy}>
            <Icon name="refresh" size={16} />
            {busy ? '正在查看…' : '老师已反馈？刷新结果'}
          </button>
        </section>
      )}
      {error && <Notice error>{error}</Notice>}
    </article>
  );
}

function HistoryPage({ data }: { data: Dashboard }) {
  const [filter, setFilter] = useState('all');
  const records = [...data.attempts]
    .filter((a) => filter === 'all' || a.status === filter)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const topics = new Map<string, string>();
  data.packs.forEach((p) =>
    (p.topics ?? p.pack?.topics ?? []).forEach((t) => topics.set(t.id, t.title)),
  );
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">THE EVIDENCE OF GROWTH</span>
        <h1>
          走过的，<span className="serif-emphasis">都算数。</span>
        </h1>
        <p className="intro">
          讲过、看过和练习证明的掌握，分别记录。
          <br />
          成长不靠猜测，靠每一次认真练习。
        </p>
      </div>
      <section>
        <div className="section-heading">
          <h2>
            <span className="section-index">01</span>练习与反馈
          </h2>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="筛选练习记录"
          >
            <option value="all">全部记录</option>
            <option value="in_progress">学习中</option>
            <option value="submitted">待老师反馈</option>
            <option value="reviewed">已有反馈</option>
          </select>
        </div>
        {records.length === 0 ? (
          <Empty title="第一行，留给今天">
            完成一份练习后，这里会保存你的作答、老师的反馈和每一小步。
          </Empty>
        ) : (
          <div className="record-list">
            {records.map((a, index) => {
              const lesson = data.lessons.find((l) => l.id === a.lesson_id);
              return (
                <Link
                  key={a.id}
                  to={a.status === 'in_progress' ? `/lessons/${a.lesson_id}` : `/attempts/${a.id}`}
                  className="record-row"
                >
                  <span className="record-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="record-title">
                    <h3>{lesson?.title ?? '学习课程'}</h3>
                    <span>
                      {kindName(lesson?.kind ?? 'daily')} <span className="middle-dot">·</span>{' '}
                      {stamp(a.created_at)}
                    </span>
                  </div>
                  <span className={`record-status ${a.status}`}>{statusName(a.status)}</span>
                  <Icon name="arrow" size={18} />
                </Link>
              );
            })}
          </div>
        )}
      </section>
      <section className="evidence-section">
        <div className="section-heading">
          <h2>
            <span className="section-index">02</span>知识点证据
          </h2>
          <span className="muted">以练习结果为依据</span>
        </div>
        {!data.progress.length ? (
          <p className="no-evidence">还没有练习证据。未完成摸底，不代表能力低。</p>
        ) : (
          <div className="evidence-grid">
            {data.progress.map((p) => (
              <div className="evidence-item" key={`${p.goal_id}:${p.topic_id}`}>
                <div>
                  <h3>{topics.get(p.topic_id) ?? p.topic_id}</h3>
                  <span className={`mastery ${p.mastery}`}>{masteryName(p.mastery)}</span>
                </div>
                <div className="evidence-numbers">
                  <span>
                    接触 <strong>{p.exposures}</strong>
                  </span>
                  <span>
                    作答 <strong>{p.attempts}</strong>
                  </span>
                  <span>
                    正确 <strong>{p.correct}</strong>
                  </span>
                </div>
                <div className="progress-track">
                  <i style={{ width: `${p.possible ? (p.earned / p.possible) * 100 : 0}%` }} />
                </div>
                <p>
                  {p.possible ? `累计得分 ${p.earned} / ${p.possible}` : '尚待练习验证'}
                  <span>{p.due_at ? `复习 · ${stamp(p.due_at)}` : '暂未安排复习'}</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function PackInstaller({
  reload,
  notify,
}: {
  reload: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [repository, setRepository] = useState('');
  const [ref, setRef] = useState('');
  const [upload, setUpload] = useState<{ name: string; pack: unknown }>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function chooseFile(file?: File) {
    setUpload(undefined);
    setError('');
    setMessage('');
    if (!file) return;
    if (file.size > 384000) {
      setError('学习包 JSON 不能超过 384,000 字节。');
      return;
    }
    try {
      setUpload({ name: file.name, pack: JSON.parse(await file.text()) });
    } catch {
      setError('这个文件不是有效的 JSON，请选择学习包仓库中的 pack.json。');
    }
  }
  async function useUpload(install: boolean) {
    if (!upload || busy) return;
    setBusy(install ? 'upload-install' : 'upload-validate');
    setError('');
    setMessage('');
    try {
      const validation = await rpc<{ id: string; version: string }>('validate_pack', {
        pack: upload.pack,
      });
      if (install) {
        await rpc('install_pack', {
          pack: upload.pack,
          source: { kind: 'local', url: 'browser-upload' },
        });
        await reload();
        setMessage(`已安装 ${validation.id}@${validation.version}。`);
        notify('书架已更新。');
      } else setMessage(`校验通过：${validation.id}@${validation.version}，可以安装。`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function useGithub(install: boolean) {
    if (busy) return;
    setBusy(install ? 'github-install' : 'github-validate');
    setError('');
    setMessage('');
    try {
      const result = await request<Pack & { valid?: boolean; id: string; version: string }>(
        '/api/packs/github',
        { repository: repository.trim(), ref: ref.trim(), validate_only: !install },
      );
      if (install) {
        await reload();
        setMessage(`已安装 ${result.id}@${result.version}。`);
        notify('书架已更新。');
      } else setMessage(`校验通过：${result.id}@${result.version}，可以安装。`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="pack-installer">
      <div className="pack-install-heading">
        <h3>把下一份好教材，放上书架。</h3>
        <p>从 GitHub 指定版本安装，或上传学习包的 pack.json。内容由当前平台保存。</p>
      </div>
      <div className="pack-install-grid">
        <form
          className="pack-install-form"
          onSubmit={(e) => {
            e.preventDefault();
            void useGithub(true);
          }}
        >
          <span className="small-label">来自 GITHUB 仓库</span>
          <label>
            学习包仓库
            <input
              value={repository}
              onChange={(e) => setRepository(e.target.value)}
              placeholder="https://github.com/作者/学习包"
              required
              maxLength={500}
              disabled={!!busy}
            />
          </label>
          <label>
            版本或提交
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="例如 v1.0.0、main 或 commit"
              required
              maxLength={200}
              disabled={!!busy}
            />
          </label>
          <div className="pack-install-actions">
            <button
              type="button"
              className="button subtle"
              disabled={!!busy || !repository.trim() || !ref.trim()}
              onClick={() => void useGithub(false)}
            >
              {busy === 'github-validate' ? '正在校验…' : '校验 GitHub 学习包'}
            </button>
            <button className="button primary" disabled={!!busy}>
              {busy === 'github-install' ? '正在安装…' : '安装 GitHub 学习包'}
            </button>
          </div>
        </form>
        <div className="pack-install-form">
          <span className="small-label">来自本地文件</span>
          <label>
            选择学习包 JSON
            <input
              type="file"
              accept="application/json,.json"
              disabled={!!busy}
              onChange={(e) => void chooseFile(e.currentTarget.files?.[0])}
            />
          </label>
          <p className="field-help">
            {upload ? `${upload.name} 已选择。` : '选择仓库中的 pack.json，最大 384,000 字节。'}{' '}
            平台会检查内容、依赖与材料引用。
          </p>
          <div className="pack-install-actions">
            <button
              type="button"
              className="button subtle"
              disabled={!!busy || !upload}
              onClick={() => void useUpload(false)}
            >
              {busy === 'upload-validate' ? '正在校验…' : '校验上传的学习包'}
            </button>
            <button
              type="button"
              className="button primary"
              disabled={!!busy || !upload}
              onClick={() => void useUpload(true)}
            >
              {busy === 'upload-install' ? '正在安装…' : '安装上传的学习包'}
            </button>
          </div>
        </div>
      </div>
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
    </div>
  );
}

function SettingsPage({
  data,
  reload,
  notify,
}: {
  data: Dashboard;
  reload: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [title, setTitle] = useState('');
  const firstPack = manifest(data.packs[0] ?? {});
  const [packKey, setPackKey] = useState(firstPack ? `${firstPack.id}@${firstPack.version}` : '');
  const [minutes, setMinutes] = useState(15);
  const [examDate, setExamDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(data.goals.length === 0);
  const [editing, setEditing] = useState<string>();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const selectedPack = data.packs
        .map(manifest)
        .find((m) => m && `${m.id}@${m.version}` === packKey);
      await rpc(
        editing ? 'update_goal' : 'create_goal',
        editing
          ? {
              id: editing,
              title,
              daily_minutes: minutes,
              ...(examDate ? { exam_date: examDate } : {}),
            }
          : {
              title,
              pack_id: selectedPack?.id,
              pack_version: selectedPack?.version,
              daily_minutes: minutes,
              ...(examDate ? { exam_date: examDate } : {}),
            },
      );
      await reload();
      setTitle('');
      setEditing(undefined);
      setShowForm(false);
      notify(editing ? '学习目标已更新。' : '目标已记下，去和 AI 老师开始第一课。');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">A PLACE FOR YOUR CURIOSITY</span>
        <h1>
          给好奇心，<span className="serif-emphasis">一个方向。</span>
        </h1>
        <p className="intro">
          目标决定去哪里，学习包提供可信的路径。
          <br />
          你的 Agent，陪你走好每一小步。
        </p>
      </div>
      <section>
        <div className="section-heading">
          <h2>
            <span className="section-index">01</span>我的学习方向
          </h2>
          <button
            className="text-link"
            onClick={() => {
              setEditing(undefined);
              setTitle('');
              setShowForm(!showForm);
            }}
          >
            <Icon name="plus" size={16} />
            新建目标
          </button>
        </div>
        {data.goals.length ? (
          <div className="goal-list">
            {data.goals.map((g) => (
              <div key={g.id} className="goal-row">
                <span className="goal-dot" />
                <div>
                  <h3>{g.title}</h3>
                  <p>
                    每天 {g.daily_minutes} 分钟 <span className="middle-dot">·</span> {g.pack_id}@
                    {g.pack_version}
                    {g.exam_date && (
                      <>
                        {' '}
                        <span className="middle-dot">·</span> 目标日期 {g.exam_date}
                      </>
                    )}
                  </p>
                </div>
                <button
                  className="text-link"
                  onClick={() => {
                    setEditing(g.id);
                    setTitle(g.title);
                    setMinutes(g.daily_minutes);
                    setExamDate(g.exam_date ?? '');
                    setShowForm(true);
                  }}
                >
                  编辑
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="no-evidence">还没有学习目标。从一个你想学会的小方向开始。</p>
        )}
        {showForm && (
          <form className="goal-form" onSubmit={submit}>
            <div className="form-grid">
              <label className="wide-field">
                我想学会什么
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={200}
                  placeholder="例如：用英语清楚地解释我的项目"
                />
              </label>
              {!editing && (
                <label className="wide-field">
                  关联学习包
                  <select required value={packKey} onChange={(e) => setPackKey(e.target.value)}>
                    <option value="">选择已安装学习包</option>
                    {data.packs.map((p) => {
                      const m = manifest(p);
                      return (
                        m && (
                          <option value={`${m.id}@${m.version}`} key={`${m.id}@${m.version}`}>
                            {m.name} · {m.version}
                          </option>
                        )
                      );
                    })}
                  </select>
                </label>
              )}
              <label>
                每天留给学习的时间
                <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                  {[10, 15, 20, 30].map((v) => (
                    <option value={v} key={v}>
                      {v} 分钟
                    </option>
                  ))}
                </select>
              </label>
              <label>
                目标日期（可选）
                <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
              </label>
            </div>
            {error && <Notice error>{error}</Notice>}
            <div className="form-actions">
              <button type="button" className="button subtle" onClick={() => setShowForm(false)}>
                暂时收起
              </button>
              <button
                className="button primary"
                disabled={busy || (!editing && !data.packs.length)}
              >
                {busy ? '正在保存…' : editing ? '保存目标' : '记下这个目标'}
                <Icon name="arrow" size={17} />
              </button>
            </div>
            {!data.packs.length && (
              <p className="field-help">先在下方安装一个学习包，再创建目标。</p>
            )}
          </form>
        )}
      </section>
      <section className="bookshelf-section">
        <div className="section-heading">
          <h2>
            <span className="section-index">02</span>书架上的学习包
          </h2>
          <span className="muted">{data.packs.length} 个版本</span>
        </div>
        <PackInstaller reload={reload} notify={notify} />
        {!data.packs.length ? (
          <div className="pack-empty">
            <h3>好教材，让每一步更有依据。</h3>
            <p>从 GitHub 安装一个明确版本，或上传 English Demo 的 pack.json，开始整理学习方向。</p>
          </div>
        ) : (
          <div className="pack-grid">
            {data.packs.map((p, i) => {
              const m = manifest(p);
              return (
                m && (
                  <article className="pack-book" key={`${m.id}:${m.version}`}>
                    <div className={`book-spine spine-${i % 3}`} />
                    <div className="pack-book-content">
                      <span className="small-label">
                        {m.language} <span className="middle-dot">/</span> LEARNING PACK
                      </span>
                      <h3>{m.name}</h3>
                      <p>{m.description}</p>
                      <div className="pack-book-bottom">
                        <code>{m.version}</code>
                        <span>{m.id.includes('demo') ? '功能演示材料' : m.license}</span>
                      </div>
                      <div className="pack-source">
                        <span>
                          {p.source?.kind === 'github'
                            ? 'GitHub 来源'
                            : p.source?.kind === 'import'
                              ? '迁移导入'
                              : '本地上传'}
                        </span>
                        {p.source?.url && (
                          <p>{p.source.url === 'browser-upload' ? '浏览器上传' : p.source.url}</p>
                        )}
                        {p.source?.ref && <p>版本引用：{p.source.ref}</p>}
                        {p.source?.resolved && (
                          <p>
                            实际提交：<code>{p.source.resolved}</code>
                          </p>
                        )}
                      </div>
                    </div>
                  </article>
                )
              );
            })}
          </div>
        )}
        <p className="pack-note">
          更新学习包时安装新的版本，已安装版本与已有目标的内容版本会保留。过去的题目与成绩不会被改写。
        </p>
      </section>
      <section className="backend-section">
        <div className="section-heading">
          <h2>
            <span className="section-index">03</span>这本札记存在哪里
          </h2>
        </div>
        <div className="backend-info">
          <span className="status-dot" />
          <div>
            <strong>{data.backend_id || '当前实例'}</strong>
            <p>{data.base_url || location.origin}</p>
          </div>
          <button
            className="text-link"
            onClick={async () => {
              try {
                await request('/api/logout', {});
                await reload();
                notify('登录状态已刷新。');
              } catch (err) {
                notify((err as Error).message);
              }
            }}
          >
            <Icon name="logout" size={16} />
            退出登录
          </button>
        </div>
        <p className="field-help">
          学习包、课程、作答和反馈由当前平台保存。CLI 可连接不同实例；切换连接不会自动迁移学习记录。
        </p>
      </section>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
