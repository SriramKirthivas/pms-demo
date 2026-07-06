import AppLayout from "@/components/AppLayout";
import { useEffect, useState } from "react";
import { MessageSquarePlus, Send, ThumbsUp, Wrench, MessageSquare, Shield } from "lucide-react";
import { toast } from "sonner";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { pmEval, pmGoal } from "@/lib/pmApi";

interface FeedbackItem {
  id: string; author: string; authorEmail: string; subject: string; body: string;
  sentiment: "positive" | "constructive" | "neutral"; status: "pending" | "released" | "archived";
  managerNote: string; createdAt: string; releasedAt: string | null;
}
interface DirEntry { name: string; title: string; avatar: string; dept: string; }

const SENTIMENTS = [
  { key: "positive", label: "Praise", icon: ThumbsUp, tint: "#16a34a" },
  { key: "constructive", label: "Constructive", icon: Wrench, tint: "#f59e0b" },
  { key: "neutral", label: "Note", icon: MessageSquare, tint: "#0052cc" },
] as const;

// pm-eval's ContinuousFeedback has no moderation workflow (no status, no
// release/archive) — every entry is visible to its subject immediately. The
// UI's sentiment tags map to pm-eval's `category` enum on a best-effort basis
// since the two vocabularies don't line up one-to-one.
const CATEGORY_BY_SENTIMENT: Record<string, string> = {
  positive: "MOTIVATION",
  constructive: "IMPROVEMENT",
  neutral: "GENERAL",
};
const SENTIMENT_BY_CATEGORY: Record<string, FeedbackItem["sentiment"]> = {
  MOTIVATION: "positive", STRETCH: "positive",
  IMPROVEMENT: "constructive", ATTITUDE: "constructive",
  COMMUNICATION: "neutral", GENERAL: "neutral",
};

interface ContinuousFeedbackRsp {
  id: string; category: string; text: string; from: string; about: string; date: string;
}

function toFeedbackItem(f: ContinuousFeedbackRsp): FeedbackItem {
  return {
    id: f.id,
    author: f.from,
    authorEmail: "",
    subject: f.about,
    body: f.text,
    sentiment: SENTIMENT_BY_CATEGORY[f.category] ?? "neutral",
    status: "released", // pm-eval has no moderation queue — feedback is visible as soon as it's logged
    managerNote: "",
    createdAt: f.date,
    releasedAt: f.date,
  };
}

const sentimentMeta = (s: string) => SENTIMENTS.find((x) => x.key === s) ?? SENTIMENTS[2];
const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function SentimentTag({ sentiment }: { sentiment: string }) {
  const m = sentimentMeta(sentiment);
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold" style={{ background: `${m.tint}1a`, color: m.tint }}>
      <m.icon size={10} /> {m.label}
    </span>
  );
}

