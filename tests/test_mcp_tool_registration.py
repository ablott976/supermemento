from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
NEO4J_CLIENT_PATH = REPO_ROOT / "src" / "db" / "neo4j-client.ts"
SERVER_PATH = REPO_ROOT / "src" / "server.ts"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_neo4j_client_exposes_registered_crud_methods() -> None:
    neo4j_client_source = _read(NEO4J_CLIENT_PATH)

    expected_method_signatures = [
        "public async deleteDocument(documentId: string): Promise<boolean>",
        "public async updateDocument(",
        "public async deleteMemory(memoryId: string): Promise<boolean>",
        "public async updateMemory(memoryId: string, input: MemoryUpdateInput): Promise<Memory | null>",
        "public async reinforcePreference(memoryId: string): Promise<Memory | null>",
    ]

    for signature in expected_method_signatures:
        assert signature in neo4j_client_source


def test_server_lists_registered_document_and_memory_tools() -> None:
    server_source = _read(SERVER_PATH)

    expected_tool_listings = [
        (
            'name: "delete_document"',
            "inputSchema: zodToJsonSchema(deleteDocumentArgsSchema)",
        ),
        (
            'name: "update_document"',
            "inputSchema: zodToJsonSchema(updateDocumentArgsSchema)",
        ),
        (
            'name: "delete_memory"',
            "inputSchema: zodToJsonSchema(deleteMemoryArgsSchema)",
        ),
        (
            'name: "update_memory"',
            "inputSchema: zodToJsonSchema(updateMemoryArgsSchema)",
        ),
        (
            'name: "reinforce_preference"',
            "inputSchema: zodToJsonSchema(reinforcePreferenceArgsSchema)",
        ),
    ]

    for tool_name, schema_reference in expected_tool_listings:
        assert tool_name in server_source
        assert schema_reference in server_source


def test_server_routes_registered_tools_to_neo4j_client_methods() -> None:
    server_source = _read(SERVER_PATH)

    expected_tool_routes = [
        (
            'case "delete_document":',
            "this.neo4jClient.deleteDocument(input.documentId)",
        ),
        (
            'case "update_document":',
            "this.neo4jClient.updateDocument(input.documentId, {",
        ),
        ('case "delete_memory":', "this.neo4jClient.deleteMemory(input.memoryId)"),
        ('case "update_memory":', "this.neo4jClient.updateMemory(input.memoryId, {"),
        (
            'case "reinforce_preference":',
            "this.neo4jClient.reinforcePreference(input.memoryId)",
        ),
    ]

    for case_label, call_line in expected_tool_routes:
        assert case_label in server_source
        assert call_line in server_source


def test_existing_core_tools_remain_registered() -> None:
    server_source = _read(SERVER_PATH)

    # Regression guard: ensure existing major tools still appear in tool list.
    for tool_name in [
        'name: "create_memory"',
        'name: "semantic_search"',
        'name: "create_document"',
        'name: "ingest_document"',
        'name: "get_document_status"',
        'name: "list_documents"',
        'name: "list_memories"',
        'name: "get_memory_relations"',
        'name: "run_maintenance"',
        'name: "forget_memory"',
        'name: "get_user_profile"',
        'name: "crawl_url"',
        'name: "crawl_urls"',
        'name: "list_crawled_urls"',
        'name: "setup_schema"',
    ]:
        assert tool_name in server_source
