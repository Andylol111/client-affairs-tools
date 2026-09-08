#!/usr/bin/env python3
"""Expand YUCG prospect spreadsheet with outreach coordination columns and new rows."""

from __future__ import annotations

import copy
import re
from pathlib import Path

import openpyxl
import pandas as pd
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

INPUT_PATH = Path("/Users/andreh./Documents/YUCG_Prospect_List.xlsx")
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "data"
OUTPUT_PATH = OUTPUT_DIR / "YUCG_Prospect_List.xlsx"
BACKUP_PATH = OUTPUT_DIR / "YUCG_Prospect_List.expanded.xlsx"

NEW_COLUMNS = [
    "Outreach Priority",
    "Contact Type",
    "Target Role Title",
    "Incentive Score",
    "Score Rationale",
    "Verification Source URL",
    "Recommended First Message Angle",
    "Contact Discovery Hint",
]

HEADER_FILL = PatternFill(start_color="00356B", end_color="00356B", fill_type="solid")
HEADER_FONT = Font(bold=True, color="FFFFFF", size=11)

# Company-specific outreach overrides (key = exact company name in sheet)
COMPANY_OVERRIDES: dict[str, dict] = {
    "AMC Theatres": {
        "Contact Type": "Exhibition Strategy",
        "Target Role Title": "Chief Executive Officer (Adam Aron) or EVP Film Programming",
        "Verification Source URL": "https://investor.amctheatres.com/corporate-governance/management",
        "Contact Discovery Hint": "NATO CinemaCon (Las Vegas, April); ShowEast; investor earnings Q&A",
        "Recommended First Message Angle": "Pitch Gen-Z theatrical habit research tied to premium format and event-cinema programming decisions.",
    },
    "A24": {
        "Contact Type": "Studio Strategy / Acquisitions",
        "Target Role Title": "Head of Acquisitions or VP Strategic Partnerships",
        "Verification Source URL": "https://www.linkedin.com/search/results/people/?keywords=A24%20acquisitions",
        "Contact Discovery Hint": "Sundance/TIFF market floor; A24 press releases on distribution deals",
        "Recommended First Message Angle": "Offer Gen-Z taste-mapping for micro-genre slates and campus word-of-mouth lift studies.",
    },
    "Netflix": {
        "Contact Type": "Streaming Strategy",
        "Target Role Title": "VP Consumer Insights or Director Content Strategy",
        "Verification Source URL": "https://jobs.netflix.com/search?q=consumer%20insights",
        "Contact Discovery Hint": "Variety/Hollywood Reporter summit panels; Netflix Tudum fan events",
        "Recommended First Message Angle": "Frame a semester sprint on Gen-Z churn drivers and social-first title discovery.",
    },
    "Embraer Commercial Aviation": {
        "Contact Type": "VP Business Development",
        "Target Role Title": "VP Sales & Marketing — Americas or Head of Market Intelligence",
        "Verification Source URL": "https://www.embraer.com/en/about-us/leadership/",
        "Contact Discovery Hint": "RAA Annual Convention; Regional Airline Association route forums; NBAA adjacent",
        "Recommended First Message Angle": "Lead with Tweed/HVN proof point and E2 TCO narrative for US regional carriers.",
    },
    "The Walt Disney Company (Studios)": {
        "Contact Type": "Studio Strategy",
        "Target Role Title": "SVP Franchise Marketing or VP Consumer Insights (Studios)",
        "Verification Source URL": "https://www.linkedin.com/search/results/people/?keywords=Disney%20Studios%20consumer%20insights",
        "Contact Discovery Hint": "D23 Expo; CinemaCon Disney presentation; Yale alumni in Burbank/Glendale",
        "Recommended First Message Angle": "Propose Gen-Z franchise affinity research bridging theatrical and Disney+ windows.",
    },
}

SECTOR_DEFAULTS: dict[str, dict] = {
    "Entertainment": {
        "Contact Type": "Studio Strategy",
        "Target Role Title": "VP Strategic Partnerships or Head of Brand Marketing",
        "Verification Source URL": "https://www.linkedin.com/search/results/people/?keywords={company}%20partnerships",
        "Contact Discovery Hint": "Film festivals (Sundance, TIFF, SXSW); CinemaCon; guild/industry mixers",
        "Recommended First Message Angle": "Offer Gen-Z audience research and social-first marketing pilots for slate positioning.",
    },
    "Airline": {
        "Contact Type": "Head of Airport ASD",
        "Target Role Title": "VP Network Planning or Director Airport Affairs",
        "Verification Source URL": "https://www.linkedin.com/search/results/people/?keywords={company}%20network%20planning",
        "Contact Discovery Hint": "RAA/IATA route development forums; airline investor days",
        "Recommended First Message Angle": "Open with route economics and student-travel demand modeling for secondary markets.",
    },
    "Regional": {
        "Contact Type": "Head of Airport ASD",
        "Target Role Title": "Director Route Development or VP Commercial",
        "Verification Source URL": "https://www.linkedin.com/search/results/people/?keywords={company}%20route%20development",
        "Contact Discovery Hint": "RAA Annual Convention; ACI-NA conferences",
        "Recommended First Message Angle": "Connect Yale/New Haven traveler capture data to thin-route business cases.",
    },
    "Airport": {
        "Contact Type": "Partnerships",
        "Target Role Title": "Director Air Service Development or VP Business Development",
        "Verification Source URL": "https://www.linkedin.com/search/results/people/?keywords={company}%20air%20service%20development",
        "Contact Discovery Hint": "ACI-NA JumpStart; Routes Americas/World conferences",
        "Recommended First Message Angle": "Lead with Tweed analytics playbook and student-market origination studies.",
    },
    "Consulting": {
        "Contact Type": "Partnerships",
        "Target Role Title": "Campus Recruiting Lead or University Relations Manager",
        "Verification Source URL": "https://www.linkedin.com/search/results/people/?keywords={company}%20campus%20recruiting%20Yale",
        "Contact Discovery Hint": "Yale OCS employer events; consulting club case competitions",
        "Recommended First Message Angle": "Position YUCG as a low-lift Gen-Z insights partner ahead of recruiting season.",
    },
    "University": {
        "Contact Type": "Alumni Relations",
        "Target Role Title": "Director Alumni Engagement or VP Advancement Partnerships",
        "Verification Source URL": "https://www.linkedin.com/search/results/people/?keywords={company}%20alumni%20relations",
        "Contact Discovery Hint": "CASE conferences; peer consulting group cross-referrals",
        "Recommended First Message Angle": "Propose joint student consulting showcase with shared alumni mentor network.",
    },
    "Peer University": {
        "Contact Type": "Alumni Relations",
        "Target Role Title": "Director Student Consulting or VP External Relations",
        "Verification Source URL": "https://www.linkedin.com/search/results/people/?keywords={company}%20consulting%20group",
        "Contact Discovery Hint": "Inter-consulting club summits; NACE career events",
        "Recommended First Message Angle": "Suggest cross-campus Gen-Z research exchange and co-branded case study.",
    },
    "Finance": {
        "Contact Type": "Marketing Director",
        "Target Role Title": "Head of Brand Marketing or VP Growth",
        "Verification Source URL": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company={company}",
        "Contact Discovery Hint": "FinTech conferences; Yale SOM finance clubs",
        "Recommended First Message Angle": "Pitch Gen-Z financial literacy and product adoption research for brand lift.",
    },
    "Pharma": {
        "Contact Type": "Marketing Director",
        "Target Role Title": "VP Patient Marketing or Director HCP Engagement",
        "Verification Source URL": "https://www.linkedin.com/search/results/people/?keywords={company}%20patient%20marketing",
        "Contact Discovery Hint": "HLTH conference; Yale biomedical alumni network",
        "Recommended First Message Angle": "Reference Fall 2025 Gen-Z T1D engagement proof and offer cohort research sprint.",
    },
    "Tech": {
        "Contact Type": "Partnerships",
        "Target Role Title": "Head of University Programs or VP Developer Relations",
        "Verification Source URL": "https://www.linkedin.com/search/results/people/?keywords={company}%20university%20partnerships",
        "Contact Discovery Hint": "Grace Hopper; company campus ambassador programs; Yale CS career fair",
        "Recommended First Message Angle": "Lead with prior YUCG tech deliverable and Gen-Z product feedback loop.",
    },
    "default": {
        "Contact Type": "VP Business Development",
        "Target Role Title": "Director Strategic Partnerships or VP Marketing",
        "Verification Source URL": "https://www.linkedin.com/search/results/people/?keywords={company}%20business%20development",
        "Contact Discovery Hint": "Industry trade shows; Yale alumni directory; company press room leadership page",
        "Recommended First Message Angle": "Offer a semester-scoped Gen-Z market research and go-to-market sprint with Yale faculty access.",
    },
}

