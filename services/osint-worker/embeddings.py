import hashlib
import math
import os
import re
from typing import List, Tuple

import httpx

EMBEDDING_DIMS = 512


def deterministic_embedding_512(raw_text: str) -> List[float]:
    """
    Deterministic 512-dim unit-normalized feature-hashing vector over word tokens
    and character 3-grams. Matches `deterministicEmbedding512` in TypeScript.
    """
    vec = [0.0] * EMBEDDING_DIMS
    text = re.sub(r"\s+", " ", (raw_text or "").strip().lower())
    if not text:
        return vec

    def add_feature(feature: str, weight: float) -> None:
        digest = hashlib.sha256(feature.encode("utf-8")).digest()
        bucket = ((digest[0] << 8) | digest[1]) % EMBEDDING_DIMS
        sign = 1.0 if (digest[2] & 1) == 0 else -1.0
        vec[bucket] += sign * weight

    tokens = [t for t in re.split(r"[^a-z0-9@._-]+", text) if len(t) >= 2]
    for token in tokens:
        add_feature(f"tok:{token}", 2.0)
        if len(token) >= 3:
            padded = f"^{token}$"
            for i in range(len(padded) - 2):
                add_feature(f"tri:{padded[i:i + 3]}", 1.0)

    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [round(v / norm, 6) for v in vec]


async def embed_text(text: str) -> Tuple[List[float], str]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if api_key:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "text-embedding-3-small",
                        "input": text[:4000],
                        "dimensions": EMBEDDING_DIMS,
                    },
                )
                if res.is_success:
                    data = res.json()
                    emb = (data.get("data") or [{}])[0].get("embedding")
                    if isinstance(emb, list) and len(emb) == EMBEDDING_DIMS:
                        return emb, "openai:text-embedding-3-small-512"
        except Exception:
            pass

    return deterministic_embedding_512(text), "local:trigram-hash-512"


def to_pgvector_literal(vec: List[float]) -> str:
    return "[" + ",".join(str(v) for v in vec) + "]"
