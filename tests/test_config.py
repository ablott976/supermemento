from app.config import Settings

def test_settings_load():
    settings = Settings()
    assert settings.MCP_SERVER_PORT == 8000
    assert settings.LOG_LEVEL == "info"