PAST_CLIENTS = {
    "google", "delta", "uber", "linkedin", "pfizer", "lyft", "turkish airlines",
    "canva", "dbrand", "tweed", "new haven", "city of new haven",
}

GENZ_KEYWORDS = [
    "gen-z", "gen z", "student", "campus", "tiktok", "youtube", "social",
    "creator", "viral", "young audience", "college", "streaming habit",
]

YALE_KEYWORDS = [
    "yale", "new haven", "tweed", "hvn", "schwarzman", "drama", "film & media",
    "school of the environment", "faculty", "alumni",
]

SEMESTER_FIT_KEYWORDS = [
    "semester", "sprint", "pilot", "benchmark", "route", "marketing narrative",
    "business case", "data work", "analytics", "research", "survey",
]

PUBLIC_VERIFIABLE_SECTORS = {
    "entertainment", "airline", "finance", "pharma", "retail", "hospitality",
    "insurance", "transit", "airport", "ota", "streaming", "exhibition",
}


def _slug_company(name: str) -> str:
    base = re.sub(r"\([^)]*\)", "", name).strip()
    return base.split("/")[0].split("—")[0].strip()


def _sector_bucket(sector: str) -> str:
    s = (sector or "").lower()
    if "entertainment" in s:
        return "Entertainment"
    if "airline" in s or "regional" in s and "airport" not in s:
        return "Airline" if "airline" in s else "Regional"
    if "airport" in s:
        return "Airport"
    if "consulting" in s:
        return "Consulting"
    if "peer university" in s:
        return "Peer University"
    if "university" in s or "edtech" in s or "education" in s:
        return "University"
    if "finance" in s or "fintech" in s:
        return "Finance"
    if "pharma" in s or "medtech" in s or "biotech" in s or "health" in s:
        return "Pharma"
    if "tech" in s:
        return "Tech"
    return "default"


def compute_incentive_score(row: pd.Series) -> tuple[int, str]:
    why = str(row.get("Why Attractive Prospect for YUCG", "") or "").lower()
    hook = str(row.get("Yale / YUCG Hook", "") or "").lower()
    sector = str(row.get("Sector", "") or "").lower()
    company = str(row.get("Company", "") or "").lower()
    combined = f"{why} {hook} {sector} {company}"

    score = 42
    rationale_parts: list[str] = []

    # Repeat-client potential
    if any(p in combined for p in PAST_CLIENTS):
        score += 18
        rationale_parts.append("prior YUCG/client proof")
    elif "past client" in sector:
        score += 15
        rationale_parts.append("marked past-client sector")

    # Yale hook strength
    yale_hits = sum(1 for k in YALE_KEYWORDS if k in combined)
    if yale_hits >= 2 or hook.strip() not in ("", "nan"):
        score += 12 + min(yale_hits, 3) * 2
        rationale_parts.append("strong Yale/local hook")
    elif yale_hits == 1:
        score += 6
        rationale_parts.append("moderate Yale adjacency")

    # Gen-Z angle
    genz_hits = sum(1 for k in GENZ_KEYWORDS if k in combined)
    if genz_hits >= 2:
        score += 14
        rationale_parts.append("clear Gen-Z research angle")
    elif genz_hits == 1:
        score += 8
        rationale_parts.append("Gen-Z relevance")

    # Verifiable public contacts
    if any(k in sector for k in PUBLIC_VERIFIABLE_SECTORS) or "sec" in why:
        score += 8
        rationale_parts.append("public leadership/contact trail")
    elif "peer university" in sector:
        score += 10
        rationale_parts.append("campus org contacts verifiable")

    # Semester-fit project size
    if any(k in combined for k in SEMESTER_FIT_KEYWORDS):
        score += 10
        rationale_parts.append("semester-scoped deliverable")
    if "enterprise" in why or "global" in why:
        score -= 4
        rationale_parts.append("large-org complexity discount")

    score = max(15, min(98, score))
    if not rationale_parts:
        rationale_parts.append("baseline strategic fit")
    return score, "; ".join(rationale_parts[:4])


def outreach_priority(score: int) -> int:
    if score >= 85:
        return 1
    if score >= 72:
        return 2
    if score >= 58:
        return 3
    if score >= 42:
        return 4
    return 5


