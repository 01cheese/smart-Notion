import os
import httpx
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from supabase import create_client, Client
from pydantic import BaseModel
from typing import Optional

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

app = FastAPI(title="Void Notepad")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_supabase_admin() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


async def get_current_user(request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth_header.split(" ")[1]
    try:
        sb = get_supabase()
        user = sb.auth.get_user(token)
        if not user or not user.user:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user.user
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


# ── Models ────────────────────────────────────────────────────────────────────

class NoteUpdate(BaseModel):
    content: str  # we store as content_text in DB

class SettingsUpdate(BaseModel):
    # matches real user_settings schema: gemini_key, gemini_model
    gemini_key: Optional[str] = None
    gemini_model: Optional[str] = None
    # UI-only settings stored locally in browser (font, theme, font_size)

class AIRequest(BaseModel):
    action: str          # "continue" | "explain" | "replace"
    selected_text: str
    context: str
    gemini_api_key: str
    gemini_model: Optional[str] = "gemini-3.1-flash-lite-preview"

class BeaconNote(BaseModel):
    content: str
    token: str


# ── API Routes ────────────────────────────────────────────────────────────────

@app.get("/api/config")
async def get_config():
    """Public keys for frontend — service key never exposed."""
    return {
        "supabase_url": SUPABASE_URL,
        "supabase_anon_key": SUPABASE_ANON_KEY,
    }


@app.get("/api/note")
async def get_note(user=Depends(get_current_user)):
    sb = get_supabase_admin()
    result = (
        sb.table("notes")
        .select("id, content_text, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    if result.data:
        return result.data[0]
    # First time — create empty note
    new_note = sb.table("notes").insert({"user_id": user.id, "content_text": ""}).execute()
    return new_note.data[0]


@app.put("/api/note")
async def update_note(body: NoteUpdate, user=Depends(get_current_user)):
    sb = get_supabase_admin()
    existing = (
        sb.table("notes")
        .select("id")
        .eq("user_id", user.id)
        .limit(1)
        .execute()
    )
    if existing.data:
        sb.table("notes").update({"content_text": body.content}).eq("id", existing.data[0]["id"]).execute()
    else:
        sb.table("notes").insert({"user_id": user.id, "content_text": body.content}).execute()
    return {"ok": True}


@app.post("/api/note/beacon")
async def beacon_note(body: BeaconNote):
    """navigator.sendBeacon on page unload — saves even when tab closes."""
    try:
        sb_anon = get_supabase()
        user_resp = sb_anon.auth.get_user(body.token)
        if not user_resp or not user_resp.user:
            return {"ok": False}
        uid = user_resp.user.id
        sb = get_supabase_admin()
        existing = sb.table("notes").select("id").eq("user_id", uid).limit(1).execute()
        if existing.data:
            sb.table("notes").update({"content_text": body.content}).eq("id", existing.data[0]["id"]).execute()
        else:
            sb.table("notes").insert({"user_id": uid, "content_text": body.content}).execute()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/settings")
async def get_settings(user=Depends(get_current_user)):
    sb = get_supabase_admin()
    result = sb.table("user_settings").select("*").eq("user_id", user.id).execute()
    if result.data:
        return result.data[0]
    # Create default row
    defaults = {"user_id": user.id, "gemini_key": "", "gemini_model": "gemini-3.1-flash-lite-preview"}
    sb.table("user_settings").insert(defaults).execute()
    return defaults


@app.put("/api/settings")
async def update_settings(body: SettingsUpdate, user=Depends(get_current_user)):
    sb = get_supabase_admin()
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update_data:
        return {"ok": True}
    existing = sb.table("user_settings").select("user_id").eq("user_id", user.id).execute()
    if existing.data:
        sb.table("user_settings").update(update_data).eq("user_id", user.id).execute()
    else:
        sb.table("user_settings").insert({"user_id": user.id, **update_data}).execute()
    return {"ok": True}


@app.post("/api/ai")
async def ai_action(body: AIRequest, user=Depends(get_current_user)):
    if not body.gemini_api_key:
        raise HTTPException(status_code=400, detail="Gemini API key not set")

    model = body.gemini_model or "gemini-3.1-flash-lite-preview"

    prompts = {
        "continue": f"""You are a writing assistant. Continue the following selected text naturally, matching the tone and style. Return ONLY the continuation text, nothing else.

Context (surrounding text):
{body.context}

Selected text to continue:
{body.selected_text}""",

        "explain": f"""Explain the following text clearly and concisely. Return ONLY the explanation.

Text to explain:
{body.selected_text}""",

        "replace": f"""Rewrite the following text to make it better — clearer, more engaging, and more precise. Preserve the original meaning. Return ONLY the improved version, nothing else.

Original text:
{body.selected_text}"""
    }

    prompt = prompts.get(body.action)
    if not prompt:
        raise HTTPException(status_code=400, detail="Invalid action")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                params={"key": body.gemini_api_key},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.7, "maxOutputTokens": 1024}
                }
            )
            if response.status_code != 200:
                raise HTTPException(status_code=502, detail=f"Gemini error: {response.text}")
            data = response.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            return {"result": text.strip()}
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Gemini request timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Frontend ──────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return f.read()


app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)