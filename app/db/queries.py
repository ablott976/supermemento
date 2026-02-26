from neo4j import AsyncSession

# This file will contain Cypher queries as per CLAUDE.md requirements.
# Queries should be parameterized to avoid injection.

async def create_constraints(session: AsyncSession):
    # This is already handled in app/db/neo4j.py init_db
    pass