export default function FeedbackPage() {
  const { user } = useAuth();

  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [dir, setDir] = useState<DirEntry[]>([]);
  const [subject, setSubject] = useState("");
  const [sentiment, setSentiment] = useState<string>("positive");
  const [body, setBody] = useState("");

  const load = () => {
    // pm-eval has no single "all feedback across the org" listing — the
    // dashboard views below are assembled from "about me" + "authored by me".
    // NOTE: GET /feedback (paginated PageRspVO {list, total, ...}) and
    // GET /feedback/mine (bare array) have DIFFERENT response shapes.
    Promise.all([
      pmEval.get<{ list: ContinuousFeedbackRsp[] }>(`/feedback?aboutEmployeeId=${encodeURIComponent(user.name)}&pageSize=200`)
        .then((r) => r.list).catch(() => [] as ContinuousFeedbackRsp[]),
      pmEval.get<ContinuousFeedbackRsp[]>("/feedback/mine").catch(() => [] as ContinuousFeedbackRsp[]),
    ]).then(([about, mine]) => {
      const byId = new Map<string, FeedbackItem>();
      for (const f of [...about, ...mine]) byId.set(f.id, toFeedbackItem(f));
      setItems(Array.from(byId.values()));
    });
  };
  useEffect(() => {
    load();
    // Colleague picker sourced from pm-goal's employee directory (UAM stub).
    pmGoal.get<{ id: string; title: string; department: string }[]>("/people")
      .then((rows) => setDir(rows.map((r) => ({ name: r.id, title: r.title, avatar: "", dept: r.department }))))
      .catch(() => setDir([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!subject) { toast.error("Choose who the feedback is for"); return; }
    if (!body.trim()) { toast.error("Write some feedback first"); return; }
    try {
      await pmEval.post("/feedback", {
        about: subject, text: body.trim(), category: CATEGORY_BY_SENTIMENT[sentiment] ?? "GENERAL",
      });
      toast.success("Feedback sent", { description: `Visible to ${subject} right away.` });
      setBody(""); setSubject(""); setSentiment("positive");
      load();
    } catch (err) { toast.error("Could not send", { description: (err as Error).message }); }
  };

  const aboutMe = items.filter((f) => f.subject === user.name);
  const sentByMe = items.filter((f) => f.author === user.name);

  return (
    <AppLayout pageTitle="Continuous Feedback" breadcrumb="Performance">
      <div className="max-w-3xl space-y-4">
        {/* Composer */}
        <div className="ff-card overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-[#e5e7eb] bg-[#f8fafc]">
            <MessageSquarePlus size={14} className="text-[#0052cc]" />
            <h2 className="text-[12px] font-semibold text-[#0f1b3d] uppercase tracking-wider">Give Feedback</h2>
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-400"><Shield size={11} /> Shared instantly</span>
          </div>
          <div className="p-5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr] gap-3">
              <div className="space-y-1.5">
                <Label>For</Label>
                <Select value={subject} onValueChange={setSubject}>
                  <SelectTrigger><SelectValue placeholder="Choose a colleague" /></SelectTrigger>
                  <SelectContent>
                    {dir.filter((d) => d.name !== user.name).map((d) => (
                      <SelectItem key={d.name} value={d.name}>{d.name} · {d.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={sentiment} onValueChange={setSentiment}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SENTIMENTS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fb-body">Feedback</Label>
              <textarea id="fb-body" rows={3} value={body} onChange={(e) => setBody(e.target.value.slice(0, 2000))}
                placeholder="Share something specific and helpful…"
                className="w-full px-3 py-2 text-[13px] border border-input rounded-[4px] bg-background text-[#16203b] focus:outline-none focus:border-[#0052cc] focus:ring-1 focus:ring-[#0052cc]/20 resize-none" />
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-gray-400">Visible to them right away — pm-eval has no moderation step.</p>
                <Button onClick={submit} className="bg-[#0052cc] hover:bg-[#003d99] gap-1.5"><Send size={13} /> Send</Button>
              </div>
            </div>
          </div>
        </div>

        {/* Feedback about me (released) */}
        <div className="ff-card overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-[#e5e7eb] bg-[#f8fafc]">
            <MessageSquare size={14} className="text-[#0052cc]" />
            <h2 className="text-[12px] font-semibold text-[#0f1b3d] uppercase tracking-wider">Feedback For Me</h2>
            <span className="ml-auto text-[11px] text-gray-400">{aboutMe.length} shared</span>
          </div>
          {aboutMe.length === 0 ? (
            <div className="px-5 py-8 text-center text-[12px] text-gray-400">No feedback has been shared with you yet.</div>
          ) : (
            <div className="divide-y divide-[#f0f1f4]">
              {aboutMe.map((f) => (
                <div key={f.id} className="px-5 py-3.5">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <SentimentTag sentiment={f.sentiment} />
                    <span className="text-[12px] font-semibold text-[#16203b]">{f.author}</span>
                    <span className="ml-auto text-[10px] text-gray-400">{fmt(f.releasedAt ?? f.createdAt)}</span>
                  </div>
                  <p className="text-[13px] text-[#16203b] leading-snug">{f.body}</p>
                  {f.managerNote && <p className="text-[11px] text-gray-500 italic mt-1.5 pl-2 border-l-2 border-[#e5e7eb]">Manager note: {f.managerNote}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sent by me */}
        <div className="ff-card overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-[#e5e7eb] bg-[#f8fafc]">
            <Send size={13} className="text-[#0052cc]" />
            <h2 className="text-[12px] font-semibold text-[#0f1b3d] uppercase tracking-wider">Sent By Me</h2>
            <span className="ml-auto text-[11px] text-gray-400">{sentByMe.length} total</span>
          </div>
          {sentByMe.length === 0 ? (
            <div className="px-5 py-8 text-center text-[12px] text-gray-400">You haven't given any feedback yet.</div>
          ) : (
            <div className="divide-y divide-[#f0f1f4]">
              {sentByMe.map((f) => (
                <div key={f.id} className="px-5 py-3.5">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <SentimentTag sentiment={f.sentiment} />
                    <span className="text-[12px] text-gray-500">To <span className="font-semibold text-[#16203b]">{f.subject}</span></span>
                    <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">
                      Shared
                    </span>
                  </div>
                  <p className="text-[13px] text-[#16203b] leading-snug">{f.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
