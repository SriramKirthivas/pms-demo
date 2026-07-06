from pydantic import BaseModel

QUARTERS = ["Q1", "Q2", "Q3", "Q4"]


class SectionInput(BaseModel):
    """Legacy/manual override shape: a single pre-aggregated section score.
    Still accepted by /scorecards/compute for tests and manual overrides, but
    the default path pulls goal-level data from pm-goal/pm-eval and applies
    ipf.section_score() per section per period."""

    ipfWeight: int
    selfScore: float | None = None
    managerScore: float | None = None


class ComputeRequest(BaseModel):
    employeeId: str
    fiscalYear: str
    sections: list[SectionInput] = []  # optional legacy override; if empty, pulled from pm-goal/pm-eval
    partialYear: bool = False
    participatedPeriods: list[str] = []  # e.g. ["Q3", "Q4"] when partialYear=True


class NineBoxRequest(BaseModel):
    employeeId: str
    fiscalYear: str
    potentialLevel: int
    department: str = ""


class DevPlanBuildRequest(BaseModel):
    employeeId: str
    fiscalYear: str
    reviewStage: str  # MID_YEAR | EOY


class DevPlanUpdate(BaseModel):
    keyStrengths: str | None = None
    improvementAreas: str | None = None
    nextFYPlan: str | None = None
    recommendedTrainings: str | None = None
    stretchAssignments: str | None = None
    mentorshipPlan: str | None = None
    careerMilestones: str | None = None


class CalibrationAdjustRequest(BaseModel):
    employeeId: str
    fiscalYear: str
    adjustedManagerFinalIPF: float
    reason: str


class TenantOnboardingRequest(BaseModel):
    tenantId: str = "default"


class TenantOnboardingQuery(BaseModel):
    tenantId: str = "default"
