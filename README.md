# YT Downloader (Expo + Python)

Aplicativo React Native com Expo para baixar áudio e vídeo do YouTube, com servidor local em Flask + yt-dlp.

## O Que O Projeto Faz

- Busca formatos disponíveis no YouTube
- Lista áudio por bitrate (incluindo mp3 quando ffmpeg está instalado)
- Lista vídeo em mp4 por resolução (360p até 4K, conforme disponibilidade do vídeo)
- Faz download com barra de progresso
- Salva com nome do vídeo
- Mostra status visual da API (online/offline) no aplicativo

## Requisitos

- Node.js 18+
- npm 9+
- Python 3.10+
- ffmpeg (obrigatório para mp3 e vídeo acima de 360p)
- Celular e computador na mesma rede local (Wi-Fi)

## Instalação

### 1) Dependências do aplicativo (Expo)

```bash
npm install
```

### 2) Dependências do servidor Python

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3) Instalar ffmpeg

Linux (Debian/Ubuntu):

```bash
sudo apt update
sudo apt install -y ffmpeg
```

Verificar:

```bash
ffmpeg -version
```

## Como Rodar

### Terminal 1: servidor

```bash
source .venv/bin/activate
python server.py
```

Servidor padrão: `http://0.0.0.0:5000`

### Terminal 2: aplicativo Expo

```bash
npx expo start --clear
```

## Uso no Aplicativo

1. No campo de API, informe o IP local do computador, por exemplo:

```text
http://192.168.15.7:5000
```

2. Aguarde o indicador mostrar API online
3. Cole a URL do YouTube
4. Toque em Buscar formatos
5. Escolha áudio ou vídeo e baixe

## Comportamento Importante

- Sem ffmpeg:
- mp3 não é gerado
- vídeo alto (720p, 1080p, 4K) pode não aparecer/mesclar

- Com ffmpeg:
- áudio pode ser convertido para mp3
- vídeo + áudio são mesclados em mp4 em resoluções altas

- Expo Go no Android tem limitações de acesso total à galeria
- Para fluxo completo de mídia, prefira Build de Desenvolvimento

## Estrutura Atual

```text
app/
  _layout.tsx
  index.tsx
components/
  downloader.tsx
  navBar.tsx
assets/images/
server.py
requirements.txt
package.json
package-lock.json
app.json
tsconfig.json
```

## Scripts Úteis

```bash
npm run start
npm run android
npm run ios
npm run web
npm run lint
```

## Solução de Problemas Rápida

- API offline no aplicativo:
- confirme IP correto
- confirme servidor rodando em `0.0.0.0:5000`
- teste no navegador do celular: `http://SEU_IP:5000/`

- Download de vídeo grande falhando:
- confirme ffmpeg instalado
- reinicie backend após instalar ffmpeg

- Formatos limitados:
- alguns vídeos têm restrições de codecs/resoluções
- atualize yt-dlp na venv:

```bash
source .venv/bin/activate
pip install -U yt-dlp
```
