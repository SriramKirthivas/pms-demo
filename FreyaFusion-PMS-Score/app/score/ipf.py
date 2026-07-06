"""IPF math: section normalization -> quarterly/annual roll-up -> Final IPF ->
performance band.

Per the pm-scoring-talent spec:

  sectionScore = Sum(weight_i * rating_i) / 10   (weights of a section total 10,
                                                    ratings are 1-5)

  Final IPF (0-5.00) = team-goals contribution (max 3.00, 60%)
                      + individual-annual contribution (max 2.00, 40%)

  team-goals contribution = Sum over Q1..Q4 of:
      quarterContribution = (teamSectionScore * 0.10) + (individualSectionScore * 0.05)

  individual-annual contribution =
      (sectionA / 5) * 1.00      # Section A: TRAININGS_AND_CERTS (annual)
    + (sectionB / 5) * 1.00      # Section B: INDIVIDUAL_CONTRIBUTION (annual)

Both selfFinalIPF and managerFinalIPF are computed the same way, from the self
and manager rating streams respectively, each rounded to 2 decimal places.
"""

# (low, high, label, suggestedAction) — hardcoded fallback, used only when the
# tb_pm_performance_band table has no rows for the tenant (e.g. before
# onboarding has run, or in tests that don't seed it).
BANDS = [
    (4.5, 5.01, "Exceptional", "Recognition + Stretch Assignment"),
    (3.8, 4.5, "Exceeds Expectations", "Fast-track + Mentorship role"),
    (2.9, 3.8, "Meets Expectations", "Coaching + Skill expansion"),
    (2.1, 2.9, "Needs Improvement", "PIP with 90-day review"),
    (1.0, 2.1, "Unsatisfactory", "Formal PIP + HR review"),
]

QUARTERS = ("Q1", "Q2", "Q3", "Q4")
TEAM_QUARTER_WEIGHT = 0.10
INDIV_QUARTER_WEIGHT = 0.05
TEAM_GOALS_CAP = 3.00
INDIV_ANNUAL_CAP = 2.00
ANNUAL_SECTION_MAX = 1.00  # each of Section A / Section B contributes up to 1.00


class IPFError(ValueError):
    """Raised when the inputs cannot be normalized/computed per spec (e.g. a
    section's weights don't total 10, or required periods aren't final yet)."""


def section_score(goals: list[dict], stream: str) -> float | None:
    """sectionScore = Sum(weight_i * rating_i) / 10 for one section/stream.

    `goals`: [{weight, selfRating, managerRating}, ...] for the goals making up
    ONE section (one pillar within one period). `stream` is "self" or "manager".
    Weights of the section MUST total 10 (independent of the 1-5 rating scale).

    Returns None if there are no ratings at all for this stream (i.e. the
    section has no goals, or no rating has been recorded yet) — this is NOT
    an error, it just means the section is not yet computable (incomplete).

    Raises IPFError if the section has goals but their weights don't total 10.
    """
    if not goals:
        return None
    total_weight = sum(g.get("weight", 0) or 0 for g in goals)
    if total_weight != 10:
        raise IPFError(
            f"Section weights must total 10 (got {total_weight}) — "
            f"cannot normalize sectionScore"
        )
    rating_key = "selfRating" if stream == "self" else "managerRating"
    if any(g.get(rating_key) is None for g in goals):
        return None  # not all goals in this section have a final rating yet
    numerator = sum((g.get("weight", 0) or 0) * g[rating_key] for g in goals)
    return round(numerator / 10, 4)


def band_for(score: float, bands: list[tuple] | None = None) -> tuple[str, str]:
    """Resolve a score to (label, suggestedAction). `bands` — list of
    (low, high, label, action) tuples, e.g. loaded from tb_pm_performance_band;
    falls back to the hardcoded BANDS when not supplied/empty."""
    table = bands or BANDS
    for lo, hi, label, action in table:
        if lo <= score < hi:
            return label, action
    # Score below the lowest band's low bound, or above the top: clamp.
    if table:
        lo0 = min(b[0] for b in table)
        if score < lo0:
            lowest = min(table, key=lambda b: b[0])
            return lowest[2], lowest[3]
        highest = max(table, key=lambda b: b[0])
        return highest[2], highest[3]
    return "Unsatisfactory", BANDS[-1][3]


def performance_level(score: float) -> int:
    """9-box performance axis (1=Low, 2=Medium, 3=High) from the IPF band."""
    return 3 if score >= 3.8 else 2 if score >= 2.9 else 1