def enrich_row(row: pd.Series) -> dict:
    company = str(row["Company"])
    sector = str(row["Sector"])
    bucket = _sector_bucket(sector)
    defaults = SECTOR_DEFAULTS.get(bucket, SECTOR_DEFAULTS["default"])
    override = COMPANY_OVERRIDES.get(company, {})

    slug = _slug_company(company)
    url_template = override.get("Verification Source URL") or defaults["Verification Source URL"]
    if "{company}" in url_template:
        url = url_template.format(company=slug.replace(" ", "%20"))
    else:
        url = url_template

    score, rationale = compute_incentive_score(row)
    # Boost if override exists (hand-curated high-value targets)
    if override:
        score = min(98, score + 5)
        rationale = f"curated outreach target; {rationale}"

    result = {
        "Outreach Priority": outreach_priority(score),
        "Contact Type": override.get("Contact Type", defaults["Contact Type"]),
        "Target Role Title": override.get("Target Role Title", defaults["Target Role Title"]),
        "Incentive Score": score,
        "Score Rationale": rationale,
        "Verification Source URL": url,
        "Recommended First Message Angle": override.get(
            "Recommended First Message Angle", defaults["Recommended First Message Angle"]
        ),
        "Contact Discovery Hint": override.get(
            "Contact Discovery Hint", defaults["Contact Discovery Hint"]
        ),
    }

    # Preserve hand-authored outreach fields on newly added rows
    for col in NEW_COLUMNS:
        if col in row.index and pd.notna(row.get(col)) and str(row.get(col)).strip():
            result[col] = row[col]
    if "Incentive Score" in row.index and pd.notna(row.get("Incentive Score")):
        score_val = int(row["Incentive Score"])
        result["Incentive Score"] = score_val
        result["Outreach Priority"] = outreach_priority(score_val)

    return result


