"""
Analytics API - Intelligence Dashboard
"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter
from app.database import get_db

router = APIRouter()


@router.get("/dashboard")
async def get_dashboard():
    """Home dashboard metrics: active campaigns, contacts discovered, emails in queue."""
    db = await get_db()
    try:
        # Contacts discovered today
        cursor = await db.execute(
            """SELECT COUNT(*) as count FROM contacts 
               WHERE date(created_at) = date('now')"""
        )
        contacts_today = (await cursor.fetchone())["count"]

        # Emails in queue (pending)
        cursor = await db.execute(
            """SELECT COUNT(*) as count FROM campaign_contacts WHERE status = 'pending'"""
        )
        emails_queued = (await cursor.fetchone())["count"]

        # Active campaigns
        cursor = await db.execute(
            """SELECT COUNT(*) as count FROM campaigns WHERE status IN ('draft', 'sending')"""
        )
        active_campaigns = (await cursor.fetchone())["count"]

        # Sent / opened / replied (mock for MVP - can add tracking later)
        cursor = await db.execute(
            """SELECT 
                 COUNT(*) as total_sent,
                 SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
                 SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) as replied
               FROM campaign_contacts WHERE status = 'sent'"""
        )
        row = await cursor.fetchone()
        total_sent = row["total_sent"] or 0
        opened = row["opened"] or 0
        replied = row["replied"] or 0
        open_rate = (opened / total_sent * 100) if total_sent else 0
        reply_rate = (replied / total_sent * 100) if total_sent else 0

        return {
            "contacts_discovered_today": contacts_today,
            "emails_in_queue": emails_queued,
            "active_campaigns": active_campaigns,
            "total_sent": total_sent,
            "open_rate": round(open_rate, 1),
            "reply_rate": round(reply_rate, 1),
            "opened": opened,
            "replied": replied,
        }
    finally:
        await db.close()


@router.get("/campaigns/{campaign_id}/metrics")
async def get_campaign_metrics(campaign_id: int):
    """Per-campaign metrics."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT 
                 COUNT(*) as total,
                 SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
                 SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                 SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
                 SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) as replied
               FROM campaign_contacts WHERE campaign_id = ?""",
            (campaign_id,),
        )
        row = await cursor.fetchone()
        d = dict(row)
        total = d["total"] or 0
        sent = d["sent"] or 0
        d["open_rate"] = round((d["opened"] or 0) / sent * 100, 1) if sent else 0
        d["reply_rate"] = round((d["replied"] or 0) / sent * 100, 1) if sent else 0
        return d
    finally:
        await db.close()


@router.get("/due-follow-ups")
async def get_due_follow_ups_count():
    """Count campaign contacts whose next sequence step is due today (for dashboard widget)."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, sequence_id FROM campaigns WHERE sequence_id IS NOT NULL AND status = 'sent'"
        )
        campaigns = await cursor.fetchall()
        today = datetime.now(timezone.utc).date()
        count = 0
        for camp in campaigns:
            cursor = await db.execute(
                "SELECT days_after FROM follow_up_steps WHERE sequence_id = ? ORDER BY step_order, days_after",
                (camp["sequence_id"],),
            )
            steps = await cursor.fetchall()
            if not steps:
                continue
            cursor = await db.execute(
                """SELECT cc.id, cc.sequence_step_sent, cc.last_sequence_sent_at
                   FROM campaign_contacts cc
                   WHERE cc.campaign_id = ? AND cc.status = 'sent'
                     AND cc.sequence_step_sent < ? AND cc.last_sequence_sent_at IS NOT NULL""",
                (camp["id"], len(steps)),
            )
            for cc in await cursor.fetchall():
                step_idx = cc["sequence_step_sent"]
                days_after = steps[step_idx]["days_after"] or 0
                last_sent = cc["last_sequence_sent_at"]
                try:
                    if hasattr(last_sent, "date"):
                        last_date = last_sent.date()
                    else:
                        last_date = datetime.fromisoformat(str(last_sent).replace("Z", "+00:00")).date()
                except Exception:
                    continue
                due_date = last_date + timedelta(days=days_after)
                if due_date <= today:
                    count += 1
        return {"count": count}
    finally:
        await db.close()


