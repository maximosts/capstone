import os, json, requests
from dotenv import load_dotenv

load_dotenv()
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/chat")
MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b-instruct-q4_0")

def generate_meal_plan(profile, targets, foods):
    schema = """{
      "meals": [{"name":"Breakfast","items":[{"id":"food_id","grams":100}]}],
      "totals":{"kcal":0,"protein":0,"fat":0,"carbs":0}
    }"""

    prompt = f"""
    You are a nutrition planner.
    User: {profile}
    Targets: {targets}
    Available foods: {foods[:20]}
    Respond ONLY with valid JSON following this schema: {schema}
    """

    # Tell Ollama NOT to stream chunks
    r = requests.post(OLLAMA_URL, json={
        "model": MODEL,
        "stream": False,
        "messages": [
            {"role": "system", "content": "Always output valid JSON only."},
            {"role": "user", "content": prompt}
        ],
        "options": {"temperature": 0.2}
    })

    try:
        data = r.json()
        message = data.get("message", {}).get("content", "").strip()

        # --- Fix invalid JSON (remove // comments, trailing commas, etc.)
        import re
        clean = re.sub(r"//.*", "", message)     # remove comments
        clean = re.sub(r",\s*}", "}", clean)     # remove trailing commas in objects
        clean = re.sub(r",\s*]", "]", clean)     # remove trailing commas in arrays

        return json.loads(clean)
    except Exception as e:
        return {"error": str(e), "raw": r.text}
