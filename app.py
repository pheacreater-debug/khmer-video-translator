from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
from pathlib import Path
import subprocess
import uuid
import re
import os

BASE = Path(__file__).resolve().parent
UPLOADS = BASE / "uploads"
OUTPUTS = BASE / "outputs"
UPLOADS.mkdir(exist_ok=True)
OUTPUTS.mkdir(exist_ok=True)

ALLOWED_VIDEO = {"mp4", "mov", "mkv", "webm", "avi"}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024 * 1024  # 1 GB demo limit


def allowed_video(name: str) -> bool:
    return "." in name and name.rsplit(".", 1)[1].lower() in ALLOWED_VIDEO


def parse_srt(text: str):
    blocks = re.split(r"\n\s*\n", text.strip())
    items = []
    for block in blocks:
        lines = [x.strip("\ufeff") for x in block.splitlines() if x.strip()]
        if len(lines) < 3:
            continue
        if "-->" not in lines[1]:
            continue
        start, end = [x.strip() for x in lines[1].split("-->", 1)]
        items.append({
            "id": len(items) + 1,
            "start": start,
            "end": end,
            "text": " ".join(lines[2:]).strip(),
            "khmer": ""
        })
    return items


def make_srt(items):
    out = []
    for i, item in enumerate(items, 1):
        out.append(f"{i}\n{item['start']} --> {item['end']}\n{item.get('khmer') or item.get('text','')}\n")
    return "\n".join(out)


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/upload")
def upload():
    file = request.files.get("video")
    if not file or not file.filename:
        return jsonify(error="No video selected"), 400
    if not allowed_video(file.filename):
        return jsonify(error="Unsupported video format"), 400

    ext = file.filename.rsplit(".", 1)[1].lower()
    name = f"{uuid.uuid4().hex}.{ext}"
    file.save(UPLOADS / secure_filename(name))
    return jsonify(
        ok=True,
        filename=name,
        url=f"/media/uploads/{name}"
    )


@app.post("/api/parse-srt")
def parse_srt_api():
    file = request.files.get("srt")
    if not file:
        return jsonify(error="No SRT file selected"), 400
    try:
        text = file.read().decode("utf-8-sig")
        return jsonify(items=parse_srt(text))
    except UnicodeDecodeError:
        return jsonify(error="SRT must be UTF-8 encoded"), 400


@app.post("/api/translate")
def translate():
    """
    Demo translation endpoint.
    Set OPENAI_API_KEY to enable an LLM translation implementation.
    The fallback keeps the app usable without an external API.
    """
    data = request.get_json(force=True)
    items = data.get("items", [])
    target = data.get("target", "km")

    if not items:
        return jsonify(error="No subtitle items"), 400

    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=api_key)
            for item in items:
                source = item.get("text", "")
                if not source.strip():
                    continue
                prompt = (
                    "Translate the following subtitle into natural Cambodian Khmer. "
                    "Return only the translation, preserving names and meaning. "
                    "Keep it concise for video subtitles.\n\n" + source
                )
                response = client.responses.create(
                    model=os.getenv("OPENAI_MODEL", "gpt-5-mini"),
                    input=prompt
                )
                item["khmer"] = response.output_text.strip()
            return jsonify(items=items, provider="openai")
        except Exception as exc:
            return jsonify(error=f"Translation API error: {exc}"), 500

    # Offline fallback/demo dictionary.
    demo = {
        "hello": "សួស្តី!",
        "hello this is a foreign video": "សួស្តី! នេះជាវីដេអូបរទេស។",
        "welcome": "សូមស្វាគមន៍!",
        "thank you": "អរគុណ!",
        "how are you": "តើអ្នកសុខសប្បាយជាទេ?",
        "this is a demo": "នេះជាការបង្ហាញសាកល្បង។",
    }
    for item in items:
        src = item.get("text", "").strip()
        item["khmer"] = demo.get(src.lower(), f"[ខ្មែរ] {src}")
    return jsonify(items=items, provider="offline-demo")


@app.post("/api/save-srt")
def save_srt_api():
    data = request.get_json(force=True)
    items = data.get("items", [])
    if not items:
        return jsonify(error="No subtitles"), 400
    name = f"{uuid.uuid4().hex}.srt"
    (OUTPUTS / name).write_text(make_srt(items), encoding="utf-8")
    return jsonify(ok=True, url=f"/media/outputs/{name}", filename=name)


@app.post("/api/render")
def render_video():
    data = request.get_json(force=True)
    video = data.get("video")
    items = data.get("items", [])
    if not video or not items:
        return jsonify(error="Video and subtitles are required"), 400

    src = UPLOADS / Path(video).name
    if not src.exists():
        return jsonify(error="Uploaded video not found"), 404

    srt_name = f"{uuid.uuid4().hex}.srt"
    srt_path = OUTPUTS / srt_name
    srt_path.write_text(make_srt(items), encoding="utf-8")

    out_name = f"rendered_{uuid.uuid4().hex}.mp4"
    out_path = OUTPUTS / out_name

    # Requires ffmpeg installed and available on PATH.
    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-vf", f"subtitles={srt_path.as_posix()}",
        "-c:a", "copy", str(out_path)
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
        if result.returncode != 0:
            return jsonify(error="FFmpeg failed", details=result.stderr[-2500:]), 500
    except FileNotFoundError:
        return jsonify(error="FFmpeg is not installed. Install FFmpeg and add it to PATH."), 500
    except subprocess.TimeoutExpired:
        return jsonify(error="Rendering timed out"), 500

    return jsonify(ok=True, url=f"/media/outputs/{out_name}", filename=out_name)


@app.get("/media/<folder>/<path:name>")
def media(folder, name):
    directory = UPLOADS if folder == "uploads" else OUTPUTS
    return send_from_directory(directory, name, as_attachment=False)


@app.get("/health")
def health():
    return jsonify(ok=True, service="khmer-video-translator")

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