@router.get("/time-series")
async def get_time_series(days: int = 30):
    """Daily counts of sent, opened, replied for the last N days (for charts)."""
    db = await get_db()
    try:
        cursor = await db.execute(
            f"""SELECT date(sent_at) as d,
                 COUNT(*) as sent,
                 SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
                 SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) as replied
               FROM campaign_contacts
               WHERE status = 'sent' AND sent_at IS NOT NULL AND date(sent_at) >= date('now', '-{days} days')
               GROUP BY date(sent_at)
               ORDER BY d"""
        )
        rows = await cursor.fetchall()
        by_date = {str(r["d"]): {"sent": r["sent"], "opened": r["opened"], "replied": r["replied"]} for r in rows}
        labels = []
        sent_list = []
        opened_list = []
        replied_list = []
        for i in range(days):
            d = (datetime.now(timezone.utc) - timedelta(days=days - 1 - i)).date().strftime("%Y-%m-%d")
            labels.append(d)
            row = by_date.get(d, {"sent": 0, "opened": 0, "replied": 0})
            sent_list.append(row["sent"])
            opened_list.append(row["opened"])
            replied_list.append(row["replied"])
        return {"labels": labels, "sent": sent_list, "opened": opened_list, "replied": replied_list}
    finally:
        await db.close()


@router.get("/export")
async def export_analytics_csv():
    """Export analytics summary as CSV (sent, opened, replied by day; campaign breakdown)."""
    from fastapi.responses import StreamingResponse
    import io
    import csv as csv_module

    db = await get_db()
    try:
        buf = io.StringIO()
        w = csv_module.writer(buf)
        w.writerow(["Metric", "Value"])
        cursor = await db.execute(
            """SELECT COUNT(*) as total_sent,
                 SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
                 SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) as replied
               FROM campaign_contacts WHERE status = 'sent'"""
        )
        row = await cursor.fetchone()
        total_sent = row["total_sent"] or 0
        opened = row["opened"] or 0
        replied = row["replied"] or 0
        w.writerow(["Total sent", total_sent])
        w.writerow(["Opened", opened])
        w.writerow(["Replied", replied])
        w.writerow(["Open rate %", round(opened / total_sent * 100, 1) if total_sent else 0])
        w.writerow(["Reply rate %", round(replied / total_sent * 100, 1) if total_sent else 0])
        w.writerow([])
        w.writerow(["Campaign", "Total", "Sent", "Opened", "Replied", "Open rate %", "Reply rate %"])
        cursor = await db.execute(
            """SELECT c.name, c.id,
                 COUNT(cc.id) as total,
                 SUM(CASE WHEN cc.status = 'sent' THEN 1 ELSE 0 END) as sent,
                 SUM(CASE WHEN cc.opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
                 SUM(CASE WHEN cc.replied_at IS NOT NULL THEN 1 ELSE 0 END) as replied
               FROM campaigns c
               LEFT JOIN campaign_contacts cc ON cc.campaign_id = c.id
               GROUP BY c.id"""
        )
        for r in await cursor.fetchall():
            sent = r["sent"] or 0
            open_rate = round((r["opened"] or 0) / sent * 100, 1) if sent else 0
            reply_rate = round((r["replied"] or 0) / sent * 100, 1) if sent else 0
            w.writerow([r["name"], r["total"], r["sent"], r["opened"], r["replied"], open_rate, reply_rate])
        buf.seek(0)
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=analytics_export.csv"},
        )
    finally:
        await db.close()


@router.get("/insights")
async def get_ai_insights():
    """AI-surfaced insights (plain-English observations). MVP: rule-based."""
    db = await get_db()
    try:
        insights = []
        cursor = await db.execute(
            """SELECT c.name, 
                 SUM(CASE WHEN cc.replied_at IS NOT NULL THEN 1 ELSE 0 END) as replied,
                 COUNT(*) as total
               FROM campaigns c
               JOIN campaign_contacts cc ON cc.campaign_id = c.id AND cc.status = 'sent'
               GROUP BY c.id"""
        )
        rows = await cursor.fetchall()
        for r in rows:
            if r["total"] and r["replied"]:
                rate = r["replied"] / r["total"] * 100
                insights.append(
                    f"Campaign '{r['name']}' has a {rate:.1f}% reply rate — above average."
                )
        if not insights:
            insights.append("Start by scraping contacts and generating personalized emails with AI.")
            insights.append("Add contacts to a campaign and review emails before sending.")
        return {"insights": insights[:5]}
    finally:
        await db.close()
