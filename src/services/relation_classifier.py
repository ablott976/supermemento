from typing import Sequence

from anthropic import AsyncAnthropic
from pydantic import BaseModel, Field

from src.config import AppConfig
from src.db.neo4j_client import Neo4jClient
from src.services.embedding import EmbeddingService
from src.services.forgetting import ForgettingService
from src.types.enums import MemoryType, RelationType
from src.types.models import Memory


class RelationClassification(BaseModel):
    existing_memory_id: str = Field(..., alias="existingMemoryId")
    relation_type: str = Field(..., alias="relationType")
    confidence: float
    derived_fact: str | None = Field(None, alias="derivedFact")


class ClassificationResponse(BaseModel):
    relations: list[RelationClassification]


CLASSIFICATION_SYSTEM_PROMPT = """Eres un clasificador de relaciones entre memorias. Dado un NUEVO HECHO y una lista de HECHOS EXISTENTES, determina para cada par qué relación aplica. Responde SOLO en JSON. Relaciones posibles: - UPDATE (el nuevo contradice/reemplaza el existente) - EXTEND (el nuevo añade detalle sin contradecir) - DERIVE (se puede inferir un nuevo hecho de la combinación) - NONE (no hay relación significativa) Para UPDATE: el nuevo hecho debe contradecir directamente el existente. Ejemplo: 'trabaja en Google' -> 'trabaja en Stripe'. Para EXTEND: el nuevo hecho añade información al mismo tema. Ejemplo: 'trabaja en Stripe' -> 'lidera equipo de pagos en Stripe'. Para DERIVE: la combinación de hechos permite inferir algo nuevo. Ejemplo: 'es PM en Stripe' + 'habla frecuentemente de APIs de pago' -> 'probablemente trabaja en el producto core de pagos de Stripe'. Responde con: {relations: [{existingMemoryId, relationType, confidence, derivedFact?}]}"""


class RelationClassifierService:
    """Service that classifies and applies intelligent relations for new memories."""

    def __init__(
        self,
        config: AppConfig,
        neo4j_client: Neo4jClient,
        embedding_service: EmbeddingService,
        forgetting_service: ForgettingService,
    ):
        self.anthropic = AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)
        self.model = config.ANTHROPIC_MODEL
        self.neo4j_client = neo4j_client
        self.embedding_service = embedding_service
        self.forgetting_service = forgetting_service

    async def classify_and_apply(
        self, new_memory: Memory
    ) -> dict[str, int | list[dict]]:
        """Classifies relations for a new memory and applies resulting graph updates.
        
        Args:
            new_memory: Newly created memory.
            
        Returns:
            Dict with candidate count and applied relations.
        """
        candidates = await self.neo4j_client.semantic_search_memories(
            embedding=new_memory.embedding,
            container_tag=new_memory.container_tag,
            min_score=0.75,
            limit=10,
            is_latest_only=True,
        )

        filtered_candidates = [
            c for c in candidates if c.memory.id != new_memory.id
        ][:10]

        if not filtered_candidates:
            return {"candidate_count": 0, "applied": []}

        classification = await self._classify(
            new_memory, [c.memory for c in filtered_candidates]
        )
        
        applied: list[dict] = []

        for relation in classification.relations:
            if relation.relation_type == "UPDATE":
                await self.neo4j_client.create_memory_relation(
                    new_memory.id,
                    relation.existing_memory_id,
                    RelationType.UPDATES,
                )
                await self.neo4j_client.mark_memory_not_latest(
                    relation.existing_memory_id
                )
                applied.append({
                    "relation_type": "UPDATE",
                    "existing_memory_id": relation.existing_memory_id,
                })
                continue

            if relation.relation_type == "EXTEND":
                target_memory = next(
                    (
                        c.memory for c in filtered_candidates 
                        if c.memory.id == relation.existing_memory_id
                    ),
                    None,
                )
                await self.neo4j_client.create_memory_relation(
                    new_memory.id,
                    relation.existing_memory_id,
                    RelationType.EXTENDS,
                )
                if target_memory and target_memory.memory_type == MemoryType.PREFERENCE:
                    await self.forgetting_service.reinforce_preference(
                        target_memory.id
                    )
                applied.append({
                    "relation_type": "EXTEND",
                    "existing_memory_id": relation.existing_memory_id,
                })
                continue

            if relation.relation_type == "DERIVE" and relation.derived_fact:
                derived_embedding = (
                    await self.embedding_service.generate_embedding(
                        relation.derived_fact
                    )
                )
                derived_memory = await self.neo4j_client.create_memory(
                    content=relation.derived_fact,
                    memory_type=MemoryType.DERIVED,
                    container_tag=new_memory.container_tag,
                    confidence=relation.confidence * 0.9,  # Slightly lower confidence for derived
                    embedding=derived_embedding,
                    source_doc_id=new_memory.source_doc_id,
                    derived_from=[new_memory.id, relation.existing_memory_id],
                )
                await self.neo4j_client.create_memory_relation(
                    new_memory.id,
                    derived_memory.id,
                    RelationType.DERIVES,
                )
                await self.neo4j_client.create_memory_relation(
                    relation.existing_memory_id,
                    derived_memory.id,
                    RelationType.DERIVES,
                )
                applied.append({
                    "relation_type": "DERIVE",
                    "existing_memory_id": relation.existing_memory_id,
                    "derived_memory_id": derived_memory.id,
                })

        return {
            "candidate_count": len(filtered_candidates),
            "applied": applied,
        }

    async def _classify(
        self, new_memory: Memory, existing_memories: Sequence[Memory]
    ) -> ClassificationResponse:
        """Calls LLM to classify relations between new memory and existing ones."""
        candidates_text = "\n".join([
            f"ID: {m.id} | Content: {m.content}" 
            for m in existing_memories
        ])
        
        user_prompt = f"""NUEVO HECHO: {new_memory.content}

HECHOS EXISTENTES:
{candidates_text}"""

        response = await self.anthropic.messages.create(
            model=self.model,
            max_tokens=4096,
            system=CLASSIFICATION_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )

        content = response.content[0].text
        import json
        data = json.loads(content)
        return ClassificationResponse.model_validate(data)
