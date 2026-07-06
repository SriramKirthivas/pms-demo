"""Pydantic request/response models for pm-goal."""

from pydantic import BaseModel


class FrameworkCreate(BaseModel):
    fiscalYear: str
    activeCadences: list[str] = ["QUARTERLY", "ANNUAL"]
    teamWeightPct: int = 60
    individualWeightPct: int = 40


class PeriodOut(BaseModel):
    id: str
    code: str
    cadence: str
    label: str
    window: str
    locked: bool


class FrameworkOut(BaseModel):
    id: str
    fiscalYear: str
    activeCadences: list[str]
    teamWeightPct: int
    individualWeightPct: int
    periods: list[PeriodOut]


class GoalCreate(BaseModel):
    fiscalYear: str
    pillar: str  # TEAM_GOAL | INDIVIDUAL_CONTRIBUTION | TRAININGS_AND_CERTS
    cadence: str = "QUARTERLY"
    goalType: str = "OKR"  # OKR | KPI
    measure: str
    description: str = ""
    baseCriteria: str = ""
    defaultWeight: int = 5
    competencies: list[str] = []


class GoalUpdate(BaseModel):
    measure: str | None = None
    description: str | None = None
    baseCriteria: str | None = None
    defaultWeight: int | None = None
    goalType: str | None = None
    competencies: list[str] | None = None


class CascadeRequest(BaseModel):
    employeeIds: list[str | None]
    reviewerIds: list[str] | None = None


class RequestChange(BaseModel):
    tweakedCriteria: str | None = None
    weight: int | None = None


# --- Early completion (owner requests, manager approves) ---

class CompletionRequest(BaseModel):
    note: str = ""


class CompletionDecision(BaseModel):
    decision: str  # APPROVE | REJECT
    note: str | None = None


# --- Unlock approval chain ---

class UnlockRequestCreate(BaseModel):
    reason: str = ""


class UnlockDecision(BaseModel):
    decision: str  # APPROVE | REJECT
    reason: str | None = None


# --- Cross-service contracts (pm-eval / pm-score) ---

class RatedEvent(BaseModel):
    source: str  # SELF | REVIEWER
    ratedBy: str
    evaluatedAt: str


class AcknowledgeRequest(BaseModel):
    employeeId: str
    fiscalYear: int


# --- Mid-cycle reassignment / lifecycle ---

class ReassignRequest(BaseModel):
    newManagerId: str


class LifecycleRequest(BaseModel):
    eventType: str  # JOINER | LEAVER | REASSIGNMENT
    fiscalYear: str
    effectiveFromPeriodId: str | None = None
    goalIds: list[str] | None = None
    newManagerId: str | None = None


# --- Employee directory (UAM stub — see models.Employee) ---

class EmployeeUpsert(BaseModel):
    id: str  # display name — matches ownerId/employeeId convention elsewhere
    email: str = ""
    role: str = "employee"  # employee | manager | admin
    managerId: str = ""
    department: str = ""
    country: str = "IE"
    title: str = ""


# --- Tenant onboarding ---

class TenantOnboardingRequest(BaseModel):
    tenantId: str = "default"


class TenantOnboardingQuery(BaseModel):
    tenantId: str = "default"
