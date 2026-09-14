import { useState } from 'react';
import type { ContactRecommendation, ResearchCompany, ResearchJob, Project } from '../../api';
import { evidenceLabel, evidenceTime } from '../../lib/contactEvidence';
import { Button, ConfirmDialog, EmptyState, Notice, StatusBadge } from '../ui/Primitives';
import EvidenceDetails, { EvidenceSources } from './ContactEvidence';
import AudienceBriefForm from './AudienceBriefForm';

function statusTone(state?: string | null): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (['accepted', 'strong', 'strong_match', 'ready_to_review', 'completed'].includes(state || '')) return 'success';
  if (['needs_evidence', 'needs_review', 'possible', 'possible_match', 'queued', 'running', 'paused', 'partially_completed'].includes(state || '')) return 'warning';
  if (['excluded', 'failed', 'rejected', 'conflicted', 'former'].includes(state || '')) return 'danger';
  return 'neutral';
}

function ReviewField({ id, label, value, onChange, placeholder, required = false }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder: string; required?: boolean }) {
  return <div className="research-review-field">
    <label htmlFor={id}>{label}</label>
    <textarea id={id} rows={2} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} />
  </div>;
}

export function CompanyReview({ companies, onReview }: { companies: ResearchCompany[]; onReview: (company: ResearchCompany, disposition: 'accepted' | 'rejected', reason: string) => Promise<void> }) {
  if (!companies.length) return <EmptyState title="No company recommendations yet" body="Run research on a saved brief to recommend current companies with sources." />;
  return <ul className="research-companies">
    {companies.map((company) => <li key={company.id}>
      <h3>{company.name}<StatusBadge tone={statusTone(company.match_state)}>{evidenceLabel(company.match_state)}</StatusBadge><StatusBadge tone={statusTone(company.disposition)}>{company.disposition ? evidenceLabel(company.disposition) : 'Undecided'}</StatusBadge></h3>
      <p>{company.domain}</p>
      <p>{company.reason}</p>
      <p>Observed {evidenceTime(company.observed_at)}</p>
      {company.warnings.length > 0 && <ul className="research-warnings">{company.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      <EvidenceSources sources={company.sources} />
      <ReviewField id={`company-reason-${company.id}`} label="Accept or reject reason (recorded for later searches)" value="" onChange={() => undefined} placeholder="For example: subsidiary of an already-covered parent" />
      <div className="research-actions">
        <Button variant="secondary" onClick={async () => { const input = document.getElementById(`company-reason-${company.id}`) as HTMLTextAreaElement | null; await onReview(company, 'rejected', input?.value.trim() || 'Rejected without a reason'); }}>Reject</Button>
        <Button onClick={async () => { const input = document.getElementById(`company-reason-${company.id}`) as HTMLTextAreaElement | null; await onReview(company, 'accepted', input?.value.trim() || ''); }}>Accept</Button>
      </div>
    </li>)}
  </ul>;
}

export function JobRuns({ jobs, onAction }: { jobs: ResearchJob[]; onAction: (job: ResearchJob, action: 'resume' | 'cancel') => Promise<void> }) {
  if (!jobs.length) return <EmptyState title="No research runs" body="A run finds people for each accepted company. Runs survive leaving the page and restarts." />;
  return <ul className="research-jobs">
    {jobs.map((job) => <li key={job.id}>
      <h3>Run #{job.id}<StatusBadge tone={statusTone(job.status)}>{evidenceLabel(job.status)}</StatusBadge></h3>
      <p role="status" aria-live="polite">{job.completed_tasks} of {job.total_tasks} tasks · {job.people_count} people found{job.provider_state && job.provider_state !== 'not_started' ? ` · provider ${evidenceLabel(job.provider_state)}` : ''}</p>
      {job.error && <Notice tone="danger">{job.error.replaceAll('_', ' ')} Saved results are kept. Retry or continue from this list.</Notice>}
      <p>Created {evidenceTime(job.created_at)}</p>
      <div className="research-actions">
        {['paused', 'partially_completed'].includes(job.status) && <Button variant="secondary" onClick={() => onAction(job, 'resume')}>Resume</Button>}
        {['queued', 'running', 'paused'].includes(job.status) && <Button variant="danger" onClick={() => onAction(job, 'cancel')}>Cancel</Button>}
      </div>
    </li>)}
  </ul>;
}

export default function RecommendationInbox({
  brief, recommendations, projects, onReview, onBriefSave,
}: {
  brief: { id?: number; project_id?: number | null; name: string; spec: Parameters<typeof AudienceBriefForm>[0]['brief'] extends { spec: infer S } | null ? S : never } | null;
  recommendations: ContactRecommendation[];
  projects: Project[];
  onReview: (recommendation: ContactRecommendation, disposition: 'accepted' | 'rejected', reason: string) => Promise<ContactRecommendation | null>;
  onBriefSave: (brief: { id?: number; project_id: number | null; name: string; spec: Parameters<typeof AudienceBriefForm>[0]['brief'] extends { spec: infer S } | null ? S : never }) => void;
}) {
  const [queue, setQueue] = useState<'ready_to_review' | 'needs_evidence' | 'excluded'>('ready_to_review');
  const [selected, setSelected] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [confirmReject, setConfirmReject] = useState<ContactRecommendation | null>(null);
  const [drawer, setDrawer] = useState<ContactRecommendation | null>(null);
  const queues = { ready_to_review: [], needs_evidence: [], excluded: [] } as Record<'ready_to_review' | 'needs_evidence' | 'excluded', ContactRecommendation[]>;
  for (const recommendation of recommendations) (queues[recommendation.state] || queues.needs_evidence).push(recommendation);
  const current = queues[queue];

  return <div className="research-inbox">
    <AudienceBriefForm projects={projects} brief={brief} busy={false} onSave={onBriefSave} />
    <div role="tablist" aria-label="Recommendation queues">
      {(['ready_to_review', 'needs_evidence', 'excluded'] as const).map((id) => <button key={id} role="tab" aria-selected={queue === id} type="button" className={`research-queue-tab ${queue === id ? 'research-queue-tab--active' : ''}`} onClick={() => setQueue(id)}>{evidenceLabel(id)} ({queues[id].length})</button>)}
    </div>
    {current.length === 0 ? <EmptyState title={`No ${evidenceLabel(queue).toLowerCase()} recommendations`} body={queue === 'ready_to_review' ? 'Accepted companies with supported people appear here when research completes.' : queue === 'needs_evidence' ? 'People with incomplete or contradictory evidence appear here.' : 'Generic addresses, duplicates, and rejected people appear here with the reason.'} /> : <ul className="research-recommendations">
      {current.map((recommendation) => <li key={recommendation.id} className="research-card">
        <h3>{recommendation.person.name} — {recommendation.person.company || 'Company unknown'}</h3>
        <p>{recommendation.person.title || 'Role not recorded'}</p>
        <p>{recommendation.email ? <a href={`mailto:${recommendation.email}`}>{recommendation.email}</a> : 'No address proposed yet'}</p>
        <ul className="research-dimensions-inline">
          <li>{evidenceLabel(recommendation.evidence.identity)}</li>
          <li>{evidenceLabel(recommendation.evidence.mailbox)}</li>
          <li>{evidenceLabel(recommendation.evidence.address_origin)}</li>
        </ul>
        <p>{recommendation.explanation || 'No explanation recorded.'}</p>
        <p>Suggested from public sources and automated checks. Review the evidence before outreach.</p>
        <div className="research-actions">
          <Button variant="secondary" onClick={() => setDrawer(recommendation)}>View evidence</Button>
          {recommendation.contact_id != null && <a className="ui-button ui-button--primary" href={`/studio?contact_id=${recommendation.contact_id}`}>Open member draft</a>}
          {recommendation.state !== 'excluded' && recommendation.disposition !== 'accepted' && <Button onClick={() => { setSelected(recommendation.id); }}>Accept</Button>}
          {recommendation.disposition !== 'rejected' && <Button variant="danger" onClick={() => setConfirmReject(recommendation)}>Reject</Button>}
        </div>
        {selected === recommendation.id && <form className="research-review-form" onSubmit={async (event) => {
          event.preventDefault();
          const updated = await onReview(recommendation, 'accepted', reason.trim() || 'Accepted without a reason');
          setSelected(null); setReason('');
          if (updated?.contact_id != null) window.location.href = `/studio?contact_id=${updated.contact_id}`;
        }}>
          <ReviewField id="accept-reason" label="Accept reason" value={reason} onChange={setReason} placeholder="For example: operations lead matches the brief" />
          <Button type="submit">Accept into contacts</Button>
        </form>}
      </li>)}
    </ul>}
    {confirmReject && <ConfirmDialog
      open title="Reject this recommendation?" body={<>
        <p>{confirmReject.person.name} moves to the excluded queue with your reason. Later research can still propose the person if new public evidence appears.</p>
        <ReviewField id="reject-reason" label="Reject reason" value={reason} onChange={setReason} placeholder="For example: former employee" required />
      </>} confirmLabel="Reject recommendation" danger busy={false}
      onClose={() => { setConfirmReject(null); setReason(''); }}
      onConfirm={async () => { await onReview(confirmReject, 'rejected', reason.trim() || 'Rejected without a reason'); setConfirmReject(null); setReason(''); }}
    />}
    {drawer && <div className="ui-dialog-root" role="presentation">
      <button className="ui-dialog-backdrop" aria-label="Close evidence drawer" onClick={() => setDrawer(null)} />
      <section className="ui-dialog research-drawer" role="dialog" aria-modal="true" aria-labelledby="research-drawer-title">
        <h2 id="research-drawer-title">Evidence for {drawer.person.name}</h2>
        <EvidenceDetails evidence={drawer.evidence} />
        <div className="ui-dialog__actions">
          <Button variant="secondary" onClick={() => setDrawer(null)}>Close</Button>
          {drawer.contact_id != null && <a className="ui-button ui-button--primary" href={`/studio?contact_id=${drawer.contact_id}`}>Open member draft</a>}
        </div>
      </section>
    </div>}
  </div>;
}