def new_company_rows() -> list[dict]:
    """60+ new prospects in under-covered sectors plus entertainment role expansions."""
    rows: list[dict] = []

    def add(
        company: str,
        sector: str,
        why: str,
        theme: str,
        hook: str = "",
        **outreach,
    ):
        base = {
            "Company": company,
            "Sector": sector,
            "Why Attractive Prospect for YUCG": why,
            "Suggested Engagement Theme": theme,
            "Yale / YUCG Hook": hook,
        }
        base.update(outreach)
        rows.append(base)

    # --- Entertainment role-specific expansions ---
    entertainment_expansions = [
        (
            "AMC Theatres — CEO Office",
            "Entertainment — Exhibition / Leadership",
            "CEO-level theatrical recovery narrative needs Gen-Z habit data for investor story and format strategy.",
            "Executive briefing deck on Gen-Z theatrical attendance drivers",
            "Yale School of Drama + Film & Media Studies student panels",
            "Exhibition Strategy",
            "Chief Executive Officer",
            "https://investor.amctheatres.com/corporate-governance/management",
            "Offer a 4-week Gen-Z theatrical sentiment tracker ahead of earnings.",
            "NATO CinemaCon CEO summit; AMC investor day",
        ),
        (
            "AMC Theatres — Head of Film Programming",
            "Entertainment — Exhibition / Programming",
            "Programming leads need slate mix research for event cinema, anime nights, and repertory Gen-Z titles.",
            "Programming calendar optimization; social buzz scoring for limited releases",
            "",
            "Studio Strategy",
            "SVP Film Programming / Head of Content Programming",
            "https://www.linkedin.com/search/results/people/?keywords=AMC%20Theatres%20programming",
            "Pitch title-level Gen-Z demand scoring for premium large-format slots.",
            "ShowEast; specialty distributor screenings in NYC/LA",
        ),
        (
            "A24 — Acquisitions & Distribution",
            "Entertainment — Indie / Mini-Major",
            "Acquisitions team buys on Gen-Z cultural velocity; YUCG can quantify campus/word-of-mouth lift pre-buy.",
            "Micro-genre demand mapping; festival acquisition support analytics",
            "Yale Film & Media Studies screening culture",
            "Studio Strategy",
            "Head of Acquisitions",
            "https://www.linkedin.com/search/results/people/?keywords=A24%20acquisitions",
            "Frame pre-acquisition Gen-Z resonance scoring for festival pickups.",
            "Sundance market; TIFF Bell Lightbox; A24 press releases",
        ),
        (
            "NEON — Theatrical Distribution Strategy",
            "Entertainment — Indie / Mini-Major",
            "NEON wins on bold theatrical plays; student influencer cohorts mirror core audience.",
            "Opening weekend campus ambassador pilots; arthouse expansion city ranking",
            "",
            "Marketing Director",
            "President Theatrical Distribution or VP Marketing",
            "https://www.neonrated.com/press",
            "Lead with campus screening tour ROI model for genre titles.",
            "Film Independent Forum; specialty box office postmortems",
        ),
        (
            "Legendary Entertainment — Franchise Marketing",
            "Entertainment — Production Company",
            "Monster-verse and game-adjacent IP needs perpetual Gen-Z refresh between tentpoles.",
            "Franchise health tracking; transmedia fan journey mapping",
            "",
            "Marketing Director",
            "EVP Worldwide Marketing or VP Franchise Management",
            "https://www.linkedin.com/search/results/people/?keywords=Legendary%20Entertainment%20marketing",
            "Propose Gen-Z franchise affinity pulse between theatrical windows.",
            "Comic-Con; Legendary press junkets",
        ),
        (
            "Skydance Media — Production Partnerships",
            "Entertainment — Production Company",
            "Paramount/Skydance merger integration creates partnership whitespace for research sprints.",
            "Post-merger slate positioning; animation/live-action Gen-Z segmentation",
            "",
            "Partnerships",
            "Chief Strategy Officer or SVP Strategic Partnerships",
            "https://www.linkedin.com/search/results/people/?keywords=Skydance%20Media%20strategy",
            "Offer integration-era audience segmentation sprint for dual slates.",
            "Variety Business Managers Breakfast; Skydance press",
        ),
        (
            "IMAX — Content Partnerships",
            "Entertainment — Exhibition / Technology",
            "IMAX selects titles for premium footprint; Gen-Z format preference data de-risks bookings.",
            "PLF title selection model; documentary and concert film campus demand",
            "",
            "Partnerships",
            "EVP IMAX Entertainment or Head of Theatrical Distribution",
            "https://www.imax.com/news",
            "Pitch Gen-Z PLF willingness-to-pay study for alternative content.",
            "CinemaCon IMAX pavilion; investor presentations",
        ),
        (
            "Regal Cinemas — Marketing & Loyalty",
            "Entertainment — Exhibition",
            "Cineworld restructuring makes loyalty and Gen-Z regrowth a board-level KPI.",
            "Regal Unlimited student tier research; concession pairing analytics",
            "",
            "Marketing Director",
            "CMO or VP Loyalty & CRM",
            "https://www.linkedin.com/search/results/people/?keywords=Regal%20Cinemas%20marketing",
            "Lead with student subscription elasticity study for Unlimited tier.",
            "CinemaCon; Regal local market manager intros",
        ),
        (
            "Crunchyroll — Anime Theatrical Events",
            "Entertainment — Streaming / Anime",
            "Sony anime theatrical events explode with Gen-Z; campus fan communities are measurable.",
            "Theatrical event city selection; simulcast vs dub preference by cohort",
            "Yale anime/cosplay communities",
            "Studio Strategy",
            "SVP Global Partnerships or Head of Theatrical",
            "https://www.crunchyroll.com/about",
            "Offer regional anime theatrical demand mapping tied to college hubs.",
            "Anime Expo; Crunchyroll Expo; Sony investor anime segment",
        ),
        (
            "Letterboxd — Brand Partnerships",
            "Entertainment — Social / Discovery",
            "Letterboxd is Gen-Z film taste infrastructure; studios pay for insight layers.",
            "Taste graph analytics; festival buzz correlation studies",
            "",
            "Partnerships",
            "Head of Partnerships or VP Business Development",
            "https://www.linkedin.com/search/results/people/?keywords=Letterboxd%20partnerships",
            "Pitch co-branded Gen-Z film discovery report for studio marketing teams.",
            "TIFF; Sundance; film critic society events",
        ),
    ]
    for item in entertainment_expansions:
        company, sector, why, theme, hook, contact_type, role, url, angle, hint = item
        add(
            company,
            sector,
            why,
            theme,
            hook,
            **{
                "Contact Type": contact_type,
                "Target Role Title": role,
                "Verification Source URL": url,
                "Recommended First Message Angle": angle,
                "Contact Discovery Hint": hint,
            },
        )

    # --- Under-covered sectors (60+ total with above) ---
    under_covered = [
        # Health Tech / Digital Health
        (
            "Ro Health (Ro.co)",
            "Health Tech",
            "DTC telehealth scaling Gen-Z mental health and GLP-1 adjacent categories; needs cohort messaging research.",
            "Gen-Z care-seeking journey; stigma-reduction campaign testing",
            "Yale School of Medicine public health affiliates",
        ),
        (
            "Hims & Hers Health",
            "Health Tech",
            "Public DTC health brand competes on TikTok-native creative; repeat engagement research fits semester scope.",
            "Brand trust audit; subscription retention drivers among 18–24",
            "",
        ),
        (
            "Omada Health",
            "Health Tech",
            "Employer-sponsored chronic care expanding college-adjacent wellness partnerships.",
            "Campus wellness pilot design; digital coaching adoption",
            "Yale Health collaboration angle",
        ),
        (
            "Cityblock Health",
            "Health Tech",
            "Value-based care in urban markets including New Haven-adjacent populations.",
            "Community health outreach analytics; Medicaid engagement",
            "New Haven civic health partnerships",
        ),
        (
            "Devoted Health",
            "Health Tech",
            "Medicare Advantage innovator with data-heavy ops consulting appetite.",
            "Member experience benchmarking; care navigator workflow",
            "",
        ),
        # Defense / GovTech
        (
            "Anduril Industries",
            "Defense Tech",
            "Fast-scaling defense tech with commercial brand and campus recruiting wars.",
            "Employer brand Gen-Z study; dual-use narrative positioning",
            "Yale Jackson School security policy seminars",
        ),
        (
            "Palantir Technologies",
            "Defense Tech",
            "Public gov/commercial split requires careful campus messaging; YUCG can run neutral perception research.",
            "Campus sentiment and use-case clarity study",
            "Yale data science / ethics forums",
        ),
        (
            "Shield AI",
            "Defense Tech",
            "Autonomy startup expanding enterprise partnerships; needs market entry narratives.",
            "Defense-adjacent commercialization story; talent brand",
            "",
        ),
        (
            "Tyler Technologies",
            "GovTech",
            "Dominant municipal software vendor; state/local digital transformation projects fit semester analytics.",
            "Citizen portal UX research; SaaS adoption in mid-size cities",
            "Connecticut municipal angle",
        ),
        (
            "Accela",
            "GovTech",
            "Permitting and civic SaaS used by CT municipalities.",
            "Permit journey analytics; Gen-Z renter/creator economy friction",
            "New Haven permitting modernization",
        ),
        # Energy / Climate / Cleantech
        (
            "Sunrun",
            "Energy — Residential Solar",
            "Residential solar needs Gen-Z homeowner and renter advocacy messaging.",
            "Community solar education; installer funnel optimization",
            "Yale School of the Environment energy policy",
        ),
        (
            "Enphase Energy",
            "Energy — Cleantech",
            "Public inverter/storage leader with installer channel marketing gaps.",
            "Installer partner enablement; homeowner decision journey",
            "",
        ),
        (
            "ChargePoint Holdings",
            "EV Infrastructure",
            "EV charging network competes on location intelligence and fleet partnerships.",
            "Campus and airport-adjacent charger demand modeling",
            "Yale sustainability office",
        ),
        (
            "Stem Inc.",
            "Energy — Storage",
            "Battery storage analytics vendor; data-heavy engagements mirror YUCG ops work.",
            "Commercial storage ROI storytelling; utility partnership cases",
            "",
        ),
        (
            "Arcadia",
            "Energy — Climate Platform",
            "Community solar and utility data platform; Gen-Z climate action alignment.",
            "Community solar enrollment drivers; utility API storytelling",
            "Yale Planetary Solutions",
        ),
        # Agriculture / Food
        (
            "Indigo Ag",
            "Agriculture Tech",
            "Ag carbon and biologicals need farmer AND consumer narrative work.",
            "Regenerative ag consumer messaging; supply chain traceability",
            "Yale School of the Environment food systems",
        ),
        (
            "Plenty Unlimited",
            "Agriculture Tech",
            "Vertical farming sells to retailers and cities; expansion market studies fit YUCG.",
            "Urban farm site selection; retailer produce category research",
            "",
        ),
        (
            "Impossible Foods",
            "Food & Beverage — Alt Protein",
            "Plant-based category retrenchment requires Gen-Z taste and price sensitivity work.",
            "Campus dining pilot metrics; flexitarian segmentation",
            "Yale dining sustainability",
        ),
        (
            "Oatly",
            "Food & Beverage — DTC",
            "Brand rebuilt around climate narrative; needs fresh Gen-Z creative testing.",
            "Brand perception recovery; campus sampling ROI",
            "",
        ),
        (
            "Chipotle Mexican Grill",
            "Food & Beverage — QSR",
            "Public QSR with Gen-Z loyalty and digital ordering core to growth story.",
            "Loyalty tier redesign; college market throughput",
            "Yale campus dining adjacency",
        ),
        # PropTech / Real Estate
        (
            "Zillow Group",
            "PropTech",
            "Housing affordability is top Gen-Z issue; Zillow has data partnership appetite.",
            "First-time buyer sentiment; rental search behavior",
            "Yale Economic Growth Center housing research",
        ),
        (
            "CoStar Group",
            "PropTech",
            "Commercial real estate data giant; analytics-heavy student teams match skillset.",
            "Office-to-residential conversion analytics; retail vacancy",
            "",
        ),
        (
            "Opendoor Technologies",
            "PropTech",
            "iBuying model needs local market narrative and consumer trust rebuild.",
            "Seller/buyer friction research; market-by-market playbook",
            "",
        ),
        (
            "WeWork",
            "PropTech",
            "Flexible workspace rebound targets founders and Gen-Z freelancers.",
            "Campus-to-coworking pipeline; hybrid work preferences",
            "Yale entrepreneurship societies",
        ),
        # Logistics / Supply Chain
        (
            "Flexport",
            "Logistics",
            "Digital freight forwarder with ops optimization and brand thought leadership needs.",
            "Shipper education content; SMB export enablement",
            "",
        ),
        (
            "Project44",
            "Logistics",
            "Supply chain visibility SaaS; data storytelling for enterprise sales.",
            "Visibility ROI cases; port disruption comms",
            "",
        ),
        (
            "FourKites",
            "Logistics",
            "Real-time supply chain platform expanding CPG and retail logos.",
            "OTIF improvement narratives; sustainability tracking",
            "",
        ),
        (
            "Lineage Logistics",
            "Logistics — Cold Chain",
            "Cold storage REIT/operator with network optimization consulting openings.",
            "Network density modeling; food waste reduction",
            "",
        ),
        # Cybersecurity
        (
            "CrowdStrike",
            "Cybersecurity",
            "Public cybersecurity leader with massive campus recruiting and brand presence.",
            "Cyber career path Gen-Z study; breach comms simulations",
            "Yale Law cyber policy",
        ),
        (
            "SentinelOne",
            "Cybersecurity",
            "Endpoint security growth needs mid-market narrative and vertical case studies.",
            "SMB security adoption barriers; MSP channel enablement",
            "",
        ),
        (
            "Wiz",
            "Cybersecurity",
            "Fastest-growing cloud security unicorn; partnership and market education phase.",
            "Cloud security posture storytelling; FinOps crossover",
            "",
        ),
        # Semiconductors / Hardware
        (
            "Astera Labs",
            "Semiconductors",
            "AI connectivity chips public co.; needs ecosystem partnership narratives.",
            "Hyperscaler attach storytelling; PCIe/CXL education",
            "",
        ),
        (
            "Arm Holdings",
            "Semiconductors",
            "CPU IP licensor with consumer brand gap vs. NVIDIA/Qualcomm.",
            "Edge AI device roadmap messaging; developer ecosystem",
            "Yale CS architecture seminars",
        ),
        (
            "GlobalFoundries",
            "Semiconductors",
            "US fab expansion tied to CHIPS Act; workforce and community narrative needs.",
            "Workforce pipeline storytelling; regional economic impact",
            "Connecticut manufacturing policy",
        ),
        # Space
        (
            "Rocket Lab USA",
            "Space — Launch",
            "Public small-launch provider expanding space systems; dual commercial/defense story.",
            "Launch cadence reliability marketing; space apps education",
            "",
        ),
        (
            "Planet Labs",
            "Space — Earth Observation",
            "Daily satellite imagery SaaS; climate and insurance vertical cases.",
            "Climate disclosure analytics; agriculture monitoring",
            "Yale carbon monitoring research",
        ),
        (
            "Astra Space (legacy assets)",
            "Space — Launch",
            "Restructured space assets need focused commercialization consulting.",
            "Spaceport economics; smallsat market entry",
            "",
        ),
        # Insurance / Insurtech
        (
            "Lemonade",
            "Insurtech",
            "AI-native insurer with Gen-Z renter and pet insurance growth.",
            "Renter insurance campus partnerships; claims UX research",
            "",
        ),
        (
            "Root Insurance",
            "Insurtech",
            "Telematics auto insurer rebuilding brand after volatility.",
            "Usage-based insurance Gen-Z adoption; pricing transparency",
            "",
        ),
        (
            "Oscar Health",
            "Insurtech",
            "Consumer health insurer with tech-forward member experience.",
            "Member app UX; ACA exchange marketing",
            "Yale health policy",
        ),
        # Wealth / Asset Management
        (
            "Betterment",
            "Wealth Tech",
            "Robo-advisor needs Gen-Z wealth-building narrative amid macro uncertainty.",
            "First-job financial wellness; IRA adoption on campus",
            "Yale SOM personal finance clubs",
        ),
        (
            "Wealthfront",
            "Wealth Tech",
            "Competes for young professionals; product differentiation research fits semester scope.",
            "Cash account vs. invest positioning; tax-loss harvesting education",
            "",
        ),
        (
            "Franklin Templeton (Digital Assets)",
            "Wealth — Asset Management",
            "Trad asset manager pushing tokenization and ETFs; needs education layer.",
            "ETF literacy among Gen-Z; tokenized fund messaging",
            "Yale SOM Irving Fisher asset mgmt",
        ),
        # Sports / Athleisure
        (
            "Peloton Interactive",
            "Fitness — Connected",
            "Turnaround brand must win Gen-Z creator partnerships and campus wellness.",
            "Campus recreation partnerships; creator-led class pilots",
            "Yale athletics wellness",
        ),
        (
            "Garmin Ltd.",
            "Wearables",
            "Endurance and outdoor wearables compete on community and Gen-Z adventure culture.",
            "Trail running campus ambassadors; esports crossover watches",
            "",
        ),
        (
            "Fanatics",
            "Sports — Commerce",
            "Sports merch monopoly expanding media and betting adjacency; Gen-Z core.",
            "College NIL merch analytics; loyalty program redesign",
            "Yale athletics licensing",
        ),
        (
            "DraftKings",
            "Sports — Gaming",
            "Public sportsbook with responsible gaming and Gen-Z acquisition balance.",
            "Responsible gaming messaging; state expansion playbook",
            "Yale Law gambling policy forums",
        ),
        # Rail / Transit expansion
        (
            "Brightline (Florida)",
            "Rail — Intercity",
            "Private intercity rail expanding; airport-rail intermodal narratives mirror aviation thesis.",
            "Station catchment modeling; student discount elasticity",
            "",
        ),
        (
            "Texas Central Partners",
            "Rail — High Speed",
            "High-speed rail project needs stakeholder and demand research.",
            "Corridor demand modeling; community benefit storytelling",
            "",
        ),
        (
            "Keolis North America",
            "Transit — Operator",
            "Transit operator for Boston/DC contracts; ops and rider experience consulting.",
            "Rider satisfaction segmentation; first-mile/last-mile",
            "Northeast corridor Yale commuter angle",
        ),
        # Water / Utilities
        (
            "American Water Works",
            "Utilities — Water",
            "Regulated water utility with infrastructure narrative and community trust needs.",
            "Rate case community engagement; lead pipe comms",
            "Connecticut water policy",
        ),
        (
            "Essential Utilities",
            "Utilities — Water",
            "Multi-state water/wastewater with M&A integration consulting openings.",
            "Post-merger customer comms; PFAS response playbook",
            "",
        ),
        # Museums / Cultural
        (
            "Smithsonian Institution",
            "Cultural — Museum",
            "National museum complex pursuing Gen-Z digital and on-site engagement.",
            "Gen-Z visitation drivers; digital collection UX",
            "Yale museums and digitization labs",
        ),
        (
            "MoMA (Museum of Modern Art)",
            "Cultural — Museum",
            "NYC museum with student membership and corporate partnership programs.",
            "Student membership funnel; corporate night sponsorship",
            "Yale Art Gallery cross-programming",
        ),
        (
            "American Alliance of Museums",
            "Cultural — Trade Association",
            "Trade body for museums; member orgs need shared Gen-Z research.",
            "Sector-wide Gen-Z visitation benchmark",
            "",
        ),
        # K-12 / Workforce
        (
            "Khan Academy",
            "EdTech — K-12",
            "Nonprofit ed giant with AI tutor rollout; impact measurement consulting.",
            "AI tutor efficacy messaging; district adoption playbook",
            "Yale Education Studies",
        ),
        (
            "Guild Education",
            "EdTech — Workforce",
            "Employer education benefits unicorn; needs ROI storytelling for HR buyers.",
            "Benefits enrollment UX; completion rate analytics",
            "",
        ),
        (
            "Handshake",
            "EdTech — Recruiting",
            "College recruiting platform; natural YUCG peer and partnership angle.",
            "Campus job search behavior; employer brand benchmarks",
            "Yale OCS and YUCG pipeline",
        ),
        # Chemicals / Materials
        (
            "Chemours Company",
            "Chemicals",
            "Public specialty chemicals with sustainability repositioning.",
            "PFAS transition comms; EV materials growth story",
            "Yale School of the Environment toxics research",
        ),
        (
            "Albemarle Corporation",
            "Materials — Lithium",
            "Lithium producer at center of EV supply chain; ESG and community narrative.",
            "Local community benefit cases; battery supply storytelling",
            "",
        ),
        # Nonprofit / NGO
        (
            "Doctors Without Borders USA",
            "Nonprofit — NGO",
            "Global health NGO with Gen-Z donor acquisition and digital fundraising focus.",
            "Donor journey optimization; crisis campaign A/B testing",
            "Yale global health societies",
        ),
        (
            "Environmental Defense Fund",
            "Nonprofit — Climate",
            "Major climate NGO with corporate partnerships and policy research overlap.",
            "Corporate partnership value cases; Gen-Z climate action segmentation",
            "Yale School of the Environment",
        ),
        (
            "International Rescue Committee",
            "Nonprofit — Humanitarian",
            "Refugee services org with data and ops improvement needs.",
            "Donor retention analytics; program outcome storytelling",
            "",
        ),
        # Telecom / Media infra
        (
            "Crown Castle",
            "Telecom — Infrastructure",
            "Cell tower/fiber REIT with 5G small cell urban deployment narrative.",
            "Municipal partnership playbook; coverage gap analytics",
            "",
        ),
        (
            "T-Mobile US",
            "Telecom",
            "Uncarrier brand leads Gen-Z wireless; campus plan and sponsorship angles.",
            "Campus plan elasticity; esports sponsorship ROI",
            "Yale esports and campus events",
        ),
        # Beauty / Personal Care
        (
            "e.l.f. Beauty",
            "Beauty D2C",
            "Public beauty brand winning on TikTok; continuous Gen-Z creative testing appetite.",
            "TikTok campaign lift studies; retailer shelf optimization",
            "",
        ),
        (
            "Glossier",
            "Beauty D2C",
            "DTC reboot needs community-led growth research.",
            "Community ambassador ROI; retail expansion city scoring",
            "",
        ),
        # Automotive (beyond existing single row)
        (
            "Rivian Automotive",
            "Automotive — EV",
            "EV truck/SUV maker with adventure Gen-Z brand and charging partnership needs.",
            "Adventure community segmentation; charging partnership city pairs",
            "Yale Outdoors crossover",
        ),
        (
            "Lucid Group",
            "Automotive — EV",
            "Luxury EV challenger needs differentiation and tech narrative work.",
            "Luxury EV buyer journey; fleet/commercial pilot",
            "",
        ),
        # Packaging / CPG
        (
            "Ball Corporation",
            "Packaging",
            "Aluminum packaging ESG story; beverage brand partnership research.",
            "Recyclability messaging; craft beverage can adoption",
            "",
        ),
        (
            "Clorox Company",
            "Consumer — CPG",
            "Portfolio spans Burt's Bees to cleaning; Gen-Z sub-brand strategies differ.",
            "Sub-brand Gen-Z segmentation; DTC trial conversion",
            "",
        ),
        # Private Equity / Professional Services
        (
            "TPG Inc.",
            "Private Equity",
            "Public PE firm with portfolio ops and ESG reporting needs across consumer assets.",
            "Portfolio company Gen-Z playbook; ESG stakeholder comms",
            "Yale SOM PE and VC clubs",
        ),
        (
            "Bain Capital",
            "Private Equity",
            "Multi-strategy firm with consumer and tech portfolio value-creation consulting.",
            "Commercial due diligence support; portfolio marketing sprints",
            "YUCG–Bain cross-recruiting network",
        ),
        (
            "McKinsey & Company — New Haven / Public Sector",
            "Consulting — Public Sector",
            "McKinsey public/social sector practice touches state governments including CT.",
            "State digital transformation; workforce development analytics",
            "Yale SOM and Jackson School",
        ),
        # Aviation gaps
        (
            "Gulfstream Aerospace",
            "Business Aviation",
            "Business jet OEM with sustainability and next-gen buyer research needs.",
            "Next-gen buyer demographics; SAF narrative for UHNW",
            "Yale aviation policy seminars",
        ),
        (
            "CAE Inc.",
            "Aviation — Training",
            "Pilot training giant with simulator network optimization and airline pipeline analytics.",
            "Training capacity modeling; airline pipeline forecasting",
            "",
        ),
        (
            "Viasat Inc.",
            "Aviation — Connectivity",
            "Inflight connectivity provider; airline passenger experience and Gen-Z Wi-Fi expectations.",
            "IFC passenger satisfaction; airline upsell packaging",
            "",
        ),
        (
            "Safran Seats",
            "Aerospace Supplier",
            "Aircraft seating OEM; airline cabin retrofit economics and passenger preference research.",
            "Retrofit ROI cases; Gen-Z seat preference studies",
            "",
        ),
        (
            "Collins Aerospace (RTX)",
            "Avionics",
            "Major avionics MRO and digital aviation stack; airline retrofit consulting.",
            "Retrofit business case library; connected aircraft analytics",
            "",
        ),
        (
            "StandardAero",
            "MRO",
            "Independent engine MRO with network expansion and airline RFP support needs.",
            "MRO turnaround time benchmarking; regional airline support packages",
            "",
        ),
        (
            "Air Lease Corporation",
            "Aircraft Leasing",
            "Public lessor with airline customer advisory and fleet transition analytics.",
            "Fleet transition advisory; ESG fleet reporting",
            "",
        ),
        (
            "Aviation Capital Group",
            "Aircraft Leasing",
            "Boeing captive lessor expanding advisory services to airline customers.",
            "Order book strategy support; narrowbody deployment analytics",
            "",
        ),
        (
            "Bamboo Airways",
            "Asian Hub",
            "Vietnamese carrier expanding US codeshare potential; route origination consulting.",
            "US-Vietnam diaspora demand; partnership route cases",
            "Yale Southeast Asia Society",
        ),
        (
            "Starlux Airlines",
            "Asian Hub",
            "Premium Taiwanese startup carrier with brand-building and US expansion research needs.",
            "US route launch business case; premium cabin Gen-Z aspirational study",
            "",
        ),
        (
            "Wizz Air Abu Dhabi",
            "Gulf Hub",
            "Gulf LCC joint venture with network and market development consulting openings.",
            "Hub feed strategy; expat worker route economics",
            "",
        ),
        (
            "Porter Airlines",
            "Canadian Airline",
            "Canadian regional-premium carrier expanding US Northeast service.",
            "Cross-border business traveler segmentation; Yale corridor demand",
            "Boston–New Haven–Toronto triangle",
        ),
        (
            "FlixBus North America",
            "Bus — Intercity",
            "Intercity bus disruptor; airport and campus shuttle partnership analytics.",
            "Campus-to-airport shuttle partnerships; pricing elasticity",
            "New Haven Tweed ground access",
        ),
        (
            "Greyhound Lines (Flix)",
            "Bus — Intercity",
            "National bus network under Flix; route and facility optimization consulting.",
            "Intermodal airport feed; rural connectivity cases",
            "",
        ),
        (
            "Enterprise Holdings — University Programs",
            "Car Rental",
            "Largest car rental with campus and insurance replacement segments.",
            "Campus rental partnerships; rideshare substitution research",
            "Yale move-in/move-out demand spikes",
        ),
        (
            "SIXT SE",
            "Car Rental",
            "Premium European rental expanding US Gen-Z lifestyle brand.",
            "Premium rental Gen-Z positioning; airport concession strategy",
            "",
        ),
        (
            "World Nomads",
            "Travel Insurance",
            "Adventure travel insurer with creator and study-abroad partnerships.",
            "Study-abroad insurance bundle; creator affiliate funnel",
            "Yale study abroad office",
        ),
        (
            "Allianz Partners — Travel",
            "Travel Insurance",
            "Major travel insurance underwriter for airlines and OTAs.",
            "Ancillary attach rate optimization; claims UX research",
            "",
        ),
        (
            "BCD Travel",
            "Corporate Travel",
            "Top TMC with sustainability and Gen-Z business traveler policy research.",
            "Gen-Z business travel policy; SAF booking nudges",
            "",
        ),
        (
            "American Express Global Business Travel",
            "Corporate Travel",
            "Public TMC (GBT) with data analytics and corporate client reporting.",
            "Travel program ROI dashboards; supplier negotiation support",
            "",
        ),
        (
            "Navan (TripActions)",
            "Corporate Travel",
            "Corporate travel/expense unicorn with PLG and enterprise crossover.",
            "SMB travel adoption; expense UX Gen-Z workforce",
            "",
        ),
        (
            "SABRE Corporation",
            "Aviation IT",
            "GDS/airline IT with airline retailing transformation consulting.",
            "NDC retailing roadmap; airline merchandising analytics",
            "",
        ),
        (
            "Amadeus IT Group",
            "Aviation IT",
            "Global travel IT with airline and airport digital transformation practice.",
            "Airport passenger flow analytics; airline offer optimization",
            "",
        ),
        (
            "Collins Aerospace ARINC",
            "Aviation IT",
            "Aviation messaging and airport IT; ops data consulting for airports.",
            "Airport ops dashboard; A-CDM analytics pilot",
            "Tweed airport ops parallel",
        ),
        (
            "Moody's Analytics — Travel & Tourism",
            "Aviation Analytics",
            "Economic analytics for tourism and aviation recovery forecasting.",
            "Tourism forecast models; airport catchment econometrics",
            "Yale Economic Growth Center",
        ),
        (
            "Cirium (LexisNexis)",
            "Aviation Data",
            "Aviation data standard for fleet and schedule analytics.",
            "Fleet utilization benchmarking; route performance dashboards",
            "",
        ),
        (
            "OAG Aviation",
            "Aviation Data",
            "Schedule and connectivity data provider; airline network consulting support.",
            "Connectivity index storytelling; slot utilization analytics",
            "",
        ),
        (
            "IATA",
            "Trade Association",
            "Global airline trade body; student research on SAF and Gen-Z traveler expectations.",
            "SAF passenger willingness-to-pay; digital identity adoption",
            "Yale climate policy",
        ),
        (
            "ACI World",
            "Trade Association",
            "Airports council; airport economics and passenger experience research.",
            "Airport non-aero revenue; passenger experience benchmarking",
            "",
        ),
        (
            "RAA (Regional Airline Association)",
            "Trade Association",
            "Core aviation thesis stakeholder; Embraer/E2 and regional ecosystem partner.",
            "Regional airline economic impact; pilot pipeline research",
            "Tweed/New Haven proof point",
        ),
    ]

    for item in under_covered:
        add(*item)

    return rows


