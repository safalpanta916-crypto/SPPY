import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useCreateAiCompletion, useExtractAiAttachment, useGetAiStatus, useHealthCheck, useStreamAiCompletion, getGetAiStatusQueryKey, getHealthCheckQueryKey, type AiStatus, type ChatInputMode } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { VoiceInputControls, VoiceOutputControls } from '@/components/voice-controls';
import MotionLabPage from '@/pages/motion-lab';
import { Route, Switch, Link, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { ArrowDown, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Code2, Copy, Cpu, FileText, Globe2, ImagePlus, LoaderCircle, Menu, MessageSquare, Moon, MoreHorizontal, Pencil, Plus, Search, Send, Settings2, Shield, Sparkles, Square, Sun, Trash2, X, WandSparkles, WifiOff } from 'lucide-react';
import type { AttachmentText, ChatTurn } from '@workspace/api-client-react';

type Mode = ChatInputMode;
type Attachment = AttachmentText;
type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string; attachments?: Attachment[] };
type Conversation = { id: string; title: string; mode: Mode; createdAt: string; updatedAt: string; messages: Message[] };
type Theme = 'dark' | 'light';
type VoicePreferences = { enabled: boolean; rate: number; voiceName: string };

const queryClient = new QueryClient();
const STORE_KEY = 'sppy.workspace.v1';
const PREF_KEY = 'sppy.preferences.v1';
const modes: { id: Mode; name: string; description: string; icon: typeof Sparkles }[] = [
  { id: 'general', name: 'General', description: 'A clear-thinking partner for anything.', icon: Sparkles },
  { id: 'developer', name: 'Developer', description: 'Build, debug, and understand code.', icon: Code2 },
  { id: 'cyber', name: 'Cyber safety', description: 'Defensive security and safer systems.', icon: Shield },
  { id: 'study', name: 'Study', description: 'Learn concepts at your own pace.', icon: BookOpen },
  { id: 'writer', name: 'Writing', description: 'Find the right words and structure.', icon: FileText },
  { id: 'creative', name: 'Creative', description: 'Explore ideas and make something new.', icon: WandSparkles },
  { id: 'research', name: 'Research', description: 'Reason through a topic. No live browsing.', icon: Globe2 },
];
const examples: Record<Mode, string[]> = {
  general: ['Explain a difficult idea simply', 'Help me plan a focused week', 'What should I learn next?'],
  developer: ['Review this function for edge cases', 'Explain how HTTP caching works', 'Help me debug a React state issue'],
  cyber: ['How do I harden a small home network?', 'Explain phishing-resistant MFA', 'Build a safe incident response checklist'],
  study: ['Teach me recursion with an example', 'Quiz me on the water cycle', 'Turn these notes into a study plan'],
  writer: ['Help me make this clearer and warmer', 'Outline a short project proposal', 'Find a better opening for this essay'],
  creative: ['Give me a strange premise for a short story', 'Help name a small design studio', 'Make a creative prompt from this idea'],
  research: ['Compare two approaches to renewable storage', 'Help me frame a research question', 'What assumptions should I test?'],
};

