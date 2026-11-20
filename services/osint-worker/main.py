import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Literal, Optional

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
import httpx
from pydantic import BaseModel, Field

from embeddings import embed_text, to_pgvector_literal
from sherlock_runner import run_sherlock
from web_scour import scour_web_mentions

app = FastAPI(title="NoDitto OSINT Enrichment Worker", version="1.0.0")


class CheckJobRequest(BaseModel):
    runId: str
    targetKind: Literal["PROFILE", "CLAIM", "HANDLE", "PERSON_NAME"]
    targetKey: str
    subjectProfileId: Optional[str] = None
    subjectClaimId: Optional[str] = None
    handle: Optional[str] = None
    candidateHandles: List[str] = Field(default_factory=list)
    queryName: Optional[str] = None
    queryLocation: Optional[str] = None


def _require_auth(authorization: Optional[str]) -> None:
    expected = os.getenv("OSINT_WORKER_SECRET", "").strip()
    if not expected:
        return
    if not authorization or authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def _supabase_headers() -> Dict[str, str]:
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not key:
        raise RuntimeError("Missing SUPABASE_SERVICE_ROLE_KEY")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept-Profile": "cardtrade",
        "Content-Profile": "cardtrade",
        "Content-Type": "application/json",
    }


def _supabase_base() -> str:
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "").strip().rstrip("/")
    if not url:
        raise RuntimeError("Missing NEXT_PUBLIC_SUPABASE_URL")
    return f"{url}/rest/v1"


async def _patch_run(run_id: str, patch: Dict) -> None:
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.patch(
            f"{_supabase_base()}/identity_check_runs?id=eq.{run_id}",
            headers={**_supabase_headers(), "Prefer": "return=minimal"},
            json={**patch, "updated_at": datetime.now(timezone.utc).isoformat()},
        )
        res.raise_for_status()


async def _get_run_sources(run_id: str) -> Dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.get(
            f"{_supabase_base()}/identity_check_runs?select=sources_status&id=eq.{run_id}&limit=1",
            headers=_supabase_headers(),
        )
        if res.is_success:
            rows = res.json()
            if rows:
                return rows[0].get("sources_status") or {}
    return {}


async def _insert_signals(rows: List[Dict]) -> None:
    if not rows:
        return
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.post(
            f"{_supabase_base()}/osint_signals",
            headers={**_supabase_headers(), "Prefer": "return=minimal"},
            json=rows,
        )
        res.raise_for_status()