def build_dataframe() -> pd.DataFrame:
    df = pd.read_excel(INPUT_PATH, sheet_name="YUCG Prospects")
    new_rows = new_company_rows()

    # Dedupe by company name
    existing = set(df["Company"].astype(str).str.strip())
    filtered = [r for r in new_rows if r["Company"] not in existing]

    additions = pd.DataFrame(filtered)
    combined = pd.concat([df, additions], ignore_index=True)

    enrichments = combined.apply(enrich_row, axis=1, result_type="expand")
    for col in NEW_COLUMNS:
        combined[col] = enrichments[col]

    # Reorder columns
    base_cols = [
        "Company",
        "Sector",
        "Why Attractive Prospect for YUCG",
        "Suggested Engagement Theme",
        "Yale / YUCG Hook",
    ]
    combined = combined[base_cols + NEW_COLUMNS]
    return combined, len(filtered)


def style_worksheet(ws, num_cols: int, num_rows: int) -> None:
    for col_idx in range(1, num_cols + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(wrap_text=True, vertical="center")

    widths = {
        1: 36,
        2: 28,
        3: 48,
        4: 36,
        5: 28,
        6: 14,
        7: 22,
        8: 32,
        9: 14,
        10: 28,
        11: 42,
        12: 38,
        13: 34,
    }
    for col_idx in range(1, num_cols + 1):
        ws.column_dimensions[get_column_letter(col_idx)].width = widths.get(col_idx, 24)

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(num_cols)}{num_rows}"


