"""
Emails API - AI Email Generation Engine (Ollama)
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.auth_deps import get_current_user, get_current_user_optional
from app.models import EmailGenerateRequest, EmailGenerateResponse, EmailGenerateTemplateRequest
from app.services.ollama_email_service import generate_email
from app.services.gmail_api import send_via_gmail_api
from app.services.settings_service import get_setting
from app.services.usage_service import log_event

router = APIRouter()


class TestSendRequest(BaseModel):
    to_email: str
    subject: str
    body: str
    attachment_ids: Optional[list[int]] = None


@router.post("/generate", response_model=EmailGenerateResponse)
async def generate_email_for_contact(req: EmailGenerateRequest, user: dict = Depends(get_current_user)):
    """Generate a unique, personalized email for a contact using Ollama."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM contacts WHERE id = ?", (req.contact_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "Contact not found")
        contact = dict(row)

        from app.services.contact_scraper import normalize_domain
        company_domain = normalize_domain(contact.get("company_domain") or "")

        subject, body = generate_email(
            contact_name=contact.get("name"),
            contact_title=contact.get("title"),
            company_name=contact.get("company"),
            company_domain=company_domain,
            tone=req.tone,
            length=req.length.replace("-", "_"),
            angle=req.angle,
            custom_instructions=req.custom_instructions,
            value_proposition=req.value_proposition,
        )
        signature = await get_setting("signature") or ""
        await db.execute(
            """INSERT INTO generated_emails (user_id, contact_id, subject, body, signature)
               VALUES (?, ?, ?, ?, ?)""",
            (user["id"], req.contact_id, subject, body, signature),
        )
        await db.commit()

        await log_event(
            user["id"], "email_generated", "email",
            {"contact_id": req.contact_id, "tone": req.tone, "length": req.length, "angle": req.angle},
        )
        return EmailGenerateResponse(
            subject=subject,
            body=body,
            contact_id=req.contact_id,
        )
    finally:
        await db.close()


@router.post("/generate-template", response_model=EmailGenerateResponse)
async def generate_email_template(req: EmailGenerateTemplateRequest):
    """Generate an email without a contact - use manual name, company, title."""
    from app.services.contact_scraper import normalize_domain
    company_domain = normalize_domain(req.company or "") if req.company else ""
    subject, body = generate_email(
        contact_name=req.name,
        contact_title=req.title,
        company_name=req.company,
        company_domain=company_domain,
        tone=req.tone,
        length=req.length.replace("-", "_"),
        angle=req.angle,
        custom_instructions=req.custom_instructions,
        value_proposition=req.value_proposition,
    )
    return EmailGenerateResponse(
        subject=subject,
        body=body,
        contact_id=None,
    )


@router.post("/test-send")
async def test_send_email(req: TestSendRequest, user: dict = Depends(get_current_user)):
    """Send a test email to the logged-in user's inbox via Gmail API (OAuth). Optional attachments from library."""
    try:
        signature = await get_setting("signature")
        attachments_data = []
        if req.attachment_ids:
            from app.routers.attachments import get_attachment_data_for_send
            attachments_data = await get_attachment_data_for_send(req.attachment_ids)
        await send_via_gmail_api(
            user_id=user["id"],
            to_email=req.to_email,
            subject=req.subject,
            body=req.body,
            signature=signature,
            attachments=attachments_data if attachments_data else None,
        )
        return {"ok": True, "message": f"Test email sent to {req.to_email}"}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        err = str(e)
        raise HTTPException(500, f"Failed to send: {err}")


@router.get("/generated")
async def list_generated_emails(
    contact_id: Optional[int] = None,
    sort: str = "created_desc",
    user: dict | None = Depends(get_current_user_optional),
):
    """List generated emails for the current user. Returns [] if not authenticated."""
    if not user:
        return []
    order_map = {
        "created_desc": "ge.created_at DESC",
        "created_asc": "ge.created_at ASC",
        "contact": "c.name",
    }
    order = order_map.get(sort, "ge.created_at DESC")
    db = await get_db()
    try:
        if contact_id:
            cursor = await db.execute(
                f"""SELECT ge.*, c.name, c.email, c.company FROM generated_emails ge
                    JOIN contacts c ON ge.contact_id = c.id
                    WHERE ge.user_id = ? AND ge.contact_id = ? ORDER BY {order}""",
                (user["id"], contact_id),
            )
        else:
            cursor = await db.execute(
                f"""SELECT ge.*, c.name, c.email, c.company FROM generated_emails ge
                    JOIN contacts c ON ge.contact_id = c.id
                    WHERE ge.user_id = ? ORDER BY {order}""",
                (user["id"],),
            )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


@router.post("/generate-batch")
async def generate_emails_batch(requests: list[EmailGenerateRequest], user: dict = Depends(get_current_user)):
    """Generate emails for multiple contacts (batch)."""
    results = []
    for req in requests:
        try:
            resp = await generate_email_for_contact(req)
            results.append(resp.model_dump())
        except Exception as e:
            results.append({
                "contact_id": req.contact_id,
                "error": str(e),
                "subject": None,
                "body": None,
            })
    return {"results": results}