async def _upsert_graph_edges(edges: List[Dict]) -> None:
    if not edges:
        return
    async with httpx.AsyncClient(timeout=10.0) as client:
        await client.post(
            f"{_supabase_base()}/entity_graph_edges?on_conflict=from_kind,from_key,to_kind,to_key,edge_type",
            headers={**_supabase_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"},
            json=edges,
        )


async def _upsert_embedding(row: Dict) -> None:
    async with httpx.AsyncClient(timeout=10.0) as client:
        await client.post(
            f"{_supabase_base()}/reference_dossier_embeddings?on_conflict=subject_key,subject_kind,content_hash",
            headers={**_supabase_headers(), "Prefer": "resolution=ignore-duplicates,return=minimal"},
            json=row,
        )


async def _execute_job(job: CheckJobRequest) -> None:
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(days=7)).isoformat()
    sources = await _get_run_sources(job.runId)
    sources["sherlock"] = "running"
    sources["webSearch"] = "running"
    await _patch_run(job.runId, {"status": "RUNNING", "sources_status": sources})

    try:
        sherlock_tasks = []
        if job.handle:
            sherlock_tasks.append(
                run_sherlock(job.handle, curated_only=True, confidence="MEDIUM", timeout_sec=18)
            )
            if job.candidateHandles:
                sherlock_tasks.append(
                    run_sherlock(
                        job.candidateHandles[0],
                        curated_only=True,
                        confidence="LOW",
                        timeout_sec=12,
                    )
                )
        elif job.candidateHandles:
            for candidate in job.candidateHandles[:2]:
                sherlock_tasks.append(
                    run_sherlock(candidate, curated_only=True, confidence="LOW", timeout_sec=12)
                )

        web_subject = job.handle or job.queryName or ""
        web_task = scour_web_mentions(
            web_subject,
            location=job.queryLocation,
            is_person_name=(job.targetKind == "PERSON_NAME" and not job.handle),
        )

        sherlock_results_list, web_mentions = await asyncio.gather(
            asyncio.gather(*sherlock_tasks, return_exceptions=True)
            if sherlock_tasks
            else asyncio.sleep(0, result=[]),
            web_task,
        )

        sherlock_matches: List[Dict] = []
        seen_sherlock = set()
        if isinstance(sherlock_results_list, list):
            for entry in sherlock_results_list:
                if isinstance(entry, list):
                    for match in entry:
                        dedupe_key = (
                            (match.get("site") or "").strip().lower(),
                            (match.get("url") or "").strip().lower().rstrip("/"),
                        )
                        if dedupe_key in seen_sherlock:
                            continue
                        seen_sherlock.add(dedupe_key)
                        sherlock_matches.append(match)

        signal_rows: List[Dict] = []
        edge_rows: List[Dict] = []
        from_kind = "PROFILE" if job.subjectProfileId else "CLAIM" if job.subjectClaimId else "HANDLE"
        from_key = job.targetKey

        for m in sherlock_matches:
            signal_rows.append(
                {
                    "run_id": job.runId,
                    "target_key": job.targetKey,
                    "subject_profile_id": job.subjectProfileId,
                    "subject_claim_id": job.subjectClaimId,
                    "source": "SHERLOCK",
                    "signal_kind": "SHERLOCK_MATCH",
                    "external_platform": m["site"],
                    "external_handle": m["handle"],
                    "external_url": m["url"],
                    "confidence": m["confidence"],
                    "risk_flag": "NONE",
                    "title": f"{m['site']} (@{m['handle']})",
                    "snippet": f"Public username match on {m['site']} ({m['category']}).",
                    "payload": {"category": m["category"]},
                    "observed_at": now.isoformat(),
                    "expires_at": expires_at,
                }
            )
            edge_rows.append(
                {
                    "from_kind": from_kind,
                    "from_key": from_key,
                    "to_kind": "OSINT_SIGNAL",
                    "to_key": f"sherlock:{m['site'].lower()}:{m['handle'].lower()}",
                    "edge_type": "SAME_HANDLE_CANDIDATE",
                    "verified": False,
                    "weight": 0.45 if m["confidence"] == "MEDIUM" else 0.25,
                    "metadata": {"site": m["site"], "url": m["url"], "category": m["category"]},
                }
            )

        for w in web_mentions:
            is_warning = w.get("riskFlag") == "WARNING"
            signal_rows.append(
                {
                    "run_id": job.runId,
                    "target_key": job.targetKey,
                    "subject_profile_id": job.subjectProfileId,
                    "subject_claim_id": job.subjectClaimId,
                    "source": "WEB_SEARCH",
                    "signal_kind": "SCAM_ALERT_MENTION" if is_warning else "WEB_MENTION",
                    "external_platform": w.get("sourceLabel"),
                    "external_handle": job.handle or job.queryName,
                    "external_url": w.get("url"),
                    "confidence": w.get("confidence", "LOW"),
                    "risk_flag": w.get("riskFlag", "NONE"),
                    "title": w.get("title"),
                    "snippet": w.get("snippet"),
                    "payload": {"sourceLabel": w.get("sourceLabel")},
                    "observed_at": now.isoformat(),
                    "expires_at": expires_at,
                }
            )
            edge_rows.append(
                {
                    "from_kind": from_kind,
                    "from_key": from_key,
                    "to_kind": "OSINT_SIGNAL",
                    "to_key": f"web:{w.get('url', '')[:200]}",
                    "edge_type": "WEB_MENTION_OF",
                    "verified": False,
                    "weight": 0.7 if is_warning else 0.4,
                    "metadata": {"riskFlag": w.get("riskFlag"), "title": w.get("title")},
                }
            )

            emb_text = " · ".join(
                p for p in [job.handle or job.queryName, job.queryLocation, w.get("title"), w.get("snippet")] if p
            )
            vec, model_name = await embed_text(emb_text)
            await _upsert_embedding(
                {
                    "subject_key": job.targetKey,
                    "subject_kind": "WEB_MENTION",
                    "platform": w.get("sourceLabel"),
                    "handle_or_name": (job.handle or job.queryName or "unknown")[:160],
                    "location_hint": job.queryLocation[:120] if job.queryLocation else None,
                    "source_url": w.get("url"),
                    "content_text": emb_text[:4000],
                    "metadata": {"riskFlag": w.get("riskFlag"), "model": model_name},
                    "embedding": to_pgvector_literal(vec),
                }
            )

        await _insert_signals(signal_rows)
        await _upsert_graph_edges(edge_rows)

        sources["sherlock"] = "done" if sherlock_tasks else "skipped"
        sources["webSearch"] = "done"
        await _patch_run(job.runId, {"status": "COMPLETED", "sources_status": sources})
    except Exception as exc:
        sources["sherlock"] = "failed"
        sources["webSearch"] = "failed"
        await _patch_run(
            job.runId,
            {
                "status": "FAILED",
                "sources_status": sources,
                "error_message": str(exc)[:450],
            },
        )


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/jobs/check", status_code=202)
async def enqueue_check(
    job: CheckJobRequest,
    background_tasks: BackgroundTasks,
    authorization: Optional[str] = Header(default=None),
) -> Dict[str, str]:
    _require_auth(authorization)
    background_tasks.add_task(_execute_job, job)
    return {"accepted": "true", "runId": job.runId}