def compute_stream(
    quarters: dict[str, dict[str, list[dict]]],
    annual: dict[str, list[dict]],
    stream: str,
    participated_quarters: list[str] | None = None,
) -> dict:
    """Compute one stream's (self or manager) Final IPF plus its breakdown.

    quarters: {"Q1": {"team": [...goals], "individual": [...goals]}, ...}
    annual:   {"sectionA": [...goals], "sectionB": [...goals]}   (TRAININGS_AND_CERTS,
              INDIVIDUAL_CONTRIBUTION respectively)
    stream:   "self" | "manager"
    participated_quarters: for pro-rated (partial-year) computation, only these
        quarters count; caps/weights are normalized to the count of quarters
        actually participated in (out of 4) rather than leaving the others as
        silent zero.

    Returns {"finalIPF", "teamGoalsContribution", "individualAnnualContribution",
             "breakdown": [...]} or raises IPFError if inputs are incomplete.
    """
    active_quarters = participated_quarters or list(QUARTERS)
    if not active_quarters:
        raise IPFError("No participated quarters to compute team-goals contribution")

    # Normalize per-quarter weights so that N participated quarters out of 4
    # still sum to the full 3.00 cap (pro-ration).
    scale = len(QUARTERS) / len(active_quarters)
    team_w = TEAM_QUARTER_WEIGHT * scale
    indiv_w = INDIV_QUARTER_WEIGHT * scale

    team_total = 0.0
    breakdown: list[dict] = []
    for q in active_quarters:
        qdata = quarters.get(q, {})
        team_goals = qdata.get("team", [])
        indiv_goals = qdata.get("individual", [])
        team_score = section_score(team_goals, stream)
        indiv_score = section_score(indiv_goals, stream)
        if team_score is None or indiv_score is None:
            raise IPFError(
                f"{q}: missing final {stream} evaluation for TEAM_GOAL or "
                f"INDIVIDUAL_CONTRIBUTION section — cannot compute Final IPF yet"
            )
        contribution = round(team_score * team_w + indiv_score * indiv_w, 4)
        team_total += contribution
        breakdown.append({
            "period": q, "pillar": "TEAM_GOAL", "score": team_score,
            "contribution": round(team_score * team_w, 4),
        })
        breakdown.append({
            "period": q, "pillar": "INDIVIDUAL_CONTRIBUTION", "score": indiv_score,
            "contribution": round(indiv_score * indiv_w, 4),
        })
    team_total = min(round(team_total, 4), TEAM_GOALS_CAP)

    section_a = annual.get("sectionA", [])  # TRAININGS_AND_CERTS
    section_b = annual.get("sectionB", [])  # INDIVIDUAL_CONTRIBUTION (annual)
    score_a = section_score(section_a, stream)
    score_b = section_score(section_b, stream)
    if score_a is None or score_b is None:
        raise IPFError(
            f"Missing final {stream} evaluation for annual Section A "
            f"(TRAININGS_AND_CERTS) or Section B (INDIVIDUAL_CONTRIBUTION)"
        )
    contrib_a = round((score_a / 5) * ANNUAL_SECTION_MAX, 4)
    contrib_b = round((score_b / 5) * ANNUAL_SECTION_MAX, 4)
    indiv_annual_total = min(round(contrib_a + contrib_b, 4), INDIV_ANNUAL_CAP)
    breakdown.append({
        "period": "ANNUAL", "pillar": "TRAININGS_AND_CERTS", "score": score_a,
        "contribution": contrib_a,
    })
    breakdown.append({
        "period": "ANNUAL", "pillar": "INDIVIDUAL_CONTRIBUTION", "score": score_b,
        "contribution": contrib_b,
    })

    final_ipf = round(team_total + indiv_annual_total, 2)
    return {
        "finalIPF": final_ipf,
        "teamGoalsContribution": round(team_total, 2),
        "individualAnnualContribution": round(indiv_annual_total, 2),
        "breakdown": breakdown,
    }


def compute_final(
    quarters: dict[str, dict[str, list[dict]]],
    annual: dict[str, list[dict]],
    participated_quarters: list[str] | None = None,
    bands: list[tuple] | None = None,
) -> dict:
    """Compute both self and manager Final IPF streams + band + 9-box level.

    Raises IPFError if either stream's inputs are incomplete/invalid — callers
    should catch this and mark the scorecard incomplete rather than crashing.
    """
    self_result = compute_stream(quarters, annual, "self", participated_quarters)
    mgr_result = compute_stream(quarters, annual, "manager", participated_quarters)

    self_band, _ = band_for(self_result["finalIPF"], bands)
    mgr_band, mgr_action = band_for(mgr_result["finalIPF"], bands)
    return {
        "selfFinalIPF": self_result["finalIPF"],
        "managerFinalIPF": mgr_result["finalIPF"],
        "bandSelf": self_band,
        "bandManager": mgr_band,
        "suggestedAction": mgr_action,
        "performanceLevel": performance_level(mgr_result["finalIPF"]),
        "selfBreakdown": self_result["breakdown"],
        "managerBreakdown": mgr_result["breakdown"],
    }
