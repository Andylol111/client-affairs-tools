"""
Outreach API - Pipeline, notes, activities, templates, sequences, profile analysis, sentiment
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from app.database import get_db, row_to_dict
from app.auth_deps import get_current_user, get_current_user_optional
from app.services.sentiment_analyzer import analyze_email_sentiment
from app.services.profile_analyzer import analyze_contact_profile

router = APIRouter()

# --- Models ---
class NoteCreate(BaseModel):
    contact_id: int
    note: str

class ActivityCreate(BaseModel):
    contact_id: int
    activity_type: str  # call, meeting, email_sent, replied, etc.
    details: Optional[str] = None

class TemplateCreate(BaseModel):
    name: str
    subject: str
    body: str
    industry: Optional[str] = None
    use_case: Optional[str] = None

class SequenceCreate(BaseModel):
    name: str
    steps: list[dict]  # [{days_after, subject, body}]

class PipelineUpdate(BaseModel):
    pipeline_status: str  # cold, contacted, replied, meeting, closed


class AssignOwner(BaseModel):
    owner_id: Optional[int] = None  # null to unassign

class SentimentAnalyzeRequest(BaseModel):
    subject: str
    body: str
    industry: Optional[str] = None
    target_role: Optional[str] = None


# --- Pipeline ---
@router.patch("/contacts/{contact_id}/owner")
async def assign_contact_owner(contact_id: int, payload: AssignOwner, user: dict = Depends(get_current_user)):
    """Assign contact to a team member (owner_id). For team collaboration."""
    db = await get_db()
    try:
        await db.execute(
            "UPDATE contacts SET owner_id = ? WHERE id = ?",
            (payload.owner_id, contact_id),
        )
        await db.commit()
        return {"ok": True, "owner_id": payload.owner_id}
    finally:
        await db.close()


@router.patch("/contacts/{contact_id}/pipeline")
async def update_contact_pipeline(contact_id: int, payload: PipelineUpdate, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE contacts SET pipeline_status = ? WHERE id = ?",
            (payload.pipeline_status, contact_id),
        )
        await db.commit()
        return {"ok": True, "pipeline_status": payload.pipeline_status}
    finally:
        await db.close()


# --- Notes ---
@router.get("/contacts/{contact_id}/notes")
async def list_contact_notes(contact_id: int, user: dict = Depends(get_current_user_optional)):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM contact_notes WHERE contact_id = ? ORDER BY created_at DESC",
            (contact_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


@router.post("/notes")
async def create_note(payload: NoteCreate, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO contact_notes (contact_id, user_id, note) VALUES (?, ?, ?)",
            (payload.contact_id, user.get("id"), payload.note),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "ok": True}
    finally:
        await db.close()


# --- Activities ---
@router.get("/contacts/{contact_id}/activities")
async def list_contact_activities(contact_id: int, user: dict = Depends(get_current_user_optional)):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM contact_activities WHERE contact_id = ? ORDER BY created_at DESC",
            (contact_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


@router.post("/activities")
async def create_activity(payload: ActivityCreate, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO contact_activities (contact_id, activity_type, details) VALUES (?, ?, ?)",
            (payload.contact_id, payload.activity_type, payload.details),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "ok": True}
    finally:
        await db.close()


# --- Templates ---
@router.get("/templates")
async def list_templates(industry: Optional[str] = None, user: dict = Depends(get_current_user_optional)):
    db = await get_db()
    try:
        if industry:
            cursor = await db.execute(
                "SELECT * FROM email_templates WHERE industry = ? OR industry IS NULL ORDER BY name",
                (industry,),
            )
        else:
            cursor = await db.execute("SELECT * FROM email_templates ORDER BY name")
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


@router.post("/templates")
async def create_template(payload: TemplateCreate, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO email_templates (name, subject, body, industry, use_case, user_id)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (payload.name, payload.subject, payload.body, payload.industry, payload.use_case, user.get("id")),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "ok": True}
    finally:
        await db.close()


@router.delete("/templates/{template_id}")
async def delete_template(template_id: int, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        await db.execute("DELETE FROM email_templates WHERE id = ?", (template_id,))
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


# --- Follow-up Sequences ---
@router.get("/sequences")
async def list_sequences(user: dict = Depends(get_current_user_optional)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM follow_up_sequences ORDER BY name")
        seqs = [dict(r) for r in await cursor.fetchall()]
        for s in seqs:
            cursor = await db.execute(
                "SELECT * FROM follow_up_steps WHERE sequence_id = ? ORDER BY step_order, days_after",
                (s["id"],),
            )
            s["steps"] = [dict(r) for r in await cursor.fetchall()]
        return seqs
    finally:
        await db.close()


@router.post("/sequences")
async def create_sequence(payload: SequenceCreate, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO follow_up_sequences (name, user_id) VALUES (?, ?)",
            (payload.name, user.get("id")),
        )
        seq_id = cursor.lastrowid
        for i, step in enumerate(payload.steps):
            await db.execute(
                """INSERT INTO follow_up_steps (sequence_id, days_after, subject, body, step_order)
                   VALUES (?, ?, ?, ?, ?)""",
                (seq_id, step.get("days_after", 0), step.get("subject", ""), step.get("body", ""), i),
            )
        await db.commit()
        return {"id": seq_id, "ok": True}
    finally:
        await db.close()


# --- Profile Analysis ---
@router.get("/contacts/{contact_id}/profile")
async def get_contact_profile(contact_id: int, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM contacts WHERE id = ?", (contact_id,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "Contact not found")
        contact = dict(row)

        cursor = await db.execute("SELECT * FROM contact_profiles WHERE contact_id = ?", (contact_id,))
        profile_row = await cursor.fetchone()
        if profile_row:
            return dict(profile_row)

        # Analyze on-the-fly if no cached profile
        result = analyze_contact_profile(
            name=contact.get("name"),
            title=contact.get("title"),
            company=contact.get("company"),
            linkedin_url=contact.get("linkedin_url"),
            department=contact.get("department"),
        )
        await db.execute(
            """INSERT OR REPLACE INTO contact_profiles (contact_id, value_proposition, role_summary, online_sentiment, receptiveness_notes, industry)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (contact_id, result["value_proposition"], result["role_summary"], result["online_sentiment"],
             result["receptiveness_notes"], result["industry"]),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM contact_profiles WHERE contact_id = ?", (contact_id,))
        return dict((await cursor.fetchone()))
    finally:
        await db.close()