function makeId() { return crypto.randomUUID(); }
function makeConversation(mode: Mode = 'general'): Conversation {
  const now = new Date().toISOString();
  return { id: makeId(), title: 'New conversation', mode, createdAt: now, updatedAt: now, messages: [] };
}
function readConversations(): Conversation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 25) : [];
  } catch { return []; }
}
function readTheme(): Theme {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}').theme === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}
function readVoicePreferences(): VoicePreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    return {
      enabled: stored.voiceEnabled === true,
      rate: typeof stored.voiceRate === 'number' ? Math.max(0.75, Math.min(1.25, stored.voiceRate)) : 1,
      voiceName: typeof stored.voiceName === 'string' ? stored.voiceName : '',
    };
  } catch { return { enabled: false, rate: 1, voiceName: '' }; }
}
function shorten(text: string) { return text.replace(/\s+/g, ' ').trim().slice(0, 54) || 'New conversation'; }
function safeHtml(text: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const pieces = text.split(/(```[\s\S]*?```)/g);
  return pieces.map((piece) => {
    if (piece.startsWith('```')) {
      const match = piece.match(/^```([\w-]*)\n?([\s\S]*?)```$/);
      if (!match) return esc(piece);
      return `<pre><code>${esc(match[2])}</code></pre>`;
    }
    return piece.split('\n').map((line) => {
      if (/^### /.test(line)) return `<h3>${esc(line.slice(4))}</h3>`;
      if (/^## /.test(line)) return `<h2>${esc(line.slice(3))}</h2>`;
      if (/^# /.test(line)) return `<h1>${esc(line.slice(2))}</h1>`;
      if (/^\s*[-*] /.test(line)) return `<li>${esc(line.replace(/^\s*[-*] /, ''))}</li>`;
      if (/^\s*\d+\. /.test(line)) return `<li>${esc(line.replace(/^\s*\d+\. /, ''))}</li>`;
      if (/^> /.test(line)) return `<blockquote>${esc(line.slice(2))}</blockquote>`;
      if (!line.trim()) return '<br />';
      return `<p>${esc(line).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>')}</p>`;
    }).join('');
  }).join('');
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="flex items-center gap-2.5" data-testid="link-brand-home">
    <img src="/assets/sppyntex-logo.jpg" alt="SPPyntex" className="h-9 w-9 rounded-lg object-contain" data-testid="img-sppyntex-logo" />
    {!compact && <span className="display text-[17px] font-extrabold tracking-[-.06em]">SPPY<span className="ml-1 font-medium tracking-normal text-muted-foreground">/ AI</span></span>}
  </Link>;
}

function Toast({ notice, onClose }: { notice: string; onClose: () => void }) {
  useEffect(() => { if (!notice) return undefined; const timer = window.setTimeout(onClose, 3600); return () => window.clearTimeout(timer); }, [notice, onClose]);
  if (!notice) return null;
  return <div className="toast-pop fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-xl" role="status" data-testid="status-toast"><Check size={15} className="text-primary" />{notice}<button onClick={onClose} aria-label="Dismiss notice" data-testid="button-dismiss-toast"><X size={14} /></button></div>;
}

function SiteHeader({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <header className="relative z-10 flex h-[68px] items-center justify-between border-b border-border/70 px-5 md:px-10">
    <Brand />
    <nav className="hidden items-center gap-7 text-[13px] text-muted-foreground md:flex" aria-label="Main navigation">
      <Link href="/explore" className="transition hover:text-foreground" data-testid="link-explore">Explore</Link>
      <Link href="/motion-lab" className="transition hover:text-foreground" data-testid="link-motion-lab">Motion Lab</Link>
      <Link href="/projects" className="transition hover:text-foreground" data-testid="link-projects">Projects</Link>
      <Link href="/about" className="transition hover:text-foreground" data-testid="link-about">About</Link>
    </nav>
    <div className="flex items-center gap-2">
      <button onClick={toggleTheme} className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} data-testid="button-theme-toggle">{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
      <Link href="/chat" className="hidden items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition hover:opacity-90 sm:flex" data-testid="button-header-start">Open SPPY <ArrowRight size={14} /></Link>
      <button onClick={() => setMenuOpen(!menuOpen)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-secondary md:hidden" aria-label="Open navigation" data-testid="button-mobile-menu"><Menu size={18} /></button>
    </div>
    {menuOpen && <div className="absolute right-4 top-[60px] flex w-48 flex-col rounded-xl border border-border bg-card p-2 shadow-xl md:hidden">
      {[['Explore', '/explore'], ['Motion Lab', '/motion-lab'], ['Projects', '/projects'], ['About', '/about'], ['Open SPPY', '/chat']].map(([label, href]) => <Link href={href} key={href} onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2.5 text-sm hover:bg-secondary" data-testid={`link-mobile-${label.toLowerCase().replaceAll(' ', '-')}`}>{label}</Link>)}
    </div>}
  </header>;
}

function Footer() {
  return <footer className="mt-24 border-t border-border/70 px-6 py-8">
    <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><img src="/assets/sppyntex-logo.jpg" alt="SPPyntex" className="h-8 w-8 rounded-md object-contain" /><div><p className="text-sm font-semibold">SPPY by SPPyntex</p><p className="text-xs text-muted-foreground">Created by Safal Panta</p></div></div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><Link href="/about" className="hover:text-foreground" data-testid="link-footer-about">About</Link><Link href="/privacy" className="hover:text-foreground" data-testid="link-footer-privacy">Privacy</Link><Link href="/terms" className="hover:text-foreground" data-testid="link-footer-terms">Terms</Link><Link href="/projects" className="hover:text-foreground" data-testid="link-footer-projects">SPPyntex projects</Link></div>
      <span className="mono text-[10px] tracking-[.14em] text-muted-foreground">THOUGHTFUL AI. OPEN TO ALL.</span>
    </div>
  </footer>;
}

function HomePage({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  return <div className="grain app-shell">
    <SiteHeader theme={theme} toggleTheme={toggleTheme} />
    <main>
      <section className="relative mx-auto flex min-h-[650px] max-w-6xl flex-col items-center justify-center px-6 pb-20 pt-24 text-center md:min-h-[720px]">
        <div className="absolute left-[8%] top-[23%] hidden h-32 w-32 rounded-full border border-primary/15 md:block" />
        <div className="absolute right-[9%] top-[18%] hidden h-2 w-2 rounded-full bg-primary md:block" />
        <div className="fade-in mb-7 flex items-center gap-2 rounded-full border border-border bg-card/70 px-3.5 py-2 text-[11px] tracking-wide text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" /> OFFICIAL AI BY SPPYNTEX <span className="mx-1 text-border">/</span> MADE FOR EVERYONE
        </div>
        <h1 className="display fade-in max-w-4xl text-[clamp(3.35rem,9vw,7.4rem)] font-extrabold leading-[.97] tracking-[-.075em] [animation-delay:60ms]">Think beyond<br /><span className="text-primary">limits.</span></h1>
        <p className="fade-in mt-7 max-w-[520px] text-base leading-7 text-muted-foreground [animation-delay:120ms] md:text-lg">A thoughtful AI workspace for learning, creating, coding, research, and the questions in between.</p>
        <Link href="/chat" className="fade-in mt-9 inline-flex items-center gap-3 rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-[0_10px_40px_hsl(var(--primary)/.18)] transition hover:-translate-y-0.5 [animation-delay:180ms]" data-testid="button-landing-start">Start a conversation <ArrowRight size={16} /></Link>
        <p className="mt-4 text-[11px] text-muted-foreground">No account. Your conversations stay on this device.</p>
        <div className="mt-20 flex w-full max-w-3xl items-center justify-between border-y border-border/70 py-5 text-left">
          {[['01', 'Learn with clarity'], ['02', 'Make useful things'], ['03', 'Stay in control']].map(([n, text]) => <div key={n} className="flex items-center gap-3"><span className="mono text-[10px] text-primary">{n}</span><span className="text-xs text-muted-foreground md:text-sm">{text}</span></div>)}
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <div className="mb-12 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><span className="mono text-[10px] tracking-[.18em] text-primary">ONE WORKSPACE, MANY WAYS IN</span><h2 className="display mt-4 text-4xl font-bold tracking-tight md:text-5xl">Good work starts<br className="hidden md:block" /> with a better question.</h2></div><p className="max-w-sm text-sm leading-6 text-muted-foreground">Choose a mode to set the tone. Change direction whenever you need to.</p></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {modes.slice(0, 4).map((mode, i) => { const Icon = mode.icon; return <Link href="/chat" className={`group min-h-44 rounded-2xl border border-border bg-card/45 p-5 transition hover:-translate-y-1 hover:border-primary/40 ${i === 0 ? 'lg:col-span-2' : ''}`} key={mode.id} data-testid={`card-mode-${mode.id}`}><div className="mb-10 flex items-start justify-between"><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-accent-foreground"><Icon size={17} /></span><ArrowRight size={15} className="text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" /></div><h3 className="display text-lg font-bold">{mode.name}</h3><p className="mt-1 text-xs text-muted-foreground">{mode.description}</p></Link>; })}
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-[1fr_1.1fr] md:items-center md:py-24">
        <div><span className="mono text-[10px] tracking-[.18em] text-primary">BUILT AROUND YOUR PRIVACY</span><h2 className="display mt-4 text-4xl font-bold leading-tight tracking-tight md:text-5xl">Your space.<br />Your conversations.</h2><p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">SPPY works without an account. Guest conversations live in your browser, not on a conversation server. Clear them whenever you like.</p><Link href="/privacy" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary" data-testid="link-home-privacy">How privacy works <ArrowRight size={15} /></Link></div>
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-7 md:p-10"><div className="absolute -right-12 -top-16 h-52 w-52 rounded-full border border-primary/20" /><div className="absolute -right-4 -top-8 h-36 w-36 rounded-full border border-primary/15" /><div className="relative"><div className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-primary" /><span className="mono text-[10px] tracking-wider text-muted-foreground">A QUIETER KIND OF AI</span></div><p className="display mt-14 max-w-md text-2xl font-semibold leading-relaxed tracking-tight md:text-3xl">“The best tool is the one that helps you think for yourself.”</p><div className="mt-10 flex items-center gap-3 border-t border-border pt-5"><img src="/assets/sppyntex-logo.jpg" className="h-9 w-9 rounded-lg object-contain" alt="SPPyntex logo" /><div><p className="text-sm font-semibold">SPPyntex</p><p className="text-xs text-muted-foreground">Independent by design</p></div></div></div></div>
      </section>
      <section className="mx-auto max-w-6xl px-6 pb-10 pt-12 text-center md:pb-16"><div className="rounded-3xl border border-border bg-card/55 px-6 py-14 md:px-10 md:py-20"><span className="mono text-[10px] tracking-[.18em] text-primary">BEGIN WITH ONE QUESTION</span><h2 className="display mx-auto mt-4 max-w-2xl text-4xl font-bold tracking-tight md:text-6xl">A little momentum goes a long way.</h2><Link href="/chat" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground" data-testid="button-bottom-start">Try SPPY <ArrowRight size={15} /></Link></div></section>
    </main><Footer />
  </div>;
}

function Sidebar({ conversations, activeId, onNew, onRename, onDelete, onClear, onOpenSettings, mobileOpen, setMobileOpen }: {
  conversations: Conversation[]; activeId?: string; onNew: () => void; onRename: (item: Conversation) => void; onDelete: (item: Conversation) => void; onClear: () => void; onOpenSettings: () => void; mobileOpen: boolean; setMobileOpen: (open: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const [menuId, setMenuId] = useState('');
  const [location] = useLocation();
  const filtered = useMemo(() => conversations.filter((item) => item.title.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [conversations, search]);
  const content = <div className="flex h-full flex-col">
    <div className="flex h-[66px] items-center justify-between px-4"><Brand /><button className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close sidebar" data-testid="button-close-sidebar"><X size={16} /></button></div>
    <div className="px-3 pb-3"><button onClick={onNew} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90" data-testid="button-new-chat"><Plus size={16} />New conversation</button></div>
    <div className="px-3 pb-3"><label className="flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-background/70 px-2.5 text-muted-foreground"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search conversations" className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground" data-testid="input-search-conversations" /></label></div>
    <div className="flex-1 overflow-y-auto px-3 scrollbar-thin">
      <div className="mb-2 flex items-center justify-between px-2 pt-2"><span className="mono text-[9px] tracking-[.15em] text-muted-foreground">RECENT</span><span className="text-[10px] text-muted-foreground">{filtered.length}</span></div>
      {filtered.length === 0 ? <div className="px-2 py-6 text-xs leading-5 text-muted-foreground" data-testid="text-history-empty">{search ? 'No conversations match that search.' : 'Your conversations will appear here.'}</div> : filtered.map((item) => <div className={`group relative mb-1 flex items-center rounded-lg ${activeId === item.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'}`} key={item.id} data-testid={`conversation-item-${item.id}`}>
        <Link href={`/chat/${item.id}`} onClick={() => setMobileOpen(false)} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2.5 text-left text-xs" data-testid={`link-conversation-${item.id}`}><MessageSquare size={14} className="shrink-0 opacity-70" /><span className="truncate">{item.title}</span></Link>
        <button onClick={() => setMenuId(menuId === item.id ? '' : item.id)} className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md opacity-0 hover:bg-background group-hover:opacity-100 focus:opacity-100" aria-label="Conversation options" data-testid={`button-conversation-options-${item.id}`}><MoreHorizontal size={15} /></button>
        {menuId === item.id && <div className="absolute right-2 top-9 z-30 w-36 rounded-xl border border-border bg-card p-1 shadow-xl"><button onClick={() => { onRename(item); setMenuId(''); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs hover:bg-secondary" data-testid={`button-rename-${item.id}`}><Pencil size={13} />Rename</button><button onClick={() => { onDelete(item); setMenuId(''); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-destructive hover:bg-secondary" data-testid={`button-delete-${item.id}`}><Trash2 size={13} />Delete</button></div>}
      </div>)}
      {!search && <div className="mt-6 border-t border-border/70 px-2 pt-4"><Link href="/explore" className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs ${location === '/explore' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary'}`} onClick={() => setMobileOpen(false)} data-testid="link-sidebar-explore"><Sparkles size={14} />Explore modes</Link><Link href="/motion-lab" className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs ${location === '/motion-lab' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary'}`} onClick={() => setMobileOpen(false)} data-testid="link-sidebar-motion-lab"><WandSparkles size={14} />Motion Lab</Link><Link href="/projects" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-muted-foreground hover:bg-secondary" onClick={() => setMobileOpen(false)} data-testid="link-sidebar-projects"><Cpu size={14} />SPPyntex projects</Link><Link href="/about" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-muted-foreground hover:bg-secondary" onClick={() => setMobileOpen(false)} data-testid="link-sidebar-about"><BookOpen size={14} />About SPPY</Link></div>}
    </div>
    <div className="border-t border-border/70 p-3"><div className="mb-2 flex items-center gap-2 rounded-lg bg-background/55 px-2.5 py-2"><span className="h-1.5 w-1.5 rounded-full bg-primary" /><span className="text-[10px] text-muted-foreground">Guest workspace · local history</span></div><div className="flex gap-1"><button onClick={onOpenSettings} className="flex flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground" data-testid="button-settings"><Settings2 size={14} />Settings</button><button onClick={onClear} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive" title="Clear all conversations" aria-label="Clear all conversations" data-testid="button-clear-history"><Trash2 size={14} /></button></div></div>
  </div>;
  return <>
    <aside className="hidden h-dvh w-[260px] shrink-0 border-r border-border/80 bg-sidebar lg:block" data-testid="sidebar-desktop">{content}</aside>
    {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-black/60" aria-label="Close navigation overlay" onClick={() => setMobileOpen(false)} data-testid="button-sidebar-overlay" /><aside className="relative h-full w-[min(300px,86vw)] border-r border-border bg-sidebar">{content}</aside></div>}
  </>;
}

function Confirmation({ title, detail, confirmText, onConfirm, onCancel, danger = false }: { title: string; detail: string; confirmText: string; onConfirm: () => void; onCancel: () => void; danger?: boolean }) {
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-black/65 p-4" role="dialog" aria-modal="true" data-testid="dialog-confirm"><div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"><h2 className="display text-xl font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p><div className="mt-6 flex justify-end gap-2"><button onClick={onCancel} className="rounded-lg border border-border px-3.5 py-2 text-sm hover:bg-secondary" data-testid="button-confirm-cancel">Cancel</button><button onClick={onConfirm} className={`rounded-lg px-3.5 py-2 text-sm font-semibold text-white ${danger ? 'bg-destructive' : 'bg-primary'}`} data-testid="button-confirm-action">{confirmText}</button></div></div></div>;
}
function RenameDialog({ item, onSave, onCancel }: { item: Conversation; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(item.title);
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-black/65 p-4" role="dialog" aria-modal="true" data-testid="dialog-rename"><form onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSave(value.trim()); }} className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"><h2 className="display text-xl font-bold">Rename conversation</h2><input autoFocus value={value} onChange={(e) => setValue(e.target.value)} className="mt-5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" aria-label="Conversation title" data-testid="input-rename-conversation" /><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-lg border border-border px-3.5 py-2 text-sm" data-testid="button-rename-cancel">Cancel</button><button className="rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground" data-testid="button-rename-save">Save name</button></div></form></div>;
}

function SettingsDialog({
  theme,
  toggleTheme,
  onClear,
  onClose,
  voiceEnabled,
  onVoiceEnabledChange,
  voiceRate,
  onVoiceRateChange,
  voiceName,
  onVoiceNameChange,
}: {
  theme: Theme;
  toggleTheme: () => void;
  onClear: () => void;
  onClose: () => void;
  voiceEnabled: boolean;
  onVoiceEnabledChange: (enabled: boolean) => void;
  voiceRate: number;
  onVoiceRateChange: (rate: number) => void;
  voiceName: string;
  onVoiceNameChange: (name: string) => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const update = () => setVoices(window.speechSynthesis.getVoices());
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-black/65 p-4" role="dialog" aria-modal="true" data-testid="dialog-settings">
    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
      <div className="flex items-start justify-between"><div><span className="mono text-[10px] tracking-widest text-primary">PREFERENCES</span><h2 className="display mt-1 text-2xl font-bold">Settings</h2></div><button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary" aria-label="Close settings" data-testid="button-close-settings"><X size={16} /></button></div>
      <div className="mt-6 divide-y divide-border">
        <div className="flex items-center justify-between py-4"><div><p className="text-sm font-semibold">Appearance</p><p className="mt-1 text-xs text-muted-foreground">Choose the workspace theme.</p></div><button onClick={toggleTheme} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs" data-testid="button-settings-theme">{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}{theme === 'dark' ? 'Light' : 'Dark'} mode</button></div>
        <div className="py-4" data-testid="settings-voice">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-sm font-semibold">Response voice</p><p className="mt-1 max-w-[250px] text-xs leading-5 text-muted-foreground">Optional browser speech. Responses are read only when you press Play.</p></div>
            <input type="checkbox" checked={voiceEnabled} onChange={(event) => onVoiceEnabledChange(event.target.checked)} aria-label="Enable response voice" className="mt-1 h-4 w-4 accent-primary" data-testid="toggle-voice-output" />
          </div>
          {voiceEnabled && <div className="mt-4 grid gap-3">
            <label className="grid gap-1.5 text-xs text-muted-foreground">Speech rate <span className="text-foreground">{voiceRate.toFixed(2)}×</span>
              <input type="range" min="0.75" max="1.25" step="0.05" value={voiceRate} onChange={(event) => onVoiceRateChange(Number(event.target.value))} aria-label="Speech rate" className="accent-primary" data-testid="input-voice-rate" />
            </label>
            {voices.length > 0 && <label className="grid gap-1.5 text-xs text-muted-foreground">Browser voice
              <select value={voiceName} onChange={(event) => onVoiceNameChange(event.target.value)} className="h-9 rounded-lg border border-input bg-background px-2 text-foreground" data-testid="select-voice-name">
                <option value="">Default voice</option>
                {voices.map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} · {voice.lang}</option>)}
              </select>
            </label>}
          </div>}
        </div>
        <div className="py-4"><p className="text-sm font-semibold">Conversation storage</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Saved in this browser only. SPPY does not save guest conversations to a server.</p></div>
        <div className="flex items-center justify-between py-4"><div><p className="text-sm font-semibold">Clear local history</p><p className="mt-1 text-xs text-muted-foreground">Permanently remove this browser’s chats.</p></div><button onClick={onClear} className="rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive hover:bg-destructive/10" data-testid="button-settings-clear">Clear history</button></div>
      </div>
      <button onClick={onClose} className="mt-3 w-full rounded-lg bg-secondary px-4 py-2.5 text-sm" data-testid="button-settings-done">Done</button>
    </div>
  </div>;
}

function ModeMenu({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const [open, setOpen] = useState(false);
  const selected = modes.find((item) => item.id === mode)!;
  const Icon = selected.icon;
  return <div className="relative"><button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground transition hover:bg-secondary hover:text-foreground" data-testid="button-select-mode"><Icon size={14} className="text-primary" />{selected.name}<ChevronDown size={13} /></button>{open && <div className="absolute left-0 top-11 z-40 w-[280px] rounded-xl border border-border bg-card p-1.5 shadow-2xl">{modes.map((item) => { const ItemIcon = item.icon; return <button key={item.id} onClick={() => { onChange(item.id); setOpen(false); }} className={`flex w-full items-start gap-3 rounded-lg p-2.5 text-left hover:bg-secondary ${mode === item.id ? 'bg-secondary/70' : ''}`} data-testid={`button-mode-${item.id}`}><ItemIcon size={15} className="mt-0.5 text-primary" /><span><span className="block text-xs font-semibold">{item.name}</span><span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">{item.description}</span></span>{mode === item.id && <Check size={14} className="ml-auto text-primary" />}</button>; })}</div>}</div>;
}

function MessageBody({ message, onCopy, onRegenerate, lastAssistant, streaming, voiceEnabled, voiceRate, voiceName }: { message: Message; onCopy: (text: string) => void; onRegenerate: () => void; lastAssistant: boolean; streaming: boolean; voiceEnabled: boolean; voiceRate: number; voiceName: string }) {
  return <div className={`group flex gap-3 md:gap-4 ${message.role === 'user' ? 'flex-row-reverse' : ''}`} data-testid={`message-${message.role}-${message.id}`}>
    {message.role === 'assistant' ? <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-primary/25 bg-accent text-accent-foreground"><Sparkles size={15} /></div> : <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-secondary text-[10px] font-bold text-muted-foreground">YOU</div>}
    <div className={`min-w-0 max-w-[min(760px,88%)] ${message.role === 'user' ? 'rounded-2xl rounded-tr-sm bg-secondary px-4 py-3' : 'pt-1'}`}>
      {message.attachments?.length ? <div className="mb-2 flex flex-wrap gap-1.5">{message.attachments.map((file) => <span key={file.filename} className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground"><FileText size={11} />{file.filename}</span>)}</div> : null}
      {message.role === 'assistant' ? message.content ? <div className="message-content text-[14px] leading-7" dangerouslySetInnerHTML={{ __html: safeHtml(message.content) }} data-testid={`content-message-${message.id}`} /> : streaming ? <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />Thinking…</span> : null : <p className="whitespace-pre-wrap text-[14px] leading-6" data-testid={`content-message-${message.id}`}>{message.content}</p>}
      {message.role === 'assistant' && message.content && <div className="mt-3 flex flex-wrap items-center gap-1 opacity-100 transition md:opacity-0 md:group-hover:opacity-100"><button onClick={() => onCopy(message.content)} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground" data-testid={`button-copy-message-${message.id}`}><Copy size={12} />Copy</button>{voiceEnabled && !streaming && <VoiceOutputControls text={message.content} rate={voiceRate} voiceName={voiceName} />}{lastAssistant && !streaming && <button onClick={onRegenerate} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground" data-testid="button-regenerate"><ArrowDown size={12} className="rotate-180" />Regenerate</button>}</div>}
    </div>
  </div>;
}

function ChatScreen({ theme, toggleTheme, conversations, setConversations, onNew, onRename, onDelete, onClear, onSettings, mobileOpen, setMobileOpen, setNotice, voiceEnabled, voiceRate, voiceName }: {
  theme: Theme; toggleTheme: () => void; conversations: Conversation[]; setConversations: (items: Conversation[] | ((previous: Conversation[]) => Conversation[])) => void; onNew: () => void; onRename: (item: Conversation) => void; onDelete: (item: Conversation) => void; onClear: () => void; onSettings: () => void; mobileOpen: boolean; setMobileOpen: (value: boolean) => void; setNotice: (text: string) => void; voiceEnabled: boolean; voiceRate: number; voiceName: string;
}) {
  const params = useParams<{ conversationId?: string }>();
  const [, setLocation] = useLocation();
  const requestedId = params.conversationId;
  const active = conversations.find((item) => item.id === requestedId);
  const [draft, setDraft] = useState('');
  const [modeDraft, setModeDraft] = useState<Mode>('general');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [localError, setLocalError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingIdRef = useRef('');
  const activeRef = useRef(active);
  activeRef.current = active;
  const [sessionId] = useState(() => {
    let stored = localStorage.getItem('sppy.session-id');
    if (!stored || stored.length < 16) { stored = makeId() + makeId().slice(0, 8); localStorage.setItem('sppy.session-id', stored); }
    return stored;
  });
  const { data: status, isLoading: statusLoading, isError: statusError } = useGetAiStatus({ sessionId }, { query: { queryKey: getGetAiStatusQueryKey({ sessionId }), enabled: !!sessionId, retry: 1 } });
  const { data: health, isError: healthError } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), retry: 1, staleTime: 30000 } });
  const queryClient = useQueryClient();
  const completed = useCreateAiCompletion();
  const extraction = useExtractAiAttachment();
  const tokenCallback = useRef<(id: string, text: string) => void>(() => undefined);
  const streamMutation = useStreamAiCompletion({
    mutation: {
      mutationFn: async ({ data }) => {
        const controller = new AbortController();
        abortRef.current = controller;
        let result = '';
        const response = await fetch('/api/ai/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, credentials: 'include', body: JSON.stringify(data), signal: controller.signal });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body || `Request failed (${response.status})`);
        }
        if (!response.body) throw new Error('Streaming is not available in this browser.');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const processEvent = (raw: string) => {
          const payload = raw.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
          if (!payload) return;
          let event: { content?: string; done?: boolean; remainingToday?: number; error?: string };
          try { event = JSON.parse(payload); } catch { return; }
          if (event.error) throw new Error(event.error);
          if (typeof event.content === 'string') { result += event.content; tokenCallback.current(streamingIdRef.current, result); }
          if (event.done && typeof event.remainingToday === 'number') {
            const current = activeRef.current;
            if (current) queryClient.setQueryData(getGetAiStatusQueryKey({ sessionId }), (old: AiStatus | undefined) => old ? { ...old, remainingToday: event.remainingToday! } : old);
          }
        };
        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n');
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) { const raw = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); processEvent(raw); boundary = buffer.indexOf('\n\n'); }
          if (done) break;
        }
        if (buffer.trim()) processEvent(buffer);
        return result;
      },
      onError: (error) => {
        const targetId = streamingIdRef.current;
        setConversations((items) => items.map((item) => item.id === targetId ? { ...item, messages: item.messages.filter((msg) => !(msg.role === 'assistant' && !msg.content)) } : item));
        if ((error as Error).name !== 'AbortError') setLocalError((error as Error).message || 'SPPY could not complete that request. Try again.');
      },
      onSuccess: (text) => {
        const targetId = streamingIdRef.current;
        setConversations((items) => items.map((item) => item.id === targetId ? { ...item, messages: item.messages.map((msg) => msg.role === 'assistant' && msg.content === '' ? { ...msg, content: text } : msg), updatedAt: new Date().toISOString() } : item));
      },
      onSettled: () => { abortRef.current = null; streamingIdRef.current = ''; queryClient.invalidateQueries({ queryKey: getGetAiStatusQueryKey({ sessionId }) }); },
    },
  });
  const isStreaming = streamMutation.isPending;
  tokenCallback.current = (id, text) => {
    if (!id) return;
    setConversations((items) => items.map((item) => item.id === id ? { ...item, messages: item.messages.map((msg) => msg.role === 'assistant' && msg.content === '' ? { ...msg, content: text } : msg), updatedAt: new Date().toISOString() } : item));
  };
  const queryMode = new URLSearchParams(window.location.search).get('mode');
  const queryPrompt = new URLSearchParams(window.location.search).get('prompt');
  useEffect(() => {
    setDraft(queryPrompt || '');
    setAttachments([]);
    setLocalError('');
    setModeDraft(active?.mode || (modes.some((item) => item.id === queryMode) ? queryMode as Mode : 'general'));
    if (queryPrompt) requestAnimationFrame(() => inputRef.current?.focus());
  }, [requestedId, active?.mode, queryMode, queryPrompt]);
  useEffect(() => { if (active?.messages.length) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [active?.messages.length, active?.messages.at(-1)?.content]);
  const modify = useCallback((id: string, fn: (c: Conversation) => Conversation) => setConversations(conversations.map((c) => c.id === id ? fn(c) : c)), [conversations, setConversations]);
  const setMode = (mode: Mode) => {
    setModeDraft(mode);
    if (active) modify(active.id, (c) => ({ ...c, mode, updatedAt: new Date().toISOString() }));
  };
  const send = async (event?: FormEvent, override?: string) => {
    event?.preventDefault();
    const text = (override ?? draft).trim();
    if ((!text && !attachments.length) || isStreaming) return;
    if (statusLoading) { setLocalError('Checking AI availability. Try again in a moment.'); return; }
    if (status?.configured === false) { setLocalError(`AI is not configured${status.provider ? ` for ${status.provider}` : ''}. Please try again later.`); return; }
    if (status?.remainingToday === 0) { setLocalError('Today’s usage limit has been reached. Please come back later.'); return; }
    if (statusError) { setLocalError('SPPY could not check AI availability. Try again in a moment.'); return; }
    setLocalError('');
    let conversation = active;
    if (!conversation) { conversation = makeConversation(modeDraft); setConversations([conversation, ...conversations].slice(0, 40)); setLocation(`/chat/${conversation.id}`); }
    const userText = text || 'Please review the attached file.';
    const attachmentContext = attachments.length ? '\n\nAttached material:\n' + attachments.map((file) => `--- ${file.filename}${file.truncated ? ' (truncated)' : ''} ---\n${file.text}`).join('\n\n') : '';
    const messageText = userText + attachmentContext;
    if (messageText.length > 12000) { setLocalError('This message is too long. Shorten the attached text or split it into smaller messages.'); return; }
    const userMessage: Message = { id: makeId(), role: 'user', content: userText, createdAt: new Date().toISOString(), attachments: attachments.slice() };
    const assistantMessage: Message = { id: makeId(), role: 'assistant', content: '', createdAt: new Date().toISOString() };
    const mode = conversation.mode || modeDraft;
    const recent: ChatTurn[] = conversation.messages.slice(-20).map(({ role, content }) => ({ role, content: content.slice(0, 24000) }));
    const updated: Conversation = { ...conversation, title: conversation.messages.length ? conversation.title : shorten(text || attachments[0]?.filename || 'File review'), mode, updatedAt: new Date().toISOString(), messages: [...conversation.messages, userMessage, assistantMessage].slice(-20) };
    activeRef.current = updated;
    streamingIdRef.current = conversation.id;
    setConversations([updated, ...conversations.filter((c) => c.id !== conversation!.id)].slice(0, 40));
    setDraft(''); setAttachments([]);
    const input: { sessionId: string; mode: Mode; message: string; history: ChatTurn[] } = { sessionId, mode, message: messageText, history: recent };
    streamMutation.mutate({ data: input });
  };
  const regenerate = () => {
    if (!active || isStreaming || completed.isPending) return;
    const messages = active.messages.slice();
    const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user');
    if (lastUserIndex < 0) return;
    const user = messages[lastUserIndex];
    const history: ChatTurn[] = messages.slice(0, lastUserIndex).slice(-20).map(({ role, content }) => ({ role, content }));
    const attachmentContext = user.attachments?.length ? '\n\nAttached material:\n' + user.attachments.map((file) => `--- ${file.filename}${file.truncated ? ' (truncated)' : ''} ---\n${file.text}`).join('\n\n') : '';
    const input = { sessionId, mode: active.mode, message: user.content + attachmentContext, history };
    const assistant: Message = { id: makeId(), role: 'assistant', content: '', createdAt: new Date().toISOString() };
    const replacement: Conversation = { ...active, messages: [...active.messages.slice(0, lastUserIndex + 1), assistant], updatedAt: new Date().toISOString() };
    activeRef.current = replacement;
    setConversations(conversations.map((c) => c.id === active.id ? replacement : c));
    completed.mutate({ data: input }, {
      onSuccess: (response) => setConversations((items) => items.map((c) => c.id === active.id ? { ...c, messages: c.messages.map((m) => m.id === assistant.id ? { ...m, content: response.text } : m), updatedAt: new Date().toISOString() } : c)),
      onError: (error) => { setConversations((items) => items.map((c) => c.id === active.id ? { ...c, messages: c.messages.filter((m) => m.id !== assistant.id) } : c)); setLocalError((error as Error).message || 'SPPY could not regenerate that response.'); },
    });
  };
  const stop = () => { abortRef.current?.abort(); abortRef.current = null; };
  const upload = async (file?: File) => {
    if (!file) return;
    setLocalError('');
    try {
      const result = await extraction.mutateAsync({ data: { file } });
      setAttachments((items) => [...items, result].slice(0, 4));
      setNotice(`${result.filename} is ready to use`);
    } catch (error) { setLocalError((error as Error).message || 'This file could not be read.'); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setNotice('Copied to clipboard'); } catch { setNotice('Clipboard access is unavailable'); } };
  const disabled = isStreaming || extraction.isPending || statusLoading || statusError || status?.configured === false || status?.remainingToday === 0;
  const modeForEmpty = active?.mode || modeDraft;
  const selectedMode = modes.find((m) => m.id === modeForEmpty)!;
  const statusText = statusLoading ? 'Checking availability' : statusError ? 'Status unavailable' : status?.configured === false ? 'AI provider not configured' : status ? `${status.remainingToday} of ${status.dailyLimit} left · ${status.provider}${status.model ? ` / ${status.model}` : ''}` : 'AI status unavailable';
  return <div className="flex h-dvh overflow-hidden bg-background" data-testid="chat-workspace">
    <Sidebar conversations={conversations} activeId={active?.id} onNew={onNew} onRename={onRename} onDelete={onDelete} onClear={onClear} onOpenSettings={onSettings} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-border/70 px-3 md:px-6">
        <div className="flex items-center gap-2"><button onClick={() => setMobileOpen(true)} className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary lg:hidden" aria-label="Open sidebar" data-testid="button-open-sidebar"><Menu size={17} /></button><span className="hidden text-xs text-muted-foreground md:block">SPPY workspace</span><span className="hidden text-border md:block">/</span><ModeMenu mode={modeForEmpty} onChange={setMode} /></div>
        <div className="flex items-center gap-2"><span className={`hidden items-center gap-1.5 text-[10px] sm:flex ${healthError ? 'text-muted-foreground' : 'text-muted-foreground'}`} title={healthError ? 'Unable to reach the service' : `Service ${health?.status || 'available'}`} data-testid="status-health"><span className={`h-1.5 w-1.5 rounded-full ${healthError ? 'bg-destructive' : health ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />{healthError ? 'Connection issue' : 'Service ready'}</span><button onClick={toggleTheme} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary" aria-label="Toggle theme" data-testid="button-chat-theme">{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button><button onClick={onSettings} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary" aria-label="Settings" data-testid="button-chat-settings"><Settings2 size={15} /></button></div>
      </header>
      {!statusLoading && status?.configured === false && <div className="flex items-center gap-3 border-b border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-muted-foreground md:px-8" role="status" data-testid="status-provider-not-configured"><WifiOff size={14} className="shrink-0 text-primary" /><span><strong className="text-foreground">AI is not configured.</strong> SPPY is ready, but its AI provider has not been connected yet.</span></div>}
      {active && active.messages.length > 0 ? <>
        <div ref={scrollRef} className="scrollbar-thin flex-1 overflow-y-auto px-4 py-6 md:px-8" data-testid="list-chat-messages"><div className="mx-auto flex max-w-[800px] flex-col gap-8 pb-8">{active.messages.map((message, index) => <MessageBody key={message.id} message={message} onCopy={copy} onRegenerate={regenerate} lastAssistant={message.role === 'assistant' && index === active.messages.length - 1} streaming={isStreaming && index === active.messages.length - 1} voiceEnabled={voiceEnabled} voiceRate={voiceRate} voiceName={voiceName} />)}</div></div>
      </> : <div className="scrollbar-thin flex flex-1 items-center justify-center overflow-y-auto px-5 py-8" data-testid="empty-chat"><div className="fade-in w-full max-w-[680px]"><div className="mb-6 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-2xl border border-primary/25 bg-accent text-accent-foreground"><Sparkles size={18} /></div><div><p className="display text-xl font-bold tracking-tight">Start anywhere.</p><p className="text-xs text-muted-foreground">{selectedMode.description}</p></div></div><h1 className="display text-[clamp(2.4rem,7vw,4.4rem)] font-extrabold leading-[1.04] tracking-[-.075em]">What’s on your<br className="hidden sm:block" /> mind today?</h1><div className="mt-8 grid gap-2 sm:grid-cols-3">{examples[modeForEmpty].map((prompt, index) => <button key={prompt} onClick={() => send(undefined, prompt)} className="group min-h-[86px] rounded-xl border border-border bg-card/55 p-3.5 text-left text-xs leading-5 text-muted-foreground transition hover:border-primary/35 hover:bg-card hover:text-foreground" data-testid={`button-prompt-suggestion-${index}`}><span className="mb-2 block text-primary"><ArrowRight size={13} /></span>{prompt}</button>)}</div><p className="mt-5 text-center text-[10px] leading-5 text-muted-foreground">AI can make mistakes. Cyber safety mode is for education and defense—not real-world attack assistance.</p></div></div>}
      <div className="shrink-0 px-3 pb-3 pt-2 md:px-8 md:pb-5"><div className="mx-auto max-w-[800px]">
        {localError && <div className="mb-2 flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive" role="alert" data-testid="status-chat-error"><span>{localError}</span><button onClick={() => setLocalError('')} aria-label="Dismiss error" data-testid="button-dismiss-error"><X size={14} /></button></div>}
        {attachments.length > 0 && <div className="mb-2 flex flex-wrap gap-2" data-testid="list-attachments">{attachments.map((file, i) => <div key={`${file.filename}-${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px]"><FileText size={13} className="text-primary" /><span className="max-w-40 truncate">{file.filename}</span>{file.truncated && <span className="text-muted-foreground">trimmed</span>}<button onClick={() => setAttachments((items) => items.filter((_, index) => i !== index))} aria-label={`Remove ${file.filename}`} data-testid={`button-remove-attachment-${i}`}><X size={12} /></button></div>)}</div>}
        <form onSubmit={(e) => send(e)} className="rounded-2xl border border-border bg-card/90 shadow-[0_8px_35px_rgba(0,0,0,.12)] focus-within:border-primary/35" data-testid="form-chat-input">
          <textarea ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={status?.configured === false ? 'AI is not available yet' : 'Message SPPY…'} rows={2} disabled={status?.configured === false} className="max-h-40 min-h-[54px] w-full resize-none bg-transparent px-4 pt-4 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-60 md:px-5" data-testid="input-chat-message" />
          <div className="flex items-center justify-between px-2.5 pb-2.5 pl-3 md:px-3"><div className="flex items-center gap-1"><label className={`grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground ${extraction.isPending ? 'pointer-events-none opacity-50' : ''}`} title="Attach a file"><input type="file" className="hidden" accept=".txt,.md,.csv,.json,.pdf" onChange={(e) => { void upload(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} data-testid="input-attachment" /><ImagePlus size={16} /></label><VoiceInputControls value={draft} onChange={setDraft} /><span className="hidden text-[10px] text-muted-foreground sm:block">Files are processed temporarily for this chat.</span></div>
            <div className="flex items-center gap-2"><span className="hidden text-[10px] text-muted-foreground sm:block" data-testid="text-usage-status">{statusText}</span>{isStreaming ? <button type="button" onClick={stop} className="flex h-9 items-center gap-2 rounded-xl border border-border px-3 text-xs hover:bg-secondary" data-testid="button-stop-generation"><Square size={13} />Stop</button> : <button type="submit" disabled={disabled || completed.isPending || (!draft.trim() && !attachments.length)} className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Send message" data-testid="button-send-message">{streamMutation.isPending || extraction.isPending || completed.isPending ? <LoaderCircle className="animate-spin" size={15} /> : <Send size={15} />}</button>}</div>
          </div>
        </form>
        <div className="mt-2 flex items-center justify-between px-1 text-[9px] text-muted-foreground"><span>{modeForEmpty === 'research' ? 'Research mode reasons from model knowledge; it does not browse the web.' : modeForEmpty === 'cyber' ? 'Education and defense only. No real-world attack assistance.' : 'No account required · conversation saved on this device'}</span><span className="mono">SPPY · {selectedMode.name.toUpperCase()}</span></div>
      </div></div>
    </main>
  </div>;
}

function TextPage({ title, eyebrow, children, theme, toggleTheme }: { title: string; eyebrow: string; children: ReactNode; theme: Theme; toggleTheme: () => void }) {
  return <div className="app-shell"><SiteHeader theme={theme} toggleTheme={toggleTheme} /><main className="mx-auto min-h-[60vh] max-w-4xl px-6 py-16 md:py-24"><span className="mono text-[10px] tracking-[.2em] text-primary">{eyebrow}</span><h1 className="display mt-4 text-5xl font-extrabold tracking-[-.065em] md:text-7xl">{title}</h1><div className="mt-10 max-w-3xl space-y-6 text-sm leading-7 text-muted-foreground">{children}</div></main><Footer /></div>;
}
function ExplorePage({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  return <TextPage title="Find your mode." eyebrow="SPPY / EXPLORE" theme={theme} toggleTheme={toggleTheme}>
    <p className="max-w-xl text-base">A small set of useful starting points. Each mode shapes how SPPY approaches your prompt—not what you’re allowed to ask.</p>
    <div className="mt-8 grid gap-3 sm:grid-cols-2">{modes.map((mode) => { const Icon = mode.icon; return <Link href={`/chat?mode=${mode.id}`} className="group rounded-2xl border border-border bg-card/50 p-5 transition hover:border-primary/40" key={mode.id} data-testid={`card-explore-${mode.id}`}><div className="flex items-start justify-between"><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-accent-foreground"><Icon size={17} /></span><ArrowRight size={15} className="text-muted-foreground group-hover:text-primary" /></div><h2 className="display mt-7 text-lg font-bold text-foreground">{mode.name}</h2><p className="mt-1 text-xs leading-5">{mode.description}</p>{mode.id === 'research' && <p className="mt-3 rounded-lg bg-secondary px-3 py-2 text-[10px] leading-4">Research does not browse the web or retrieve live sources.</p>}{mode.id === 'cyber' && <p className="mt-3 rounded-lg bg-secondary px-3 py-2 text-[10px] leading-4">For learning and defense. Not for real-world attack assistance.</p>}</Link>; })}</div>
    <Link href="/motion-lab" className="group mt-4 flex flex-col justify-between gap-4 rounded-2xl border border-primary/25 bg-accent/25 p-5 transition hover:border-primary/45 sm:flex-row sm:items-center" data-testid="card-explore-motion-lab"><div><span className="mono text-[9px] tracking-[.16em] text-primary">SPPY MOTION LAB</span><h2 className="display mt-2 text-xl font-bold text-foreground">Your hands. Your movements. Your digital world.</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">Try local, browser-based hand tracking. Camera access stays off until you enable it.</p></div><span className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-primary">Open Motion Lab <ArrowRight size={14} className="transition group-hover:translate-x-1" /></span></Link>
  </TextPage>;
}
function AboutPage({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  return <TextPage title="Independent by design." eyebrow="ABOUT SPPY" theme={theme} toggleTheme={toggleTheme}>
    <div className="flex items-center gap-5 rounded-2xl border border-border bg-card/50 p-5">
      <img src="/assets/sppyntex-logo.jpg" className="h-20 w-20 rounded-xl object-contain" alt="SPPyntex logo" data-testid="img-about-logo" />
      <div><p className="display text-xl font-bold text-foreground">SPPY</p><p className="mt-1 text-xs">Official AI by SPPyntex</p></div>
    </div>
    <p className="text-base text-foreground">SPPY is a public AI workspace for people who want to learn, create, code, explore ideas, and get everyday help—without an account.</p>
    <section className="rounded-2xl border border-border bg-card/50 p-6" data-testid="creator-profile">
      <span className="mono text-[9px] tracking-[.18em] text-primary">CREATOR</span>
      <h2 className="display mt-3 text-2xl font-bold text-foreground">Safal Panta</h2>
      <p className="mt-1 text-sm text-foreground">Founder &amp; Developer of SPPyntex</p>
      <p className="mt-4 text-sm leading-6">Building projects around cybersecurity, artificial intelligence, programming, and technology.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a href="https://www.linkedin.com/in/safal-panta-a69958415/" target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border px-3.5 py-2 text-xs font-semibold text-foreground transition hover:border-primary/50 hover:text-primary" data-testid="link-creator-linkedin">LinkedIn</a>
        <a href="https://github.com/safalpanta916-crypto" target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border px-3.5 py-2 text-xs font-semibold text-foreground transition hover:border-primary/50 hover:text-primary" data-testid="link-creator-github">GitHub</a>
      </div>
    </section>
    <p>Guest conversations are kept in your browser and are not stored as conversation history on the server. AI requests are sent to the configured provider to generate responses. See the <Link href="/privacy" className="text-primary underline underline-offset-4" data-testid="link-about-privacy">privacy notice</Link> for more.</p>
    <div className="rounded-xl border-l-2 border-primary bg-card/60 p-5"><p className="display text-lg font-semibold text-foreground">“Data is Power, Stay Anonymous.”</p><p className="mt-2 text-xs">SPPyntex</p></div>
    <p>SPPY is a tool, not an authority. Check important information, especially in health, legal, financial, and security contexts.</p>
  </TextPage>;
}
function ProjectsPage({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const projects = [
    { name: 'SPPyntex Cyber Lab', category: 'Cybersecurity learning', description: 'An interactive cybersecurity learning project.', href: 'https://sppyntex.netlify.app/' },
    { name: 'SPPyntex Security Laboratory', category: 'Security laboratory', description: 'A cybersecurity learning and security laboratory project.', href: 'https://sppyntexsecurity.netlify.app/' },
    { name: 'Starfall Protocol', category: 'Gaming', description: 'An interactive gaming experience developed under SPPyntex.', href: 'https://spp-star.netlify.app/' },
  ];
  return <TextPage title="Explore the SPPyntex Ecosystem" eyebrow="SPPYNTEX / PROJECTS" theme={theme} toggleTheme={toggleTheme}>
    <div className="space-y-3" data-testid="list-projects">{projects.map((project, i) =>
      <a href={project.href} target="_blank" rel="noopener noreferrer" key={project.name} className="group flex flex-col justify-between gap-5 rounded-2xl border border-border bg-card/50 p-5 transition hover:border-primary/40 sm:flex-row sm:items-center md:p-7" data-testid={`card-project-${i}`}>
        <div className="flex items-start gap-4"><span className="mono mt-1 text-[10px] text-primary">0{i + 1}</span><div><span className="mono text-[9px] tracking-[.16em] text-muted-foreground">{project.category}</span><h2 className="display mt-1 text-2xl font-bold text-foreground">{project.name}</h2><p className="mt-2 max-w-xl text-xs leading-5">{project.description}</p></div></div>
        <span className="flex items-center gap-2 text-xs text-primary">Open project <ArrowRight size={14} className="transition group-hover:translate-x-1" /></span>
      </a>
    )}</div>
  </TextPage>;
}
function PolicyPage({ kind, theme, toggleTheme }: { kind: 'privacy' | 'terms'; theme: Theme; toggleTheme: () => void }) {
  const privacy = kind === 'privacy';
  return <TextPage title={privacy ? 'Privacy, plainly.' : 'Terms of use.'} eyebrow={privacy ? 'SPPY / PRIVACY' : 'SPPY / TERMS'} theme={theme} toggleTheme={toggleTheme}>
    <p className="text-xs">Last updated: 2025</p>
    {privacy ? <>
      <section><h2 className="display mb-2 text-xl font-bold text-foreground">Guest workspace</h2><p>SPPY does not require an account. Conversation history and preferences are stored in local browser storage on this device. They are not saved to a conversation history on the SPPY server. Anyone with access to this browser profile may be able to view or clear that local data. Use Settings to clear your history.</p></section>
      <section><h2 className="display mb-2 text-xl font-bold text-foreground">AI requests</h2><p>When you send a prompt or upload a file, that content is sent to the SPPY service and configured AI provider to process your request. Attachments are submitted to the temporary extraction endpoint; extracted text is used in your current request. Do not submit information you are not comfortable sharing with the configured provider.</p></section>
      <section><h2 className="display mb-2 text-xl font-bold text-foreground">Motion Lab and voice</h2><p>The Motion Lab asks for camera permission only when you select Enable camera. Hand-tracking frames are processed locally in your browser and are not uploaded, recorded, or stored by SPPY. Optional voice input uses your browser’s speech recognition feature; depending on the browser, audio may be processed by its speech service. Optional response speech uses browser speech synthesis and plays only when you press Play. Voice text is sent to the AI provider only if you choose to submit it as a prompt.</p></section>
      <section><h2 className="display mb-2 text-xl font-bold text-foreground">Technical data</h2><p>The service may process request data needed to operate, secure, and rate-limit the platform. The specific provider, model, and usage allowance are shown in the workspace when available. SPPY does not claim that AI provider processing is end-to-end private.</p></section>
      <section><h2 className="display mb-2 text-xl font-bold text-foreground">Your choices</h2><p>You can avoid sending sensitive data, remove local conversations, or stop using the service at any time. Browser storage can also be cleared through your browser settings.</p></section>
    </> : <>
      <section><h2 className="display mb-2 text-xl font-bold text-foreground">Use responsibly</h2><p>SPPY is provided as an AI workspace for learning, creating, coding, defensive cybersecurity education, research, and everyday help. You are responsible for your prompts and how you use generated content.</p></section>
      <section><h2 className="display mb-2 text-xl font-bold text-foreground">Safety and accuracy</h2><p>AI output can be inaccurate or incomplete. Verify important information independently. Cyber mode is for education and defense, not real-world attacks, unauthorized access, or harm.</p></section>
      <section><h2 className="display mb-2 text-xl font-bold text-foreground">Availability</h2><p>SPPY may be unavailable, limited, or changed as the service evolves. No account, uptime, or particular response is guaranteed. Use is subject to applicable laws and third-party provider terms.</p></section>
      <section><h2 className="display mb-2 text-xl font-bold text-foreground">Ownership</h2><p>SPPY is the official AI by SPPyntex, created by Safal Panta. Do not misrepresent the service or use it to infringe others’ rights.</p></section>
    </>}
  </TextPage>;
}
function NotFoundPage({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  return <div className="app-shell"><SiteHeader theme={theme} toggleTheme={toggleTheme} /><main className="mx-auto flex min-h-[65vh] max-w-4xl flex-col items-start justify-center px-6"><span className="mono text-[10px] tracking-[.2em] text-primary">404 / NOT FOUND</span><h1 className="display mt-5 text-6xl font-extrabold tracking-[-.07em] md:text-8xl">Wrong turn.</h1><p className="mt-5 max-w-md text-sm leading-6 text-muted-foreground">That page isn’t here. Head back to the workspace and keep going.</p><Link href="/" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground" data-testid="link-404-home"><ArrowLeft size={15} />Back to SPPY</Link></main><Footer /></div>;
}

function WorkspaceApp() {
  const [location, setLocation] = useLocation();
  const [conversations, setConversations] = useState<Conversation[]>(readConversations);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [voicePreferences, setVoicePreferences] = useState<VoicePreferences>(readVoicePreferences);
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<null | { kind: 'delete' | 'clear'; item?: Conversation }>(null);
  const [renameItem, setRenameItem] = useState<Conversation | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const persistTimer = useRef<number | null>(null);
  const locationRef = useRef(location);
  locationRef.current = location;
  useEffect(() => {
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      let budget = 1_500_000;
      const bounded: Conversation[] = [];
      for (const conversation of conversations.slice(0, 25)) {
        const messages: Message[] = [];
        for (const message of conversation.messages.slice(-20).reverse()) {
          const content = message.content.slice(0, 7000);
          const files = message.attachments?.map((file) => ({ ...file, text: file.text.slice(0, 2500) }));
          const cost = content.length + (files?.reduce((total, file) => total + file.text.length, 0) || 0);
          if (cost > budget) break;
          budget -= cost;
          messages.push({ ...message, content, attachments: files });
        }
        bounded.push({ ...conversation, messages: messages.reverse() });
        if (budget <= 0) break;
      }
      try { localStorage.setItem(STORE_KEY, JSON.stringify(bounded)); } catch { /* Local history remains in this tab if browser storage is full. */ }
    }, 250);
    return () => { if (persistTimer.current) window.clearTimeout(persistTimer.current); };
  }, [conversations]);
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(PREF_KEY, JSON.stringify({
      theme,
      voiceEnabled: voicePreferences.enabled,
      voiceRate: voicePreferences.rate,
      voiceName: voicePreferences.voiceName,
    }));
  }, [theme, voicePreferences]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('[data-testid="input-search-conversations"]')?.focus(); } if (event.key === 'Escape') { setMobileOpen(false); setSettingsOpen(false); setConfirm(null); setRenameItem(null); } }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
  const toggleTheme = () => setTheme((value) => value === 'dark' ? 'light' : 'dark');
  const createNew = () => { setMobileOpen(false); setLocation('/chat'); };
  const rename = (item: Conversation, title: string) => { setConversations((items) => items.map((c) => c.id === item.id ? { ...c, title, updatedAt: new Date().toISOString() } : c)); setRenameItem(null); setNotice('Conversation renamed'); };
  const deleteConversation = (item: Conversation) => { setConversations((items) => items.filter((c) => c.id !== item.id)); if (locationRef.current === `/chat/${item.id}`) setLocation('/chat'); setConfirm(null); setNotice('Conversation deleted'); };
  const clearHistory = () => { setConversations([]); setLocation('/chat'); setConfirm(null); setSettingsOpen(false); setNotice('Local conversation history cleared'); };
  const common = { theme, toggleTheme };
  const chatVoiceProps = {
    voiceEnabled: voicePreferences.enabled,
    voiceRate: voicePreferences.rate,
    voiceName: voicePreferences.voiceName,
  };
  const openMotionHelp = (question: string) => setLocation(`/chat?mode=general&prompt=${encodeURIComponent(question)}`);
  return <div className="app-shell">
    <Switch>
      <Route path="/" component={() => <HomePage {...common} />} />
      <Route path="/chat" component={() => <ChatScreen {...common} {...chatVoiceProps} conversations={conversations} setConversations={setConversations} onNew={createNew} onRename={setRenameItem} onDelete={(item) => setConfirm({ kind: 'delete', item })} onClear={() => setConfirm({ kind: 'clear' })} onSettings={() => setSettingsOpen(true)} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} setNotice={setNotice} />} />
      <Route path="/chat/:conversationId" component={() => <ChatScreen {...common} {...chatVoiceProps} conversations={conversations} setConversations={setConversations} onNew={createNew} onRename={setRenameItem} onDelete={(item) => setConfirm({ kind: 'delete', item })} onClear={() => setConfirm({ kind: 'clear' })} onSettings={() => setSettingsOpen(true)} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} setNotice={setNotice} />} />
      <Route path="/explore" component={() => <ExplorePage {...common} />} />
      <Route path="/motion-lab" component={() => <div className="app-shell"><SiteHeader {...common} /><MotionLabPage {...common} onAskSppy={openMotionHelp} /><Footer /></div>} />
      <Route path="/about" component={() => <AboutPage {...common} />} />
      <Route path="/projects" component={() => <ProjectsPage {...common} />} />
      <Route path="/privacy" component={() => <PolicyPage {...common} kind="privacy" />} />
      <Route path="/terms" component={() => <PolicyPage {...common} kind="terms" />} />
      <Route component={() => <NotFoundPage {...common} />} />
    </Switch>
    {confirm?.kind === 'delete' && confirm.item && <Confirmation title="Delete this conversation?" detail="This removes the conversation from this browser. This cannot be undone." confirmText="Delete conversation" danger onCancel={() => setConfirm(null)} onConfirm={() => deleteConversation(confirm.item!)} />}
    {confirm?.kind === 'clear' && <Confirmation title="Clear all conversations?" detail="Every saved conversation in this browser will be permanently removed. This cannot be undone." confirmText="Clear history" danger onCancel={() => setConfirm(null)} onConfirm={clearHistory} />}
    {renameItem && <RenameDialog item={renameItem} onSave={(value) => rename(renameItem, value)} onCancel={() => setRenameItem(null)} />}
    {settingsOpen && <SettingsDialog theme={theme} toggleTheme={toggleTheme} onClear={() => { setSettingsOpen(false); setConfirm({ kind: 'clear' }); }} onClose={() => setSettingsOpen(false)} voiceEnabled={voicePreferences.enabled} onVoiceEnabledChange={(enabled) => setVoicePreferences((current) => ({ ...current, enabled }))} voiceRate={voicePreferences.rate} onVoiceRateChange={(rate) => setVoicePreferences((current) => ({ ...current, rate }))} voiceName={voicePreferences.voiceName} onVoiceNameChange={(voiceName) => setVoicePreferences((current) => ({ ...current, voiceName }))} />}
    <Toast notice={notice} onClose={() => setNotice('')} />
  </div>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><ErrorBoundary><WorkspaceApp /></ErrorBoundary></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
