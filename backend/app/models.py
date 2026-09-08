"""
Pydantic models for ClientReach AI
"""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ContactCreate(BaseModel):
    name: Optional[str] = None
    email: str
    title: Optional[str] = None
    company: Optional[str] = None
    company_domain: Optional[str] = None
    linkedin_url: Optional[str] = None
    confidence: Optional[str] = "medium"
    department: Optional[str] = None


class Contact(ContactCreate):
    id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ScrapeRequest(BaseModel):
    company_name: Optional[str] = None
    domain: Optional[str] = None
    linkedin_url: Optional[str] = None  # e.g. https://linkedin.com/company/acme
    linkedin_max_employees: Optional[int] = 50  # max employees when using Apify
    enable_web_discovery: Optional[bool] = True  # Tavily web search for named employees


class SearchPersonRequest(BaseModel):
    """Search the web for information about a contact (name, optional company)."""
    name: str
    company: Optional[str] = None


class EmailGenerateRequest(BaseModel):
    contact_id: int
    tone: str = "professional"  # professional, conversational, bold, empathetic, authority
    length: str = "short"  # ultra-short, short, standard
    angle: str = "pain_point"  # pain_point, social_proof, case_study, question_hook, compliment
    custom_instructions: Optional[str] = None
    value_proposition: Optional[str] = None
    model: Optional[str] = None


class EmailGenerateResponse(BaseModel):
    subject: str
    body: str
    contact_id: Optional[int] = None


class EmailGenerateTemplateRequest(BaseModel):
    """Generate email without a contact - use manual name, company, title."""
    name: Optional[str] = None
    company: Optional[str] = None
    title: Optional[str] = None
    email: Optional[str] = None
    tone: str = "professional"
    length: str = "short"
    angle: str = "pain_point"
    custom_instructions: Optional[str] = None
    value_proposition: Optional[str] = None
    model: Optional[str] = None


class CampaignCreate(BaseModel):
    name: str


class CampaignContactAdd(BaseModel):
    contact_ids: list[int]
    email_subjects: Optional[dict[str, str]] = None  # contact_id -> subject
    email_bodies: Optional[dict[str, str]] = None    # contact_id -> body


class Campaign(BaseModel):
    id: int
    name: str
    status: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class YucgProspectTarget(BaseModel):
    """Spreadsheet-backed company target for outreach coordination."""

    row_index: int
    company: str
    sector: str
    why_attractive: str
    engagement_theme: str
    yale_hook: Optional[str] = None
    has_yale_hook: bool = False
    outreach_priority: int = 3
    contact_type: str
    target_role_title: Optional[str] = None
    incentive_score: float = 0.0
    verification_source_url: str
    first_message_angle: Optional[str] = None
    discovery_hint: Optional[str] = None
    score_rationale: str
    yucg_service_tags: list[str] = []


class YucgProspectVerifiability(BaseModel):
    company: str
    row_index: int
    sector: Optional[str] = None
    engagement_theme: Optional[str] = None
    composite_score: float
    score_breakdown: dict[str, float]
    score_rationale: Optional[str] = None
    incentive_score: Optional[float] = None
    outreach_priority: Optional[int] = None
    has_yale_hook: Optional[bool] = None
    contact_type: Optional[str] = None
    verification_source_url: str
    yucg_service_tags: list[str] = []