def build_readme(total_rows: int, new_rows_added: int, entertainment_count: int) -> list[list]:
    return [
        ["YUCG Prospect List — Generated for outreach planning"],
        [""],
        ["About this file"],
        ["Built for Yale Undergraduate Consulting Group (YUCG) business development."],
        ["Aligned with yaleconsulting.org services: marketing, entry/expansion, ops, data, Gen-Z research."],
        [""],
        ["Past / recent YUCG proof points referenced in descriptors:"],
        ["• Google, Delta, Uber, LinkedIn, Pfizer, Lyft, Turkish Airlines, City of New Haven"],
        ["• Fall 2025: Canva, Lyft, Turkish Airlines (2nd), New Haven CRM, Fortune 500 pharma (Gen-Z T1D), dbrand"],
        ["• Tweed-New Haven Airport (HVN) — ops data, student traveler capture"],
        [""],
        ["Primary thesis (aviation cluster):"],
        ["Connect regional aircraft OEMs (e.g., Embraer E2) to Boeing-dominated US regionals and secondary airports"],
        ["via route origination, fuel-burn/TCO marketing, and Yale-facilitated expert + student-market research."],
        [""],
        [f"Total prospects: {total_rows}"],
        [f"New rows added (June 2026 expansion): {new_rows_added}"],
        [f"Entertainment / media cluster rows: {entertainment_count}"],
        [
            "Columns: Company | Sector | Why Attractive | Suggested Theme | Yale/YUCG Hook | "
            "Outreach Priority | Contact Type | Target Role Title | Incentive Score | Score Rationale | "
            "Verification Source URL | Recommended First Message Angle | Contact Discovery Hint"
        ],
        [""],
        ["Outreach coordination notes:"],
        ["• Outreach Priority 1 = highest (Incentive Score typically 85+); 5 = nurture/long-cycle"],
        ["• Incentive Score weights: repeat-client potential, Yale hook, Gen-Z angle, verifiable contacts, semester-fit scope"],
        ["• Verification URLs are search templates and public pages — confirm contacts before outreach"],
        [""],
        ["Disclaimer: Descriptors are strategic hypotheses for outreach — verify current client conflicts and confidentiality before pitching."],
        [""],
        ["Entertainment / media cluster:"],
        ["Major studios, mini-majors/indie (A24, Neon, Blumhouse), streaming, exhibition (AMC, Cinemark, IMAX),"],
        ["production/talent shops, creator economy, festivals, gaming-to-film, music/Broadway, AI production tech."],
        ["June 2026 update adds role-specific exhibition/programming targets (AMC CEO vs programming, A24 acquisitions, etc.)"],
        ["Yale hooks: Film & Media Studies, School of Drama, Schwarzman Center, alumni in Hollywood."],
        ["Thesis: Gen-Z taste-making, YouTube-to-theatrical pipeline, indie disruption, exhibition recovery."],
        [""],
        ["Under-covered sectors expanded June 2026:"],
        ["Health tech, defense/govtech, energy/cleantech, ag/food, proptech, logistics, cybersecurity,"],
        ["semiconductors, space, insurtech, wealth tech, sports, rail/transit, utilities, museums, edtech/workforce,"],
        ["nonprofits, telecom, beauty D2C, automotive EV, packaging/CPG, PE, aviation gaps (MRO, leasing, IT, trade bodies)."],
    ]


