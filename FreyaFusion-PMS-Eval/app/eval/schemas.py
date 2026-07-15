from pydantic import BaseModel

FEEDBACK_CATEGORIES = {"MOTIVATION", "COMMUNICATION", "ATTITUDE", "STRETCH", "IMPROVEMENT", "GENERAL"}


class RatingInput(BaseModel):
    assignmentId: str
    employeeId: str  # the owner being rated
    rating: float
    comment: str = ""
    periodId: str = ""  # optional explicit override; otherwise resolved via pm-goal


class FeedbackCreate(BaseModel):
    aboutEmployeeId: str
    category: str = "GENERAL"
    text: str
    fiscalYear: str = ""
    # Optional: scope this feedback to a specific goal assignment (in-progress
    # goal). Omit/empty for general continuous feedback.
    assignmentId: str = ""


class FinalizeRequest(BaseModel):
    assignmentIds: list[str] = []
    periodCode: str = ""


class CheckInNoteCreate(BaseModel):
    employeeId: str
    periodId: str
    note: str
    fiscalYear: str = ""  # optional; resolved best-effort via pm-goal if omitted


class TenantOnboardingRequest(BaseModel):
    tenantId: str = "default"
