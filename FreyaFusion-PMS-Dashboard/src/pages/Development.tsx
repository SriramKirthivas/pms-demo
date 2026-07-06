import AppLayout from "@/components/AppLayout";
import { useEffect, useState } from "react";
import { BookOpen, Award, ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { api } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FALLBACK_AVATAR } from "@/lib/avatar";
import { useAuth } from "@/context/AuthContext";

interface Course {
  title: string;
  done: boolean;
}

interface Plan {
  name: string;
  avatar: string;
  role: string;
  skills: string[];
  progress: number;
  courses: number;
  nextReview: string;
  courseList: Course[];
}

export default function Development() {
  const { user, role } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [active, setActive] = useState<Plan | null>(null);

  useEffect(() => {
    api.get<Plan[]>("/development").then(setPlans).catch(() => setPlans([]));
  }, []);

  // Employees only see their own development plan.
  const visiblePlans = role === "employee" ? plans.filter((p) => p.name === user.name) : plans;
  const pageTitle = role === "employee" ? "My Development" : "Development Plans";

  return (
    <AppLayout pageTitle={pageTitle} breadcrumb="Talent">
      {visiblePlans.length === 0 ? (
        <div className="ff-card px-5 py-10 text-center text-[13px] text-gray-400">
          No development plan has been set up for your account yet.
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {visiblePlans.map((p) => (
          <div key={p.name} className="ff-card p-5">
            <div className="flex items-center gap-3 mb-4">
              <img
                src={p.avatar}
                alt={p.name}
                className="w-9 h-9 rounded-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_AVATAR; }}
              />
              <div>
                <p className="text-[13px] font-semibold text-[#0f1b3d]">{p.name}</p>
                <p className="text-[11px] text-gray-400">{p.role}</p>
              </div>
            </div>

            <div className="mb-3">
              <div className="flex justify-between mb-1">
                <span className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">Plan Progress</span>
                <span className="text-[12px] font-semibold text-[#0f1b3d]">{p.progress}%</span>
              </div>
              <div className="ff-progress">
                <div className="ff-progress-fill" style={{ width: `${p.progress}%` }} />
              </div>
            </div>

            <div className="mb-3">
              <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wider mb-2">Focus Areas</p>
              <div className="flex flex-wrap gap-1.5">
                {p.skills.map((s) => (
                  <span key={s} className="px-2 py-0.5 bg-[#e6eefa] text-[#0f1b3d] text-[11px] font-medium rounded-full">
                    {s}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-[#e5e7eb]">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <BookOpen size={11} />
                <span>{p.courses} active courses</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <Award size={11} />
                <span>Next review: {p.nextReview}</span>
              </div>
            </div>

            <button
              onClick={() => setActive(p)}
              className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium text-[#0052cc] border border-[#0052cc]/30 rounded-[5px] hover:bg-[#0052cc]/5 transition-colors"
            >
              View Plan <ArrowRight size={11} />
            </button>
          </div>
        ))}
      </div>
      )}

      {/* Plan detail dialog */}
      <Dialog open={!!active} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent className="sm:max-w-[480px]">
          {active && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <img
                    src={active.avatar}
                    alt={active.name}
                    className="w-10 h-10 rounded-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_AVATAR; }}
                  />
                  <div>
                    <DialogTitle>{active.name}</DialogTitle>
                    <DialogDescription>{active.role} · Next review {active.nextReview}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4 py-1">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">Overall Progress</span>
                    <span className="text-[12px] font-semibold text-[#0f1b3d]">{active.progress}%</span>
                  </div>
                  <div className="ff-progress">
                    <div className="ff-progress-fill" style={{ width: `${active.progress}%` }} />
                  </div>
                </div>

                <div>
                  <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wider mb-2">Focus Areas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {active.skills.map((s) => (
                      <span key={s} className="px-2 py-0.5 bg-[#e6eefa] text-[#0f1b3d] text-[11px] font-medium rounded-full">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wider mb-2">Courses</p>
                  <ul className="space-y-1.5">
                    {active.courseList.map((c) => (
                      <li key={c.title} className="flex items-center gap-2 text-[13px]">
                        {c.done ? (
                          <CheckCircle2 size={14} className="text-green-600 flex-shrink-0" />
                        ) : (
                          <Circle size={14} className="text-gray-300 flex-shrink-0" />
                        )}
                        <span className={c.done ? "text-gray-400 line-through" : "text-[#0f1b3d]"}>{c.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
