from fastapi import FastAPI
from app.config import settings

app = FastAPI(title="Supermemento")

@app.get("/health")
async def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.MCP_SERVER_PORT)
