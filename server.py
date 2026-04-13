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


def ffmpeg_ok():
    return shutil.which("ffmpeg") is not None


@app.get("/")
def health():
    return jsonify({"status": "ok", "message": "API online", "ffmpeg": ffmpeg_ok()})


@app.get("/info")
def info():
    url = request.args.get("url", "").strip()
    if not url:
        return jsonify({"erro": "Parâmetro 'url' é obrigatório."}), 400

    print(f"[API] Recebida URL: {url}")
    ffmpeg = ffmpeg_ok()

    ydl_opts = {"quiet": True, "skip_download": True, "noplaylist": True}

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

            # ── Áudio puro ──────────────────────────────────────────────────
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
                    "size": f.get("filesize") or f.get("filesize_approx") or 0,
                })

            # ── Vídeo (qualquer resolução >= 360p, com ou sem áudio) ────────
            elif vcodec != "none" and height and height >= 360:
                if height in seen_res:
                    continue
                seen_res.add(height)

                # Seletor dinâmico: tenta mp4+m4a, senão qualquer vídeo+audio,
                # por último o melhor pré-mesclado disponível nessa resolução.
                if ffmpeg:
                    fmt_sel = (
                        f"bestvideo[height={height}][ext=mp4]+bestaudio[ext=m4a]"
                        f"/bestvideo[height={height}]+bestaudio"
                        f"/best[height<={height}]"
                    )
                else:
                    # Sem ffmpeg: apenas pré-mesclados
                    fmt_sel = f"best[height<={height}][ext=mp4]/best[height<={height}]"

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
                    "size": f.get("filesize") or f.get("filesize_approx") or 0,
                })

        formatos_audio.sort(key=lambda x: x.get("bitrate", 0), reverse=True)
        formatos_video.sort(key=lambda x: x.get("resolucao", 0), reverse=True)

        aviso_ffmpeg = (
            None if ffmpeg
            else "ffmpeg não encontrado. MP3 e vídeos acima de 360p requerem ffmpeg instalado."
        )

        print(f"[API] Áudio: {len(formatos_audio)}, Vídeo: {len(formatos_video)}, ffmpeg: {ffmpeg}")
        return jsonify({
            "title": titulo or "Sem titulo",
            "formatos": formatos_audio + formatos_video,
            "aviso": aviso_ffmpeg,
        })
    except Exception as e:
        print(f"[API] ERRO /info: {e}")
        return jsonify({"erro": str(e)}), 500


@app.get("/download/<fmt_id>")
def download(fmt_id):
    fmt = FORMATOS_CACHE.get(fmt_id)
    if not fmt:
        return jsonify({"erro": "Formato expirado ou inválido. Busque novamente."}), 404

    video_url = fmt.get("video_url")
    format_id = fmt.get("format_id")
    ext = fmt.get("ext") or "mp4"
    tipo = fmt.get("tipo", "audio")
    title = fmt.get("title", "") or "media"
    converter_mp3 = fmt.get("converter_mp3", False)
    needs_merge = fmt.get("needs_merge", False)

    safe_title = re.sub(r'[^\w\s\-.]', '', title).strip()
    safe_title = re.sub(r'\s+', '_', safe_title) or "media"

    if not video_url or not format_id:
        return jsonify({"erro": "Dados do formato incompletos."}), 400

    print(f"[API] Download: {fmt_id} | tipo={tipo} | ext={ext} | ffmpeg_mp3={converter_mp3}")

    try:
        temp_dir = tempfile.gettempdir()
        # Usa %(ext)s para o yt-dlp controlar a extensão (especialmente após conversão)
        output_template = os.path.join(temp_dir, f"media_{fmt_id}.%(ext)s")

        ydl_opts = {
            "quiet": True,
            "noplaylist": True,
            "format": format_id,
            "outtmpl": output_template,
            "retries": 5,
            "fragment_retries": 5,
            "skip_unavailable_fragments": True,
            "continuedl": True,
        }

        if tipo == "audio" and converter_mp3:
            # Converte para MP3 usando ffmpeg
            ydl_opts["postprocessors"] = [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "0",  # VBR melhor qualidade
            }]

        elif tipo == "video":
            ydl_opts["merge_output_format"] = "mp4"
            if needs_merge:
                ydl_opts["postprocessors"] = [{
                    "key": "FFmpegVideoConvertor",
                    "preferedformat": "mp4",
                }]

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])

        # Localiza o arquivo gerado (extensão pode ter mudado após conversão)
        output_path = os.path.join(temp_dir, f"media_{fmt_id}.{ext}")
        if not os.path.exists(output_path):
            # Busca qualquer arquivo gerado com esse ID
            candidatos = [
                os.path.join(temp_dir, f)
                for f in os.listdir(temp_dir)
                if f.startswith(f"media_{fmt_id}.")
            ]
            if not candidatos:
                return jsonify({"erro": "Arquivo não encontrado após download."}), 500
            output_path = candidatos[0]
            ext = output_path.rsplit(".", 1)[-1]

        print(f"[API] Arquivo pronto: {output_path}")
        return send_file(
            output_path,
            as_attachment=True,
            download_name=f"{safe_title}.{ext}",
            mimetype="application/octet-stream",
            conditional=True,
        )
    except Exception as e:
        print(f"[API] ERRO /download: {e}")
        return jsonify({"erro": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