def write_workbook(df: pd.DataFrame, path: Path, new_rows_added: int) -> None:
    entertainment_count = df["Sector"].astype(str).str.contains("Entertainment", case=False, na=False).sum()
    readme_rows = build_readme(len(df), new_rows_added, entertainment_count)

    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="YUCG Prospects", index=False)
        readme_df = pd.DataFrame(readme_rows)
        readme_df.to_excel(writer, sheet_name="README", index=False, header=False)

    wb = openpyxl.load_workbook(path)
    ws = wb["YUCG Prospects"]
    style_worksheet(ws, num_cols=len(df.columns), num_rows=len(df) + 1)

    readme_ws = wb["README"]
    readme_ws.column_dimensions["A"].width = 110
    for row in readme_ws.iter_rows(min_row=1, max_row=readme_ws.max_row, min_col=1, max_col=1):
        for cell in row:
            cell.alignment = Alignment(wrap_text=True, vertical="top")

    wb.save(path)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    df, new_count = build_dataframe()
    # Write backup first, then canonical (avoids partial overwrite if canonical is open)
    write_workbook(df, BACKUP_PATH, new_count)
    import shutil

    shutil.copy2(BACKUP_PATH, OUTPUT_PATH)

    top10 = df.nlargest(10, "Incentive Score")[
        ["Company", "Sector", "Incentive Score", "Outreach Priority", "Contact Type", "Score Rationale"]
    ]

    print(f"Total rows: {len(df)}")
    print(f"New rows added: {new_count}")
    print(f"New columns: {NEW_COLUMNS}")
    print("\nTop 10 by Incentive Score:")
    print(top10.to_string(index=False))


if __name__ == "__main__":
    main()