@router.post("/contacts/{contact_id}/profile/refresh")
async def refresh_contact_profile(contact_id: int, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM contacts WHERE id = ?", (contact_id,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "Contact not found")
        contact = dict(row)
        result = analyze_contact_profile(
            name=contact.get("name"),
            title=contact.get("title"),
            company=contact.get("company"),
            linkedin_url=contact.get("linkedin_url"),
            department=contact.get("department"),
        )
        await db.execute(
            """INSERT OR REPLACE INTO contact_profiles (contact_id, value_proposition, role_summary, online_sentiment, receptiveness_notes, industry)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (contact_id, result["value_proposition"], result["role_summary"], result["online_sentiment"],
             result["receptiveness_notes"], result["industry"]),
        )
        await db.commit()
        return result
    finally:
        await db.close()


# --- Sentiment Analysis ---
@router.post("/sentiment/analyze")
async def analyze_sentiment(payload: SentimentAnalyzeRequest, user: dict = Depends(get_current_user)):
    result = analyze_email_sentiment(
        subject=payload.subject,
        body=payload.body,
        industry=payload.industry,
        target_role=payload.target_role,
    )
    return result


class SentimentSaveRequest(BaseModel):
    contact_id: Optional[int] = None
    subject: str = ""
    body: str = ""
    industry: Optional[str] = None


@router.post("/sentiment/save")
async def save_sentiment_analysis(payload: SentimentSaveRequest, user: dict = Depends(get_current_user)):
    result = analyze_email_sentiment(
        subject=payload.subject, body=payload.body, industry=payload.industry
    )
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO email_sentiment_analyses (contact_id, subject, body, sentiment_score, sentiment_label, industry_fit, suggested_improvements)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (payload.contact_id, payload.subject, payload.body, result["sentiment_score"],
             result["sentiment_label"], result["industry_fit"], result["suggested_improvements"]),
        )
        await db.commit()
        return {"id": cursor.lastrowid, **result}
    finally:
        await db.close()


# --- Response parsing (manual mark as replied) ---
@router.post("/campaign-contacts/{cc_id}/mark-replied")
async def mark_campaign_contact_replied(cc_id: int, user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute(
            "UPDATE campaign_contacts SET replied_at = CURRENT_TIMESTAMP, status = 'replied' WHERE id = ?",
            (cc_id,),
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(404, "Campaign contact not found")
        # Also update contact pipeline if we have contact_id
        cursor = await db.execute("SELECT contact_id FROM campaign_contacts WHERE id = ?", (cc_id,))
        row = await cursor.fetchone()
        if row and row["contact_id"]:
            await db.execute(
                "UPDATE contacts SET pipeline_status = 'replied' WHERE id = ?",
                (row["contact_id"],),
            )
            await db.commit()
        return {"ok": True}
    finally:
        await db.close()


# --- Email verification ---
@router.get("/verify-email")
async def verify_email(email: str, user: dict = Depends(get_current_user)):
    from app.services.email_verifier import verify_email_format
    result = verify_email_format(email)
    if result["valid"]:
        return {"valid": True, "email": email.strip().lower()}
    return {"valid": False, "reason": result.get("reason", "Invalid")}


# --- Smart send timing ---
@router.get("/send-timing")
async def get_send_timing(industry: Optional[str] = None, user: dict = Depends(get_current_user)):
    """Suggested send windows based on B2B best practices. Industry can refine."""
    # Generic B2B: Tue-Thu 9-11am, 2-4pm local often perform well
    windows = [
        {"day": "Tuesday", "time": "9:00-11:00", "reason": "Start of work week momentum"},
        {"day": "Wednesday", "time": "9:00-11:00", "reason": "Mid-week engagement peak"},
        {"day": "Thursday", "time": "14:00-16:00", "reason": "Afternoon decision-making"},
    ]
    if industry and "tech" in industry.lower():
        windows.insert(0, {"day": "Tuesday", "time": "10:00-12:00", "reason": "Tech professionals often check email mid-morning"})
    return {"windows": windows[:3]}


# --- Outreach Campaigns (community + individual) ---
class OutreachCampaignCreate(BaseModel):
    name: str
    type: str = "individual"  # community | individual
    description: Optional[str] = None
    priority: int = 0


class OutreachCampaignAddContacts(BaseModel):
    contact_ids: list[int]


@router.get("/campaigns")
async def list_outreach_campaigns(user: dict = Depends(get_current_user)):
    """List community and individual outreach campaigns. Community = institution priorities; individual = per-user."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT oc.*, u.name as owner_name, u.email as owner_email,
               (SELECT COUNT(*) FROM outreach_campaign_contacts WHERE campaign_id = oc.id) as contact_count
               FROM outreach_campaigns oc
               LEFT JOIN users u ON oc.owner_id = u.id
               ORDER BY oc.type ASC, oc.priority DESC, oc.updated_at DESC"""
        )
        rows = await cursor.fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        await db.close()


@router.post("/campaigns")
async def create_outreach_campaign(payload: OutreachCampaignCreate, user: dict = Depends(get_current_user)):
    """Create a community or individual outreach campaign."""
    if payload.type not in ("community", "individual"):
        raise HTTPException(400, "type must be community or individual")
    db = await get_db()
    try:
        owner_id = user["id"] if payload.type == "individual" else None
        cursor = await db.execute(
            """INSERT INTO outreach_campaigns (name, type, owner_id, description, priority)
               VALUES (?, ?, ?, ?, ?)""",
            (payload.name, payload.type, owner_id, payload.description or "", payload.priority),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "ok": True}
    finally:
        await db.close()


@router.get("/campaigns/{campaign_id}")
async def get_outreach_campaign(campaign_id: int, user: dict = Depends(get_current_user)):
    """Get campaign with contacts."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT oc.*, u.name as owner_name, u.email as owner_email
               FROM outreach_campaigns oc LEFT JOIN users u ON oc.owner_id = u.id
               WHERE oc.id = ?""",
            (campaign_id,),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "Campaign not found")
        campaign = row_to_dict(row)
        cursor = await db.execute(
            """SELECT c.* FROM contacts c
               JOIN outreach_campaign_contacts occ ON occ.contact_id = c.id
               WHERE occ.campaign_id = ?""",
            (campaign_id,),
        )
        campaign["contacts"] = [row_to_dict(r) for r in await cursor.fetchall()]
        return campaign
    finally:
        await db.close()


@router.post("/campaigns/{campaign_id}/contacts")
async def add_contacts_to_outreach_campaign(
    campaign_id: int, payload: OutreachCampaignAddContacts, user: dict = Depends(get_current_user)
):
    """Add contacts to an outreach campaign."""
    db = await get_db()
    try:
        for cid in payload.contact_ids:
            await db.execute(
                "INSERT OR IGNORE INTO outreach_campaign_contacts (campaign_id, contact_id) VALUES (?, ?)",
                (campaign_id, cid),
            )
        await db.execute(
            "UPDATE outreach_campaigns SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (campaign_id,),
        )
        await db.commit()
        return {"ok": True, "added": len(payload.contact_ids)}
    finally:
        await db.close()


@router.delete("/campaigns/{campaign_id}/contacts/{contact_id}")
async def remove_contact_from_outreach_campaign(
    campaign_id: int, contact_id: int, user: dict = Depends(get_current_user)
):
    """Remove a contact from an outreach campaign."""
    db = await get_db()
    try:
        await db.execute(
            "DELETE FROM outreach_campaign_contacts WHERE campaign_id = ? AND contact_id = ?",
            (campaign_id, contact_id),
        )
        await db.execute(
            "UPDATE outreach_campaigns SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (campaign_id,),
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


@router.delete("/campaigns/{campaign_id}")
async def delete_outreach_campaign(campaign_id: int, user: dict = Depends(get_current_user)):
    """Delete an outreach campaign."""
    db = await get_db()
    try:
        await db.execute("DELETE FROM outreach_campaign_contacts WHERE campaign_id = ?", (campaign_id,))
        await db.execute("DELETE FROM outreach_campaigns WHERE id = ?", (campaign_id,))
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


# --- Metrics (extended) ---
@router.get("/metrics/pipeline")
async def get_pipeline_metrics(user: dict = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT pipeline_status, COUNT(*) as count FROM contacts
               WHERE pipeline_status IS NOT NULL AND pipeline_status != ''
               GROUP BY pipeline_status"""
        )
        rows = await cursor.fetchall()
        return {"by_status": [dict(r) for r in rows]}
    finally:
        await db.close()
