from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
import yt_dlp
from uuid import uuid4
import os
import re
import shutil
import tempfile

app = Flask(__name__)
CORS(app)

FORMATOS_CACHE = {}

# 👉 caminho opcional de cookies (se usar depois)
COOKIE_FILE = os.environ.get("YTDLP_COOKIE_FILE", None)


def ffmpeg_ok():
    return shutil.which("ffmpeg") is not None


# 🔥 função central de config do yt-dlp
def get_ydl_opts(extra=None):
    base = {
        "quiet": True,
        "noplaylist": True,
        "http_headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
        },
        "source_address": "0.0.0.0",  # força IPv4
    }

    # 👉 se tiver cookie configurado
    if COOKIE_FILE:
        base["cookiefile"] = COOKIE_FILE

    if extra:
        base.update(extra)

    return base


@app.get("/")
def health():
    return jsonify({"status": "ok", "message": "API online", "ffmpeg": ffmpeg_ok()})


@app.get("/info")
def info():
    url = request.args.get("url", "").strip()
    if not url:
        return jsonify({"erro": "Parâmetro 'url' é obrigatório."}), 400

    print(f"[API] URL: {url}")
    ffmpeg = ffmpeg_ok()

    ydl_opts = get_ydl_opts({"skip_download": True})

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            data = ydl.extract_info(url, download=False)

        titulo = data.get("title", "")
        formatos_audio = []
        formatos_video = []
        seen_abr: set = set()
        seen_res: set = set()

        for f in data.get("formats", []):
            vcodec = f.get("vcodec") or "none"
            acodec = f.get("acodec") or "none"
            height = f.get("height")
            abr = round(f.get("abr") or 0)

            # Áudio
            if vcodec == "none" and acodec != "none":
                if abr <= 0 or abr in seen_abr:
                    continue
                seen_abr.add(abr)

                fmt_id = uuid4().hex
                ext_final = "mp3" if ffmpeg else (f.get("ext") or "m4a")

                FORMATOS_CACHE[fmt_id] = {
                    "video_url": url,
                    "format_id": f.get("format_id"),
                    "ext": ext_final,
                    "tipo": "audio",
                    "converter_mp3": ffmpeg,
                    "title": titulo,
                }

                formatos_audio.append({
                    "id": fmt_id,
                    "tipo": "audio",
                    "bitrate": abr,
                    "ext": ext_final,
                })

            # Vídeo
            elif vcodec != "none" and height and height >= 360:
                if height in seen_res:
                    continue
                seen_res.add(height)

                if ffmpeg:
                    fmt_sel = (
                        f"bestvideo[height={height}][ext=mp4]+bestaudio[ext=m4a]"
                        f"/bestvideo[height={height}]+bestaudio"
                        f"/best[height<={height}]"
                    )
                else:
                    fmt_sel = f"best[height<={height}]"

                fmt_id = uuid4().hex

                FORMATOS_CACHE[fmt_id] = {
                    "video_url": url,
                    "format_id": fmt_sel,
                    "ext": "mp4",
                    "tipo": "video",
                    "height": height,
                    "needs_merge": ffmpeg,
                    "title": titulo,
                }

                formatos_video.append({
                    "id": fmt_id,
                    "tipo": "video",
                    "resolucao": height,
                    "ext": "mp4",
                })

        return jsonify({
            "title": titulo or "Sem titulo",
            "formatos": formatos_audio + formatos_video
        })

    except Exception as e:
        print(f"[ERRO /info]: {e}")
        return jsonify({"erro": str(e)}), 500


@app.get("/download/<fmt_id>")
def download(fmt_id):
    fmt = FORMATOS_CACHE.get(fmt_id)
    if not fmt:
        return jsonify({"erro": "Formato inválido"}), 404

    video_url = fmt["video_url"]
    format_id = fmt["format_id"]
    ext = fmt["ext"]
    tipo = fmt["tipo"]
    title = fmt.get("title", "media")

    safe_title = re.sub(r'[^\w\s\-.]', '', title)
    safe_title = re.sub(r'\s+', '_', safe_title)

    temp_dir = tempfile.gettempdir()
    output_template = os.path.join(temp_dir, f"{fmt_id}.%(ext)s")

    ydl_opts = get_ydl_opts({
        "format": format_id,
        "outtmpl": output_template,
    })

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])

        files = [f for f in os.listdir(temp_dir) if f.startswith(fmt_id)]
        if not files:
            return jsonify({"erro": "Arquivo não encontrado"}), 500

        path = os.path.join(temp_dir, files[0])

        return send_file(
            path,
            as_attachment=True,
            download_name=f"{safe_title}.{ext}"
        )

    except Exception as e:
        print(f"[ERRO /download]: {e}")
        return jsonify({"erro": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port)