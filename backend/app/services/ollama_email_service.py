"""
AI email generation. Bedrock Anthropic (Opus → Haiku) or local Ollama.
"""
from typing import Optional


TONE_INSTRUCTIONS = {
    "professional": "Use a formal, polished professional tone. Be respectful and business-appropriate.",
    "conversational": "Use a warm, friendly conversational tone. Write like you're talking to a colleague.",
    "bold": "Use a confident, direct tone. Be assertive and make a strong impression.",
    "empathetic": "Use an understanding, empathetic tone. Acknowledge their challenges and show you care.",
    "authority": "Use an authoritative, expert tone. Position yourself as a trusted advisor.",
}

LENGTH_INSTRUCTIONS = {
    "ultra_short": "Write exactly 3 sentences. Be extremely concise.",
    "short": "Write 5-7 sentences. Get to the point quickly.",
    "standard": "Write 1-2 short paragraphs. Provide enough context without being verbose.",
}

ANGLE_INSTRUCTIONS = {
    "pain_point": "Open by addressing a common pain point or challenge in their role/industry.",
    "social_proof": "Open with a brief mention of results achieved for similar companies/roles.",
    "case_study": "Open with a specific mini case study or success story relevant to them.",
    "question_hook": "Open with a thought-provoking question that resonates with their situation.",
    "compliment": "Open with a genuine compliment about their company, recent news, or achievements.",
}


def generate_email(
    contact_name: str,
    contact_title: str,
    company_name: str,
    company_domain: str,
    tone: str = "professional",
    length: str = "short",
    angle: str = "pain_point",
    custom_instructions: Optional[str] = None,
    value_proposition: Optional[str] = None,
    model: Optional[str] = None,
) -> tuple[str, str]:
    """
    Generate a unique, personalized email. Bedrock Anthropic when the model id is Claude;
    Ollama on the laptop otherwise.
    Returns (subject, body) tuple.
    """
    tone_inst = TONE_INSTRUCTIONS.get(tone, TONE_INSTRUCTIONS["professional"])
    length_inst = LENGTH_INSTRUCTIONS.get(length, LENGTH_INSTRUCTIONS["short"])
    angle_inst = ANGLE_INSTRUCTIONS.get(angle, ANGLE_INSTRUCTIONS["pain_point"])

    value_prop = value_proposition or "our solution that helps companies like yours achieve better results"
    custom = f"\n\nAdditional instructions: {custom_instructions}" if custom_instructions else ""

    prompt = f"""You are an expert B2B sales email writer. Write a cold outreach email that feels genuinely personal and researched — NOT generic or templated.

CONTACT CONTEXT:
- Name: {contact_name or 'there'}
- Title: {contact_title or 'professional'}
- Company: {company_name or 'their company'}
- Domain: {company_domain or 'their company'}

WRITING GUIDELINES:
- Tone: {tone_inst}
- Length: {length_inst}
- Opening angle: {angle_inst}
- Value proposition to weave in: {value_prop}
{custom}

CRITICAL: The email must read like it was written by a human who did their homework. Reference their role, company, or industry naturally. No "I hope this email finds you well" or similar clichés.

Respond with ONLY valid JSON in this exact format (no markdown, no explanation):
{{"subject": "Your compelling subject line here", "body": "Full email body here. Use \\n for line breaks."}}"""

    from fastapi import HTTPException
    try:
        from app.services.llm import complete_json

        data = complete_json(prompt, model_id=model)
        if data and isinstance(data.get('subject'), str) and isinstance(data.get('body'), str) and data['body'].strip():
            subject = data['subject']
            body = data['body'].replace("\\n", "\n")
            return subject, body
        raise RuntimeError("Model returned no JSON")

    except HTTPException:
        raise
    except Exception as error:
        # Never present a fabricated template as a successful AI generation.
        raise HTTPException(502, 'Draft generation failed. Your existing draft is unchanged; please retry.') from error
