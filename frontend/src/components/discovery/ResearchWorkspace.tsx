import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type AudienceSpec, type ContactRecommendation, type Project, type ResearchBrief, type ResearchCompany, type ResearchJob } from '../../api';
import { Button, Notice, StatusBadge } from '../ui/Primitives';
import RecommendationInbox from './RecommendationReview';

type Brief = { id?: number; project_id?: number | null; name: string; spec: AudienceSpec };

function usePolling(load: () => Promise<void>, active: boolean, ms = 4000) {
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(load, ms);
    return () => window.clearInterval(id);
  }, [load, active, ms]);
}

export default function ResearchWorkspace({ projects }: { projects: Project[] }) {
  const [briefs, setBriefs] = useState<ResearchBrief[]>([]);
  const [selectedBrief, setSelectedBrief] = useState<ResearchBrief | null>(null);
  const [companies, setCompanies] = useState<ResearchCompany[]>([]);
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [recommendations, setRecommendations] = useState<ContactRecommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [researching, setResearching] = useState(false);

  const loadBriefs = useCallback(async () => {
    try {
      const { items } = await api.research.briefs();
      setBriefs(items);
      if (items.length && !selectedBrief) setSelectedBrief(items[0]);
      else {
        const current = items.find((item) => item.id === selectedBrief?.id);
        if (current) setSelectedBrief(current);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Research briefs are unavailable right now.'); }
  }, [selectedBrief]);

  const loadState = useCallback(async () => {
    if (!selectedBrief) return;
    try {
      const [companyPage, jobPage, recommendationPage] = await Promise.all([
        api.research.companies(selectedBrief.id),
        api.research.jobs(),
        api.research.recommendations(selectedBrief.id),
      ]);
      setCompanies(companyPage.items.filter((company) => company.brief_id === selectedBrief.id));
      setJobs(jobPage.items.filter((job) => job.brief_id === selectedBrief.id));
      setRecommendations(recommendationPage.items.filter((recommendation) => recommendation.brief_id === selectedBrief.id));
    } catch (e) { setError(e instanceof Error ? e.message : 'Research results are unavailable right now.'); }
  }, [selectedBrief]);

  useEffect(() => { loadBriefs(); }, []);
  useEffect(() => { if (selectedBrief) loadState(); }, [selectedBrief?.id]);
  usePolling(loadState, jobs.some((job) => ['queued', 'running', 'paused'].includes(job.status)) || researching, 5000);

  const saveBrief = async (brief: Brief) => {
    setBusy(true); setError(null);
    try {
      const saved = await api.research.saveBrief({ project_id: brief.project_id ?? null, name: brief.name, spec: brief.spec }, brief.id);
      await loadBriefs(); setSelectedBrief(saved); setInfo('Brief saved. Recommendations stay scoped to this brief.');
    } catch (e) { setError(e instanceof Error ? e.message : 'The brief could not be saved.'); } finally { setBusy(false); }
  };

  const runCompanyResearch = async () => {
    if (!selectedBrief) return;
    setResearching(true); setError(null); setInfo(null);
    try {
      const { items } = await api.research.researchCompanies(selectedBrief.id);
      setCompanies(items); setInfo(`Company research finished with ${items.length} recommendation(s).`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Company research is unavailable right now.'); } finally { setResearching(false); }
  };

  const reviewCompany = async (company: ResearchCompany, disposition: 'accepted' | 'rejected', reason: string) => {
    setError(null);
    try {
      await api.research.reviewCompany(company.id, disposition, reason);
      await loadState();
      if (disposition === 'accepted') setInfo(`${company.name} accepted. Start a research run to find people.`);
      else setInfo(`${company.name} rejected. Future searches keep this reason unless new evidence appears.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'The company review could not be saved.'); }
  };

  const startJob = async () => {
    if (!selectedBrief) return;
    setBusy(true); setError(null);
    try {
      await api.research.start(selectedBrief.id);
      await loadState(); setInfo('Research run started. You can leave this page; progress is saved.');
    } catch (e) { setError(e instanceof Error ? e.message : 'The research run could not start.'); } finally { setBusy(false); }
  };

  const jobAction = async (job: ResearchJob, action: 'resume' | 'cancel') => {
    setError(null);
    try {
      await api.research.jobAction(job.id, action);
      await loadState(); setInfo(action === 'cancel' ? 'Run cancelled. Saved people and companies remain.' : 'Run resumed.');
    } catch (e) { setError(e instanceof Error ? e.message : 'The run action could not be applied.'); }
  };

  const reviewRecommendation = async (recommendation: ContactRecommendation, disposition: 'accepted' | 'rejected', reason: string): Promise<ContactRecommendation | null> => {
    try {
      const updated = await api.research.review(recommendation.id, disposition, reason);
      await loadState();
      return updated;
    } catch (e) { setError(e instanceof Error ? e.message : 'The recommendation review could not be saved.'); return null; }
  };

  const editableBrief = useMemo(() => selectedBrief ? { id: selectedBrief.id, project_id: selectedBrief.project_id, name: selectedBrief.name, spec: selectedBrief.spec } : null, [selectedBrief]);
  const exhausted = jobs.some((job) => job.provider_state === 'exhausted');
  const outage = jobs.some((job) => job.provider_state === 'unavailable');

  return <div className="research-workspace space-y-6">
    {error && <Notice tone="danger">{error}</Notice>}
    {info && <Notice tone="success">{info}</Notice>}
    {exhausted && <Notice tone="warning">External validation credits are used up for today. Local evidence is saved, and checking resumes tomorrow. No paid provider is ever used automatically.</Notice>}
    {outage && <Notice tone="warning">A research provider is unreachable right now. Saved results are kept, and the run pauses instead of losing work.</Notice>}
    {briefs.length > 0 && <div className="research-brief-select">
      <label htmlFor="brief-select">Audience brief</label>
      <select id="brief-select" value={selectedBrief?.id ?? ''} onChange={(event) => setSelectedBrief(briefs.find((brief) => brief.id === Number(event.target.value)) || null)}>
        {briefs.map((brief) => <option key={brief.id} value={brief.id}>{brief.name}</option>)}
      </select>
      <Button onClick={runCompanyResearch} disabled={researching || !selectedBrief}>{researching ? 'Researching…' : 'Research current companies'}</Button>
      <Button variant="secondary" onClick={startJob} disabled={busy || !selectedBrief}>Find people</Button>
    </div>}
    <RecommendationInbox brief={editableBrief} recommendations={recommendations} projects={projects} onReview={reviewRecommendation} onBriefSave={saveBrief} />
    <section aria-labelledby="research-companies-title">
      <h2 id="research-companies-title">Company recommendations</h2>
      <CompanyList companies={companies} onReview={reviewCompany} />
    </section>
    <section aria-labelledby="research-runs-title">
      <h2 id="research-runs-title">Research runs</h2>
      <RunList jobs={jobs} onAction={jobAction} />
    </section>
  </div>;
}

function CompanyList({ companies, onReview }: { companies: ResearchCompany[]; onReview: (company: ResearchCompany, disposition: 'accepted' | 'rejected', reason: string) => Promise<void> }) {
  const [reasons, setReasons] = useState<Record<number, string>>({});
  if (!companies.length) return <p>No company recommendations yet. Save a brief and run research to see current companies with sources.</p>;
  return <ul className="research-companies"> {companies.map((company) => <li key={company.id}>
    <h3>{company.name} <StatusBadge tone={company.match_state === 'strong_match' ? 'success' : company.match_state === 'needs_review' ? 'warning' : 'info'}>{company.match_state.replaceAll('_', ' ')}</StatusBadge>{company.disposition && <StatusBadge tone={company.disposition === 'accepted' ? 'success' : 'danger'}>{company.disposition}</StatusBadge>}</h3>
    <p>{company.domain}</p>
    <p>{company.reason}</p>
    {company.warnings.length > 0 && <ul>{company.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    {company.sources.length > 0 && <ul>{company.sources.map((source, index) => <li key={index}><a href={source.url} target="_blank" rel="noopener noreferrer">{new URL(source.url).hostname}</a> · {source.excerpt || 'No excerpt'}</li>)}</ul>}
    <label htmlFor={`company-review-${company.id}`}>Review reason</label>
    <textarea id={`company-review-${company.id}`} rows={2} value={reasons[company.id] || ''} onChange={(event) => setReasons((current) => ({ ...current, [company.id]: event.target.value }))} placeholder="For example: subsidiary of a company already covered" />
    <div className="research-actions">
      <Button variant="secondary" onClick={() => onReview(company, 'rejected', reasons[company.id]?.trim() || 'Rejected without a reason')}>Reject</Button>
      <Button onClick={() => onReview(company, 'accepted', reasons[company.id]?.trim() || '')}>Accept</Button>
    </div>
  </li>)}</ul>;
}

function RunList({ jobs, onAction }: { jobs: ResearchJob[]; onAction: (job: ResearchJob, action: 'resume' | 'cancel') => Promise<void> }) {
  if (!jobs.length) return <p>No research runs yet. Runs survive leaving this page and application restarts.</p>;
  return <ul className="research-jobs">{jobs.map((job) => <li key={job.id}>
    <h3>Run #{job.id} <StatusBadge tone={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'danger' : 'warning'}>{job.status.replaceAll('_', ' ')}</StatusBadge></h3>
    <p role="status" aria-live="polite">{job.completed_tasks} of {job.total_tasks} tasks done · {job.people_count} people found{job.provider_state && job.provider_state !== 'not_started' ? ` · provider ${job.provider_state.replaceAll('_', ' ')}` : ''}</p>
    {job.error && <p className="research-error">{job.error.replaceAll('_', ' ')} Saved results are kept.</p>}
    <div className="research-actions">
      {['paused', 'partially_completed'].includes(job.status) && <Button variant="secondary" onClick={() => onAction(job, 'resume')}>Resume</Button>}
      {['queued', 'running', 'paused'].includes(job.status) && <Button variant="danger" onClick={() => onAction(job, 'cancel')}>Cancel</Button>}
    </div>
  </li>)}</ul>;
}
